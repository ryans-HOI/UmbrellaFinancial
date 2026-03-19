'use strict';
const express    = require('express');
const { Pool }   = require('pg');
const { Issuer, generators } = require('openid-client');
const session    = require('express-session');
const cookieParser = require('cookie-parser');

const app  = express();
const PORT = process.env.PORT || 3012;

const APP_URL    = process.env.APP_URL    || 'http://localhost:3012';
const KC_INTERNAL = process.env.KC_INTERNAL_URL || 'http://localhost:8180';
const KC_PUBLIC   = process.env.KC_PUBLIC_URL   || 'http://localhost:8180';
const KC_REALM    = process.env.KC_REALM        || 'umbrella-financial';
const KC_CLIENT_ID     = process.env.KC_CLIENT_ID     || 'finapp-client';
const KC_CLIENT_SECRET = process.env.KC_CLIENT_SECRET || 'finapp-secret-2026';

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'findb',
  user:     process.env.DB_USER || 'finapp',
  password: process.env.DB_PASS || 'finapp123',
});

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'fin-session-secret-not-rotated',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, httpOnly: false, maxAge: 86400000 }
}));

// ?????? OIDC Setup ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
let oidcClient = null;
async function initOIDC() {
  try {
    const issuer = await Issuer.discover(
      `${KC_INTERNAL}/realms/${KC_REALM}`
    );
    oidcClient = new issuer.Client({
      client_id: KC_CLIENT_ID,
      client_secret: KC_CLIENT_SECRET,
      redirect_uris: [`${APP_URL}/callback`],
      response_types: ['code'],
    });
    console.log(`[OIDC] Ready ??? KC: ${KC_INTERNAL}`);
  } catch (e) {
    console.error('[OIDC] Init failed:', e.message);
    setTimeout(initOIDC, 5000);
  }
}
initOIDC();

// ?????? Auth helpers ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

async function getUserFromDB(username) {
  try {
    const r = await pool.query(
      `SELECT username, email, role, department, active, mfa_enabled,
              idp_source, account_type, risk_score, last_login, login_count
       FROM users_fin WHERE username = $1`, [username]
    );
    return r.rows[0] || null;
  } catch (e) { return null; }
}

// ?????? OAuth2 Login (KC) ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('/login', (req, res) => {
  if (!oidcClient) return res.send('<p>OIDC not ready, please wait and refresh...</p>');
  const state = generators.state();
  const nonce = generators.nonce();
  res.cookie('oidc_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 60000 });
  res.cookie('oidc_nonce', nonce, { httpOnly: true, sameSite: 'lax', maxAge: 60000 });
  const url = oidcClient.authorizationUrl({ scope: 'openid email profile', state, nonce });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  try {
    const oidcState = req.cookies.oidc_state;
    const oidcNonce = req.cookies.oidc_nonce;
    const params = oidcClient.callbackParams(req);
    res.clearCookie('oidc_state');
    res.clearCookie('oidc_nonce');
    const tokenSet = await oidcClient.callback(
      `${APP_URL}/callback`, params, { state: oidcState, nonce: oidcNonce }
    );
    const claims  = tokenSet.claims();
    const username = claims.preferred_username || claims.sub;
    const dbUser = await getUserFromDB(username);

    req.session.user = {
      username, email: claims.email || '',
      idToken:    tokenSet.id_token,
      dbRole:     dbUser?.role || 'viewer',
      dbActive:   dbUser?.active ?? true,
      dbMfa:      dbUser?.mfa_enabled ?? false,
      idpSource:  dbUser?.idp_source || 'oauth2',
      department: dbUser?.department || '',
      accountType:dbUser?.account_type || 'human',
      riskScore:  dbUser?.risk_score || 0,
      lastLogin:  dbUser?.last_login || null,
      loginCount: dbUser?.login_count || 0,
      inDB:       !!dbUser,
      authMethod: 'oauth2-oidc',
    };

    await Promise.all([
      pool.query(
        `INSERT INTO login_history_fin (username, idp_source, success, ip_address, user_agent, created_at)
         VALUES ($1, 'oauth2-oidc', true, $2, $3, NOW())`,
        [username, req.ip, req.headers['user-agent'] || 'StaffPortal/1.0']
      ).catch(() => {}),
      pool.query(
        `UPDATE users_fin SET last_login = NOW(), login_count = COALESCE(login_count,0)+1 WHERE username=$1`,
        [username]
      ).catch(() => {}),
    ]);

    res.redirect('/dashboard');
  } catch (e) {
    console.error('[CALLBACK]', e.message);
    res.redirect('/?error=auth_failed');
  }
});

// ?????? Fallback DB Login ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.post('/fallback-login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.redirect('/?error=missing_credentials');
  try {
    const result = await pool.query(
      `SELECT username, email, role, department, active, mfa_enabled, idp_source,
              account_type, risk_score, last_login, login_count
       FROM users_fin WHERE username = $1 AND password_cleartext = $2`,
      [username, password]
    );
    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO login_history_fin (username, idp_source, success, failure_reason, ip_address, user_agent, created_at)
         VALUES ($1, 'local-fallback', false, 'invalid credentials', $2, $3, NOW())`,
        [username, req.ip, req.headers['user-agent'] || 'StaffPortal/1.0']
      ).catch(() => {});
      return res.redirect('/?error=invalid_credentials');
    }
    const dbUser = result.rows[0];
    const groupRes = await pool.query(
      `SELECT g.name FROM groups_fin g
       JOIN group_members_fin gm ON g.id = gm.group_id
       JOIN users_fin u ON u.id = gm.user_id
       WHERE u.username = $1`, [username]
    ).catch(() => ({ rows: [] }));
    const groups = groupRes.rows.map(r => r.name);

    req.session.user = {
      username: dbUser.username, email: dbUser.email || '',
      idToken: null,
      dbRole: dbUser.role || 'viewer',
      dbActive: dbUser.active ?? true,
      dbMfa: dbUser.mfa_enabled ?? false,
      idpSource: 'local-fallback',
      department: dbUser.department || '',
      accountType: dbUser.account_type || 'human',
      riskScore: dbUser.risk_score || 0,
      lastLogin: dbUser.last_login || null,
      loginCount: dbUser.login_count || 0,
      groups, inDB: true, authMethod: 'local-fallback',
    };

    await Promise.all([
      pool.query(
        `INSERT INTO login_history_fin (username, idp_source, success, ip_address, user_agent, created_at)
         VALUES ($1, 'local-fallback', true, $2, $3, NOW())`,
        [username, req.ip, req.headers['user-agent'] || 'StaffPortal/1.0']
      ).catch(() => {}),
      pool.query(
        `UPDATE users_fin SET last_login = NOW(), login_count = COALESCE(login_count,0)+1 WHERE username=$1`,
        [username]
      ).catch(() => {}),
    ]);
    res.redirect('/dashboard');
  } catch(e) {
    console.error('[FALLBACK-LOGIN]', e.message);
    res.redirect('/?error=auth_error');
  }
});

// ?????? Logout ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ?????? API Routes ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('/api/account', requireAuth, async (req, res) => {
  const user = req.session.user;
  const history = await pool.query(
    `SELECT idp_source, success, ip_address, created_at FROM login_history_fin
     WHERE username=$1 ORDER BY created_at DESC LIMIT 10`, [user.username]
  ).catch(() => ({ rows: [] }));
  res.json({ user, loginHistory: history.rows });
});

app.get('/api/users', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (!['admin','executive','compliance_officer'].includes(user.dbRole)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const r = await pool.query(
    `SELECT username, email, role, department, active, mfa_enabled,
            idp_source, account_type, risk_score, last_login, login_count
     FROM users_fin ORDER BY risk_score DESC LIMIT 100`
  );
  res.json({ count: r.rows.length, users: r.rows });
});

app.get('/api/accounts', requireAuth, async (req, res) => {
  const user = req.session.user;
  const isPrivileged = ['admin','executive','retail_banker','loan_officer','wealth_manager'].includes(user.dbRole);
  if (!isPrivileged) return res.status(403).json({ error: 'Access denied' });
  const r = await pool.query('SELECT * FROM accounts_fin LIMIT 50');
  res.json({ count: r.rows.length, accounts: r.rows });
});

app.get('/api/audit', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (!['admin','executive','compliance_officer'].includes(user.dbRole)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const r = await pool.query(
    `SELECT username, idp_source, success, failure_reason, ip_address, created_at
     FROM login_history_fin ORDER BY created_at DESC LIMIT 200`
  );
  res.json({ count: r.rows.length, logs: r.rows });
});

// ?????? UI ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  const error = req.query.error;
  res.send(renderLogin(error));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.send(renderDashboard(req.session.user));
});

app.get('*', requireAuth, (req, res) => {
  res.redirect('/dashboard');
});

function renderLogin(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Umbrella Financial ??? Staff Portal</title>
<style>
  :root { --bg:#080b12; --panel:#0d1117; --border:#1e2a3a; --gold:#d4af37; --blue:#4a9eff; --red:#ff4444; --text:#e8eaf0; --muted:#6b7280; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'SF Mono',Monaco,monospace; min-height:100vh; display:flex; }
  .left { flex:1; background:linear-gradient(135deg,#080b12 0%,#0d1520 100%); padding:3rem; display:flex; flex-direction:column; justify-content:space-between; border-right:1px solid var(--border); }
  .brand h1 { font-size:1.4rem; color:var(--gold); letter-spacing:2px; }
  .brand p { color:var(--muted); font-size:0.75rem; margin-top:0.5rem; }
  .stats { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  .stat { background:rgba(212,175,55,0.05); border:1px solid rgba(212,175,55,0.2); border-radius:6px; padding:1rem; }
  .stat-num { font-size:1.4rem; color:var(--gold); }
  .stat-label { font-size:0.7rem; color:var(--muted); margin-top:0.25rem; }
  .terminal-block { background:#050507; border:1px solid var(--border); border-radius:6px; padding:1rem; font-size:0.78rem; line-height:2; }
  .prompt { color:var(--gold); }
  .val { color:var(--blue); }
  .right { width:440px; padding:3rem; display:flex; flex-direction:column; justify-content:center; }
  .login-box h2 { font-size:1.1rem; color:var(--text); margin-bottom:0.25rem; }
  .sub { color:var(--muted); font-size:0.75rem; margin-bottom:1.5rem; }
  .btn-login { display:block; width:100%; background:var(--gold); color:#000; border:none; padding:0.8rem; border-radius:4px; font-family:monospace; font-size:0.9rem; cursor:pointer; text-align:center; text-decoration:none; font-weight:bold; letter-spacing:1px; }
  .divider { text-align:center; color:var(--muted); font-size:0.72rem; margin:1rem 0; border-bottom:1px solid var(--border); line-height:0; }
  .divider span { background:var(--bg); padding:0 0.75rem; }
  .fallback-section { border:1px solid #ff444433; border-radius:6px; padding:0.75rem 1rem; margin-top:0.5rem; }
  .fallback-section summary { color:#ff6644; font-size:0.78rem; cursor:pointer; letter-spacing:1px; }
  .fallback-form { display:flex; flex-direction:column; gap:0.6rem; margin-top:0.8rem; }
  .fallback-note { font-size:0.7rem; color:#666; font-family:monospace; }
  .fallback-form input { background:#050507; border:1px solid #333; color:#eee; padding:0.5rem 0.75rem; border-radius:4px; font-size:0.82rem; font-family:monospace; }
  .btn-fallback { background:#1a0000; border:1px solid #ff4444; color:#ff4444; padding:0.5rem; border-radius:4px; font-family:monospace; font-size:0.82rem; cursor:pointer; letter-spacing:1px; }
  .btn-fallback:hover { background:#ff444422; }
  .error-msg { background:rgba(255,68,68,0.1); border:1px solid var(--red); border-radius:4px; padding:0.5rem 0.75rem; font-size:0.78rem; color:var(--red); margin-bottom:1rem; }
  .corner-tag { font-size:0.65rem; color:var(--muted); margin-top:2rem; }
</style>
</head>
<body>
<div class="left">
  <div class="brand">
    <h1>UMBRELLA FINANCIAL</h1>
    <p>// core banking platform ??? staff access portal</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-num">6</div><div class="stat-label">Auth Flows</div></div>
    <div class="stat"><div class="stat-num">99.7%</div><div class="stat-label">Uptime</div></div>
    <div class="stat"><div class="stat-num">AD DS</div><div class="stat-label">Directory</div></div>
    <div class="stat"><div class="stat-num">IIS 10</div><div class="stat-label">Web Server</div></div>
  </div>
  <div class="terminal-block">
    <div><span class="prompt">domain</span>   <span class="val">umbrella-financial.local</span></div>
    <div><span class="prompt">idp</span>      <span class="val">Keycloak 24 + AD DS</span></div>
    <div><span class="prompt">method</span>   <span class="val">OAuth2 / LDAP / Local</span></div>
    <div><span class="prompt">server</span>   <span class="val">IIS 10 / Tomcat 10</span></div>
    <div><span class="prompt">mfa</span>      <span class="val">not enforced</span></div>
  </div>
</div>
<div class="right">
  <div class="login-box">
    <h2>Staff Sign-In</h2>
    <p class="sub">// authenticate via enterprise IdP</p>
    ${error ? `<div class="error-msg">??? ${error.replace(/_/g,' ')}</div>` : ''}
    <a href="/login" class="btn-login">??? Sign in with SSO</a>
    <div class="divider"><span>or</span></div>
    <details class="fallback-section">
      <summary>??? Emergency / Fallback Access</summary>
      <form method="POST" action="/fallback-login" class="fallback-form">
        <div class="fallback-note">// direct database auth ??? bypasses SSO and AD</div>
        <input type="text" name="username" placeholder="username" autocomplete="off" />
        <input type="password" name="password" placeholder="password" />
        <button type="submit" class="btn-fallback">??? Sign in directly</button>
      </form>
    </details>
    <div class="corner-tag">umbrella-financial.houseofidentity.io</div>
  </div>
</div>
</body>
</html>`;
}

function renderDashboard(user) {
  const isAdmin = ['admin','executive'].includes(user.dbRole);
  const isCompliance = user.dbRole === 'compliance_officer';
  const riskHigh = user.riskScore > 70;
  const isStale = !user.dbActive;
  const noMfa = !user.dbMfa && (isAdmin || user.dbRole === 'trader');

  const alerts = [];
  if (isStale) alerts.push('<div class="alert alert-danger">??? Your account is marked inactive in the core banking system but your SSO credentials remain active.</div>');
  if (noMfa)   alerts.push('<div class="alert alert-warn">??? MFA is not enabled on your account. Required for your role.</div>');
  if (riskHigh) alerts.push('<div class="alert alert-warn">??? High risk score detected on your account: ' + user.riskScore + '</div>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Umbrella Financial ??? Dashboard</title>
<style>
  :root { --bg:#080b12; --panel:#0d1117; --border:#1e2a3a; --gold:#d4af37; --blue:#4a9eff; --red:#ff4444; --green:#00c896; --text:#e8eaf0; --muted:#6b7280; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'SF Mono',Monaco,monospace; min-height:100vh; display:grid; grid-template-columns:220px 1fr; }
  .sidebar { background:var(--panel); border-right:1px solid var(--border); padding:1.5rem 0; }
  .sidebar-brand { padding:0 1.25rem 1.5rem; border-bottom:1px solid var(--border); margin-bottom:1rem; }
  .sidebar-brand h2 { font-size:0.85rem; color:var(--gold); }
  .sidebar-brand p { font-size:0.7rem; color:var(--muted); margin-top:0.2rem; }
  .nav-item { display:block; padding:0.55rem 1.25rem; color:var(--muted); font-size:0.78rem; text-decoration:none; border-left:2px solid transparent; }
  .nav-item:hover { color:var(--text); }
  .nav-item.active { color:var(--gold); border-left-color:var(--gold); }
  .main { padding:2rem; }
  h1 { font-size:1rem; margin-bottom:0.25rem; }
  p.sub { color:var(--muted); font-size:0.72rem; margin-bottom:1.5rem; }
  .alert { padding:0.6rem 0.85rem; border-radius:4px; font-size:0.78rem; margin-bottom:0.75rem; }
  .alert-danger { background:rgba(255,68,68,0.1); border:1px solid var(--red); color:var(--red); }
  .alert-warn { background:rgba(245,166,35,0.1); border:1px solid #f5a623; color:#f5a623; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:1rem; margin-bottom:1.5rem; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:1rem; }
  .card-val { font-size:1.1rem; color:var(--gold); margin-bottom:0.25rem; }
  .card-label { font-size:0.68rem; color:var(--muted); }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; }
  .info-box { background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:1.25rem; }
  .info-box h3 { font-size:0.82rem; color:var(--muted); margin-bottom:1rem; }
  .info-row { display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px solid #0d0f14; font-size:0.78rem; }
  .info-row:last-child { border-bottom:none; }
  .val-muted { color:var(--muted); }
  .badge { padding:0.15rem 0.5rem; border-radius:3px; font-size:0.68rem; }
  .badge-gold { background:rgba(212,175,55,0.15); color:var(--gold); }
  .badge-red { background:rgba(255,68,68,0.15); color:var(--red); }
  .badge-green { background:rgba(0,200,150,0.15); color:var(--green); }
  .badge-blue { background:rgba(74,158,255,0.15); color:var(--blue); }
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-brand">
    <h2>UMBRELLA FINANCIAL</h2>
    <p>Staff Portal</p>
  </div>
  <a href="/dashboard" class="nav-item active">??? Dashboard</a>
  <a href="/logout" class="nav-item" style="color:var(--red)">??? Logout</a>
</div>
<div class="main">
  <h1>Welcome, ${user.username}</h1>
  <p class="sub">// ${user.authMethod} ??? ${user.department || 'No department'}</p>
  ${alerts.join('')}
  <div class="cards">
    <div class="card"><div class="card-val">${user.dbRole}</div><div class="card-label">Role</div></div>
    <div class="card"><div class="card-val">${user.riskScore}</div><div class="card-label">Risk Score</div></div>
    <div class="card"><div class="card-val">${user.loginCount || 0}</div><div class="card-label">Login Count</div></div>
    <div class="card"><div class="card-val">${user.dbActive ? 'Active' : '<span style="color:var(--red)">Inactive</span>'}</div><div class="card-label">Account Status</div></div>
  </div>
  <div class="info-grid">
    <div class="info-box">
      <h3>Account Details</h3>
      <div class="info-row"><span>Username</span><span class="val-muted">${user.username}</span></div>
      <div class="info-row"><span>Email</span><span class="val-muted">${user.email || '???'}</span></div>
      <div class="info-row"><span>Department</span><span class="val-muted">${user.department || '???'}</span></div>
      <div class="info-row"><span>Auth Method</span><span><span class="badge badge-blue">${user.authMethod}</span></span></div>
      <div class="info-row"><span>MFA</span><span>${user.dbMfa ? '<span class="badge badge-green">Enabled</span>' : '<span class="badge badge-red">Disabled</span>'}</span></div>
      <div class="info-row"><span>Last Login</span><span class="val-muted">${user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : '???'}</span></div>
    </div>
    <div class="info-box">
      <h3>Security Posture</h3>
      <div class="info-row"><span>MFA Enforced</span><span><span class="badge badge-red">No</span></span></div>
      <div class="info-row"><span>Rate Limiting</span><span><span class="badge badge-red">Off</span></span></div>
      <div class="info-row"><span>Session Timeout</span><span><span class="badge badge-red">None</span></span></div>
      <div class="info-row"><span>Password Policy</span><span><span class="badge badge-red">Min 4 chars</span></span></div>
      <div class="info-row"><span>IDP</span><span><span class="badge badge-gold">Keycloak + AD DS</span></span></div>
      <div class="info-row"><span>Web Server</span><span><span class="badge badge-blue">IIS 10 / Tomcat</span></span></div>
    </div>
  </div>
</div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`[Umbrella Financial Staff Portal] http://localhost:${PORT}`);
  console.log(`[Staff Portal] Public: ${APP_URL}`);
});
