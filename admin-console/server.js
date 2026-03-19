'use strict';
const express      = require('express');
const crypto       = require('crypto');
const { Pool }     = require('pg');
const http         = require('http');

const app  = express();
const PORT = process.env.PORT || 3011;

// ?????? DB ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'findb',
  user:     process.env.DB_USER     || 'finapp',
  password: process.env.DB_PASS     || 'finapp123',
});

// ?????? Config ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const JAVA_BASE_URL = process.env.SIM_JAVA_BASE_URL || 'http://localhost:8080/umbrella-financial';
const KC_TOKEN_URL  = process.env.KC_TOKEN_URL      || 'http://localhost:8180/realms/umbrella-financial/protocol/openid-connect/token';
const KC_CLIENT_ID  = process.env.KC_CLIENT_ID      || 'fin-sim';
const KC_CLIENT_SECRET = process.env.KC_CLIENT_SECRET || 'fin-sim-secret-2026';
const PORTAL_URL    = process.env.PORTAL_URL        || 'http://localhost:3012';

// ?????? Auth ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const ADMIN_USERS = [
  { username: 'ryan',  password: 'Orchid2026!', name: 'Ryan',  email: 'ryan@orchid.security' },
  { username: 'karin', password: 'Orchid2026!', name: 'Karin', email: 'karin@orchid.security' },
];
const sessions = {};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Not authenticated' });
  req.user = sessions[token];
  next();
}

// ?????? IDP Profiles ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const IDP_PROFILES = {
  local: {
    ips: () => `10.${randInt(0,255)}.${randInt(0,255)}.${randInt(1,254)}`,
    agents: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36'],
    failRate: 0.05,
    failureReasons: ['invalid_credentials','account_locked','password_expired'],
  },
  ldap: {
    ips: () => `10.${randInt(0,10)}.${randInt(0,5)}.${randInt(1,50)}`,
    agents: ['Bloomberg-Terminal/24.1','Reuters-Eikon/4.0','TradingView/3.2','FactSet/2024.1'],
    failRate: 0.08,
    failureReasons: ['ldap_bind_failed','account_disabled','password_expired','invalid_credentials'],
  },
  oauth2: {
    ips: () => `172.${randInt(16,31)}.${randInt(0,255)}.${randInt(1,254)}`,
    agents: ['Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'],
    failRate: 0.04,
    failureReasons: ['token_expired','invalid_grant','mfa_failed','session_timeout'],
  },
  service: {
    ips: () => `10.0.${randInt(1,5)}.${randInt(1,50)}`,
    agents: ['TradingEngine/4.2.1','BatchProcessor/2.0','SWIFTGateway/3.1','AlgoTrader/1.0'],
    failRate: 0.02,
    failureReasons: ['invalid_service_credentials','service_disabled'],
  },
};
const DEFAULT_PROFILE = IDP_PROFILES.local;

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ?????? SSE Live Feed ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const sseClients = new Set();
function broadcastLogin(row) {
  const data = JSON.stringify(row);
  for (const client of sseClients) {
    try { client.res.write(`data: ${data}\n\n`); } catch {}
  }
}

// ?????? Flow functions ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
async function flowJava(endpoint, body, ip, ua) {
  try {
    const res = await fetch(`${JAVA_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': ua },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    return { httpSuccess: res.ok };
  } catch (e) {
    console.error(`[SIM] Java call failed (${endpoint}): ${e.message}`);
    return { httpSuccess: false };
  }
}

async function flowKC(user, success, ip, ua, idpSource) {
  try {
    const password = success ? user.password_cleartext : 'bad_password_123';
    const params = new URLSearchParams({
      grant_type: 'password', client_id: KC_CLIENT_ID, client_secret: KC_CLIENT_SECRET,
      username: user.username, password, scope: 'openid profile email',
    });
    const res = await fetch(KC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip, 'User-Agent': ua, 'X-IdP-Source': idpSource },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok };
  } catch (e) {
    console.error(`[SIM] KC flow failed for ${user.username}: ${e.message}`);
    return { ok: false };
  }
}

async function flowPortal(user, success, ip, ua) {
  try {
    const password = success ? user.password_cleartext : 'bad_password_123';
    const params = new URLSearchParams({ username: user.username, password });
    const res = await fetch(`${PORTAL_URL}/fallback-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip, 'User-Agent': ua },
      body: params.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const location = res.headers.get('location') || '';
    return { httpSuccess: location.includes('/dashboard') };
  } catch (e) {
    console.error(`[SIM] Portal fallback failed for ${user.username}: ${e.message}`);
    return { httpSuccess: false };
  }
}

// ?????? Core simulation ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
async function generateOneLogin(user, opts = {}) {
  const idp = (user.idp_source || 'local').toLowerCase();
  const acct = (user.account_type || 'human').toLowerCase();
  const profile = IDP_PROFILES[idp] || DEFAULT_PROFILE;
  const ip = profile.ips();
  const ua = pick(profile.agents);
  const failRate = opts.failRate !== undefined ? opts.failRate : profile.failRate;
  const success = Math.random() > failRate;
  const ts = new Date();
  let failure_reason = success ? null : pick(profile.failureReasons);

  try {
    if (idp === 'oauth2') {
      // Real KC token exchange for oauth2 users (executives, compliance, wealth, risk)
      await flowKC(user, success, ip, ua, 'oauth2');

    } else if (idp === 'ldap') {
      // Real LDAP auth via Java endpoint (which hits AD)
      await flowJava('/api/auth/ldap', {
        username: user.username,
        password: success ? user.password_cleartext : 'bad_password_123'
      }, ip, ua);

    } else if (acct === 'service') {
      // Service account auth via Java
      await flowJava('/api/auth/service', {
        service_id: user.username,
        service_secret: success ? user.password_cleartext : 'bad_secret'
      }, ip, ua);

    } else {
      // Local ??? hit both Tomcat form login AND staff portal fallback
      await Promise.all([
        flowJava('/api/auth/login', {
          username: user.username,
          password: success ? user.password_cleartext : 'bad_password_123'
        }, ip, ua),
        flowPortal(user, success, ip, ua),
      ]);
    }
  } catch (e) {
    console.error(`[SIM] Flow error for ${user.username}: ${e.message}`);
  }

  // Always write to login_history_fin
  const row = { username: user.username, idp_source: idp, ip_address: ip, user_agent: ua, success, failure_reason, created_at: ts };
  try {
    await pool.query(
      `INSERT INTO login_history_fin (username, idp_source, ip_address, user_agent, success, failure_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.username, row.idp_source, row.ip_address, row.user_agent, row.success, row.failure_reason, row.created_at]
    );
  } catch (err) {
    console.error(`[SIM] DB insert failed: ${err.message}`);
  }

  broadcastLogin(row);
  return row;
}

// ?????? Continuous simulation ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
let continuousInterval = null;
let continuousConfig = { intervalMs: 5000, burstMin: 1, burstMax: 3 };

// ?????? Routes: Auth ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const found = ADMIN_USERS.find(u => u.username === username && u.password === password);
  if (found) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = { username: found.username, name: found.name, email: found.email, loginAt: new Date().toISOString() };
    return res.json({ token, user: { username: found.username, name: found.name, email: found.email } });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) delete sessions[token];
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions[token]) return res.json(sessions[token]);
  res.status(401).json({ error: 'Not authenticated' });
});

// ?????? Routes: Data ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('/api/users', authMiddleware, async (req, res) => {
  const r = await pool.query(
    `SELECT id, username, email, role, department, active, mfa_enabled, idp_source,
            account_type, risk_score, login_count, last_login, password_changed_at
     FROM users_fin ORDER BY risk_score DESC LIMIT 200`
  );
  res.json({ count: r.rows.length, users: r.rows });
});

app.get('/api/stats', authMiddleware, async (req, res) => {
  const [total, mfa, active, stale, loginCount, idpBreakdown] = await Promise.all([
    pool.query('SELECT COUNT(*) as cnt FROM users_fin'),
    pool.query('SELECT COUNT(*) as cnt FROM users_fin WHERE mfa_enabled = true'),
    pool.query('SELECT COUNT(*) as cnt FROM users_fin WHERE active = true'),
    pool.query('SELECT COUNT(*) as cnt FROM users_fin WHERE active = false'),
    pool.query('SELECT COUNT(*) as cnt FROM login_history_fin WHERE created_at > NOW() - INTERVAL \'24 hours\''),
    pool.query('SELECT idp_source, COUNT(*) as cnt FROM users_fin WHERE active = true GROUP BY idp_source ORDER BY cnt DESC'),
  ]);
  res.json({
    totalUsers:   parseInt(total.rows[0].cnt),
    mfaEnabled:   parseInt(mfa.rows[0].cnt),
    activeUsers:  parseInt(active.rows[0].cnt),
    staleAccounts:parseInt(stale.rows[0].cnt),
    loginsToday:  parseInt(loginCount.rows[0].cnt),
    idpBreakdown: idpBreakdown.rows,
    mfaRate:      ((mfa.rows[0].cnt / total.rows[0].cnt) * 100).toFixed(1) + '%',
  });
});

app.get('/api/login-history', authMiddleware, async (req, res) => {
  const r = await pool.query(
    `SELECT username, idp_source, success, failure_reason, ip_address, created_at
     FROM login_history_fin ORDER BY created_at DESC LIMIT 200`
  );
  res.json({ count: r.rows.length, logs: r.rows });
});

app.get('/api/accounts', authMiddleware, async (req, res) => {
  const r = await pool.query('SELECT * FROM accounts_fin LIMIT 50');
  res.json({ count: r.rows.length, accounts: r.rows });
});

// ?????? Routes: Simulate ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.post('/api/simulate/login', authMiddleware, async (req, res) => {
  const { count, idp_sources, include_failures, failure_rate } = req.body;
  const n = Math.min(count || 10, 500);
  const filterSources = idp_sources?.length ? new Set(idp_sources) : null;

  const users = (await pool.query(
    `SELECT id, username, password_cleartext, idp_source, account_type FROM users_fin WHERE active = true`
  )).rows.filter(u => !filterSources || filterSources.has(u.idp_source));

  if (users.length === 0) return res.status(400).json({ error: 'No users matching selected IDP sources' });

  const rows = [];
  for (let i = 0; i < n; i++) {
    const user = pick(users);
    const row = await generateOneLogin(user, { failRate: include_failures ? (failure_rate || 0.15) : 0 });
    rows.push(row);
  }

  const byIdp = rows.reduce((acc, r) => { acc[r.idp_source] = (acc[r.idp_source] || 0) + 1; return acc; }, {});
  res.json({ inserted: rows.length, byIdp, failures: rows.filter(r => !r.success).length });
});

app.post('/api/simulate/start', authMiddleware, (req, res) => {
  const { intervalMs, burstMin, burstMax } = req.body;
  continuousConfig = {
    intervalMs: intervalMs || 5000,
    burstMin: burstMin || 1,
    burstMax: burstMax || 3,
  };
  if (continuousInterval) clearInterval(continuousInterval);
  continuousInterval = setInterval(async () => {
    const burst = randInt(continuousConfig.burstMin, continuousConfig.burstMax);
    const users = (await pool.query(
      `SELECT id, username, password_cleartext, idp_source, account_type FROM users_fin WHERE active = true ORDER BY RANDOM() LIMIT ${burst}`
    )).rows;
    for (const user of users) {
      await generateOneLogin(user);
    }
  }, continuousConfig.intervalMs);
  res.json({ ok: true, config: continuousConfig });
});

app.post('/api/simulate/stop', authMiddleware, (req, res) => {
  if (continuousInterval) { clearInterval(continuousInterval); continuousInterval = null; }
  res.json({ ok: true });
});

app.get('/api/simulate/status', authMiddleware, (req, res) => {
  res.json({ running: !!continuousInterval, config: continuousConfig });
});

// ?????? SSE Live Feed ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('/api/live-feed', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const client = { id: Date.now(), res };
  sseClients.add(client);
  req.on('close', () => sseClients.delete(client));
});

// ?????? UI ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.get('*', (req, res) => {
  if (!req.headers.authorization && req.path !== '/') {
    return res.redirect('/');
  }
  res.send(renderUI());
});

function renderUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Umbrella Financial ??? Admin Console</title>
<style>
  :root { --bg:#0a0c10; --panel:#111318; --border:#1e2330; --green:#00c896; --red:#ff4444; --yellow:#f5a623; --blue:#4a9eff; --text:#e8eaf0; --muted:#6b7280; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'SF Mono',Monaco,monospace; min-height:100vh; }
  #app { display:none; }
  /* Login */
  #login-screen { display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .login-box { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:2.5rem; width:360px; }
  .login-box h1 { font-size:1.1rem; color:var(--green); margin-bottom:0.25rem; }
  .login-box p { color:var(--muted); font-size:0.75rem; margin-bottom:1.5rem; }
  .login-box input { width:100%; background:#0a0a0a; border:1px solid var(--border); color:var(--text); padding:0.6rem 0.75rem; border-radius:4px; font-family:monospace; font-size:0.85rem; margin-bottom:0.75rem; }
  .login-box button { width:100%; background:var(--green); color:#000; border:none; padding:0.7rem; border-radius:4px; font-family:monospace; font-size:0.9rem; cursor:pointer; font-weight:bold; }
  .err { color:var(--red); font-size:0.8rem; margin-top:0.5rem; }
  /* Layout */
  .layout { display:grid; grid-template-columns:220px 1fr; min-height:100vh; }
  .sidebar { background:var(--panel); border-right:1px solid var(--border); padding:1.5rem 0; }
  .sidebar-brand { padding:0 1.25rem 1.5rem; border-bottom:1px solid var(--border); margin-bottom:1rem; }
  .sidebar-brand h2 { font-size:0.9rem; color:var(--green); }
  .sidebar-brand p { font-size:0.7rem; color:var(--muted); margin-top:0.25rem; }
  .nav-item { display:block; padding:0.6rem 1.25rem; color:var(--muted); font-size:0.8rem; cursor:pointer; border-left:2px solid transparent; }
  .nav-item:hover { color:var(--text); background:rgba(255,255,255,0.03); }
  .nav-item.active { color:var(--green); border-left-color:var(--green); background:rgba(0,200,150,0.05); }
  .main { padding:2rem; overflow-y:auto; }
  .page { display:none; }
  .page.active { display:block; }
  h1.page-title { font-size:1.1rem; color:var(--text); margin-bottom:0.25rem; }
  p.page-sub { color:var(--muted); font-size:0.75rem; margin-bottom:1.5rem; }
  /* Cards */
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:1rem; margin-bottom:2rem; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:1rem; }
  .card-val { font-size:1.6rem; font-weight:bold; color:var(--green); }
  .card-val.red { color:var(--red); }
  .card-val.yellow { color:var(--yellow); }
  .card-label { font-size:0.7rem; color:var(--muted); margin-top:0.25rem; }
  /* Tables */
  .table-wrap { background:var(--panel); border:1px solid var(--border); border-radius:6px; overflow:hidden; margin-bottom:1.5rem; }
  table { width:100%; border-collapse:collapse; font-size:0.78rem; }
  th { background:#0d0f14; color:var(--muted); padding:0.6rem 0.75rem; text-align:left; font-weight:normal; border-bottom:1px solid var(--border); }
  td { padding:0.5rem 0.75rem; border-bottom:1px solid #0d0f14; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:rgba(255,255,255,0.02); }
  .badge { padding:0.15rem 0.5rem; border-radius:3px; font-size:0.7rem; }
  .badge-green { background:rgba(0,200,150,0.15); color:var(--green); }
  .badge-red { background:rgba(255,68,68,0.15); color:var(--red); }
  .badge-yellow { background:rgba(245,166,35,0.15); color:var(--yellow); }
  .badge-blue { background:rgba(74,158,255,0.15); color:var(--blue); }
  /* Simulator */
  .sim-panel { background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:1.5rem; margin-bottom:1.5rem; }
  .sim-panel h3 { font-size:0.9rem; color:var(--text); margin-bottom:1rem; }
  .sim-controls { display:flex; gap:1rem; align-items:flex-end; flex-wrap:wrap; margin-bottom:1rem; }
  .control-group { display:flex; flex-direction:column; gap:0.35rem; }
  .control-group label { font-size:0.72rem; color:var(--muted); }
  .control-group input, .control-group select { background:#0a0a0a; border:1px solid var(--border); color:var(--text); padding:0.45rem 0.6rem; border-radius:4px; font-family:monospace; font-size:0.82rem; min-width:100px; }
  .btn { padding:0.5rem 1rem; border:none; border-radius:4px; font-family:monospace; font-size:0.82rem; cursor:pointer; }
  .btn-green { background:var(--green); color:#000; font-weight:bold; }
  .btn-red { background:var(--red); color:#fff; }
  .btn-blue { background:var(--blue); color:#fff; }
  .btn-ghost { background:transparent; border:1px solid var(--border); color:var(--muted); }
  .btn:hover { opacity:0.85; }
  /* Live feed */
  .live-feed { background:#050507; border:1px solid var(--border); border-radius:6px; padding:1rem; height:320px; overflow-y:auto; font-size:0.72rem; }
  .feed-entry { padding:0.25rem 0; border-bottom:1px solid #0d0f14; display:flex; gap:0.75rem; }
  .feed-entry.fail { color:var(--red); }
  .feed-entry.ok { color:var(--green); }
  .feed-ts { color:var(--muted); min-width:80px; }
  .idp-tags { display:flex; gap:0.5rem; flex-wrap:wrap; }
  .idp-tag { padding:0.2rem 0.6rem; border:1px solid var(--border); border-radius:3px; font-size:0.72rem; cursor:pointer; color:var(--muted); }
  .idp-tag.selected { border-color:var(--green); color:var(--green); background:rgba(0,200,150,0.1); }
  .result-box { background:#050507; border:1px solid var(--border); border-radius:4px; padding:0.75rem; font-size:0.78rem; color:var(--green); min-height:40px; }
  /* Auth flows display */
  .flow-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:1rem; }
  .flow-card { background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:1rem; }
  .flow-card h4 { font-size:0.82rem; color:var(--text); margin-bottom:0.5rem; }
  .flow-detail { font-size:0.72rem; color:var(--muted); line-height:1.6; }
  .flow-detail .warn { color:var(--red); }
</style>
</head>
<body>

<!-- Login -->
<div id="login-screen">
  <div class="login-box">
    <h1>Umbrella Financial</h1>
    <p>// admin console ??? restricted access</p>
    <input type="text" id="login-user" placeholder="username" />
    <input type="password" id="login-pass" placeholder="password" />
    <button onclick="doLogin()">??? Sign In</button>
    <div class="err" id="login-err"></div>
  </div>
</div>

<!-- App -->
<div id="app">
  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-brand">
        <h2>Umbrella Financial</h2>
        <p>Admin Console v1.0</p>
      </div>
      <div class="nav-item active" onclick="showPage('dashboard')">??? Dashboard</div>
      <div class="nav-item" onclick="showPage('simulator')">??? Simulator</div>
      <div class="nav-item" onclick="showPage('users')">??? Users</div>
      <div class="nav-item" onclick="showPage('accounts')">??? Accounts</div>
      <div class="nav-item" onclick="showPage('audit')">??? Audit Log</div>
      <div class="nav-item" onclick="showPage('auth-flows')">??? Auth Flows</div>
      <div class="nav-item" onclick="doLogout()" style="margin-top:auto;color:var(--red)">??? Logout</div>
    </div>
    <div class="main">

      <!-- Dashboard -->
      <div id="page-dashboard" class="page active">
        <h1 class="page-title">System Dashboard</h1>
        <p class="page-sub">// umbrella-financial ??? real-time identity posture</p>
        <div class="cards" id="stat-cards">
          <div class="card"><div class="card-val" id="stat-total">???</div><div class="card-label">Total Users</div></div>
          <div class="card"><div class="card-val yellow" id="stat-mfa">???</div><div class="card-label">MFA Rate</div></div>
          <div class="card"><div class="card-val red" id="stat-stale">???</div><div class="card-label">Stale Accounts</div></div>
          <div class="card"><div class="card-val" id="stat-logins">???</div><div class="card-label">Logins (24h)</div></div>
          <div class="card"><div class="card-val red">OFF</div><div class="card-label">MFA Enforced</div></div>
          <div class="card"><div class="card-val red">OFF</div><div class="card-label">Rate Limiting</div></div>
        </div>
        <h3 style="font-size:0.85rem;color:var(--muted);margin-bottom:0.75rem">Live Login Feed</h3>
        <div class="live-feed" id="live-feed"><div style="color:var(--muted)">// waiting for events...</div></div>
      </div>

      <!-- Simulator -->
      <div id="page-simulator" class="page">
        <h1 class="page-title">Login Simulator</h1>
        <p class="page-sub">// generate real auth traffic across all flows</p>

        <div class="sim-panel">
          <h3>Manual Burst</h3>
          <div class="sim-controls">
            <div class="control-group">
              <label>Login count</label>
              <input type="number" id="sim-count" value="10" min="1" max="500" style="width:80px"/>
            </div>
            <div class="control-group">
              <label>Include failures</label>
              <select id="sim-failures">
                <option value="false">No</option>
                <option value="true">Yes (15%)</option>
              </select>
            </div>
            <button class="btn btn-green" onclick="runSimulate()">??? Run Burst</button>
          </div>
          <div class="control-group" style="margin-bottom:1rem">
            <label>Filter by IDP source</label>
            <div class="idp-tags">
              <div class="idp-tag selected" data-idp="local" onclick="toggleIdp(this)">local</div>
              <div class="idp-tag selected" data-idp="ldap" onclick="toggleIdp(this)">ldap / AD</div>
              <div class="idp-tag selected" data-idp="oauth2" onclick="toggleIdp(this)">oauth2</div>
              <div class="idp-tag selected" data-idp="service" onclick="toggleIdp(this)">service</div>
            </div>
          </div>
          <div class="result-box" id="sim-result">// results will appear here</div>
        </div>

        <div class="sim-panel">
          <h3>Continuous Simulation</h3>
          <div class="sim-controls">
            <div class="control-group">
              <label>Interval (ms)</label>
              <input type="number" id="cont-interval" value="5000" min="1000" style="width:100px"/>
            </div>
            <div class="control-group">
              <label>Burst min</label>
              <input type="number" id="cont-burst-min" value="1" min="1" style="width:70px"/>
            </div>
            <div class="control-group">
              <label>Burst max</label>
              <input type="number" id="cont-burst-max" value="3" min="1" style="width:70px"/>
            </div>
            <button class="btn btn-green" onclick="startContinuous()">??? Start</button>
            <button class="btn btn-red" onclick="stopContinuous()">??? Stop</button>
            <span id="cont-status" style="font-size:0.75rem;color:var(--muted);align-self:center"></span>
          </div>
        </div>
      </div>

      <!-- Users -->
      <div id="page-users" class="page">
        <h1 class="page-title">User Registry</h1>
        <p class="page-sub">// users_fin ??? all identities</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Username</th><th>Role</th><th>Department</th><th>IDP</th><th>MFA</th><th>Risk</th><th>Status</th><th>Last Login</th></tr></thead>
            <tbody id="users-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Accounts -->
      <div id="page-accounts" class="page">
        <h1 class="page-title">Banking Accounts</h1>
        <p class="page-sub">// accounts_fin ??? PII exposure demo</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Account #</th><th>Holder</th><th>Type</th><th>Balance</th><th>SSN</th><th>Card #</th></tr></thead>
            <tbody id="accounts-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Audit -->
      <div id="page-audit" class="page">
        <h1 class="page-title">Audit Log</h1>
        <p class="page-sub">// login_history_fin ??? last 200 events</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Timestamp</th><th>Username</th><th>IDP</th><th>Result</th><th>IP</th><th>Reason</th></tr></thead>
            <tbody id="audit-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Auth Flows -->
      <div id="page-auth-flows" class="page">
        <h1 class="page-title">Authentication Flows</h1>
        <p class="page-sub">// all configured auth methods ??? security posture</p>
        <div class="flow-grid">
          <div class="flow-card">
            <h4>???? Local DB Auth</h4>
            <div class="flow-detail">
              Endpoint: POST /api/auth/login<br>
              Password storage: <span class="warn">cleartext</span><br>
              MFA: <span class="warn">disabled</span><br>
              Rate limit: <span class="warn">none</span><br>
              Users: ~160
            </div>
          </div>
          <div class="flow-card">
            <h4>???? LDAP / Active Directory</h4>
            <div class="flow-detail">
              Endpoint: POST /api/auth/ldap<br>
              Server: AD DS on-prem<br>
              Bind DN: <span class="warn">svc-finapp (exposed)</span><br>
              MFA: <span class="warn">disabled</span><br>
              Users: ~140 traders/analysts
            </div>
          </div>
          <div class="flow-card">
            <h4>??? OAuth2 / OIDC</h4>
            <div class="flow-detail">
              Provider: Keycloak<br>
              Grant: Authorization Code<br>
              MFA: partial (execs only)<br>
              Token expiry: <span class="warn">never</span><br>
              Users: ~50 execs/compliance
            </div>
          </div>
          <div class="flow-card">
            <h4>???? HTTP Basic Auth</h4>
            <div class="flow-detail">
              Endpoint: POST /api/auth/basic<br>
              Encoding: Base64 only<br>
              Encryption: <span class="warn">none (HTTP)</span><br>
              MFA: <span class="warn">N/A</span><br>
              Legacy endpoints only
            </div>
          </div>
          <div class="flow-card">
            <h4>???? Service Accounts</h4>
            <div class="flow-detail">
              Endpoint: POST /api/auth/service<br>
              Auth: cleartext secret<br>
              Rotation: <span class="warn">never</span><br>
              Shared: <span class="warn">yes (FX desk)</span><br>
              Count: 10 service accounts
            </div>
          </div>
          <div class="flow-card">
            <h4>??????? API Keys</h4>
            <div class="flow-detail">
              Master key: exposed in /health<br>
              Trading key: <span class="warn">not rotated</span><br>
              Reporting key: <span class="warn">not rotated</span><br>
              Scope enforcement: <span class="warn">none</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
let TOKEN = null;
let selectedIdps = new Set(['local','ldap','oauth2','service']);
let eventSource = null;

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + TOKEN } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

async function doLogin() {
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  const r = await fetch('/api/auth/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username, password })
  }).then(r=>r.json());
  if (r.token) {
    TOKEN = r.token;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadDashboard();
    startLiveFeed();
  } else {
    document.getElementById('login-err').textContent = 'Invalid credentials';
  }
}

async function doLogout() {
  await api('POST', '/api/auth/logout');
  TOKEN = null;
  location.reload();
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'users') loadUsers();
  if (name === 'audit') loadAudit();
  if (name === 'accounts') loadAccounts();
}

async function loadDashboard() {
  const s = await api('GET', '/api/stats');
  document.getElementById('stat-total').textContent = s.totalUsers;
  document.getElementById('stat-mfa').textContent = s.mfaRate;
  document.getElementById('stat-stale').textContent = s.staleAccounts;
  document.getElementById('stat-logins').textContent = s.loginsToday;
}

function startLiveFeed() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/live-feed');
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    const feed = document.getElementById('live-feed');
    const entry = document.createElement('div');
    entry.className = 'feed-entry ' + (data.success ? 'ok' : 'fail');
    const ts = new Date(data.created_at).toLocaleTimeString();
    entry.innerHTML = '<span class="feed-ts">' + ts + '</span>' +
      '<span>' + (data.success ? '???' : '???') + '</span>' +
      '<span>' + data.username + '</span>' +
      '<span style="color:var(--muted)">[' + data.idp_source + ']</span>' +
      (data.failure_reason ? '<span style="color:var(--red)">' + data.failure_reason + '</span>' : '') +
      '<span style="color:var(--muted)">' + data.ip_address + '</span>';
    if (feed.firstChild?.textContent?.includes('waiting')) feed.innerHTML = '';
    feed.insertBefore(entry, feed.firstChild);
    if (feed.children.length > 100) feed.removeChild(feed.lastChild);
  };
}

async function loadUsers() {
  const data = await api('GET', '/api/users');
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = data.users.map(u => {
    const riskClass = u.risk_score > 70 ? 'red' : u.risk_score > 40 ? 'yellow' : 'green';
    const lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString() : '???';
    return '<tr>' +
      '<td style="font-family:monospace">' + u.username + '</td>' +
      '<td><span class="badge badge-blue">' + u.role + '</span></td>' +
      '<td style="color:var(--muted)">' + (u.department||'???') + '</td>' +
      '<td><span class="badge badge-blue">' + u.idp_source + '</span></td>' +
      '<td>' + (u.mfa_enabled ? '<span class="badge badge-green">ON</span>' : '<span class="badge badge-red">OFF</span>') + '</td>' +
      '<td><span class="badge badge-' + riskClass + '">' + u.risk_score + '</span></td>' +
      '<td>' + (u.active ? '<span class="badge badge-green">active</span>' : '<span class="badge badge-red">inactive</span>') + '</td>' +
      '<td style="color:var(--muted)">' + lastLogin + '</td>' +
      '</tr>';
  }).join('');
}

async function loadAccounts() {
  const data = await api('GET', '/api/accounts');
  const tbody = document.getElementById('accounts-tbody');
  tbody.innerHTML = data.accounts.map(a => {
    return '<tr>' +
      '<td style="font-family:monospace;color:var(--yellow)">' + a.account_number + '</td>' +
      '<td>' + a.holder_first_name + ' ' + a.holder_last_name + '</td>' +
      '<td><span class="badge badge-blue">' + a.account_type + '</span></td>' +
      '<td style="color:var(--green)">$' + parseFloat(a.balance||0).toLocaleString() + '</td>' +
      '<td style="color:var(--red)">' + (a.ssn_plaintext||'???') + '</td>' +
      '<td style="font-family:monospace;color:var(--muted)">' + (a.credit_card_number||'???') + '</td>' +
      '</tr>';
  }).join('');
}

async function loadAudit() {
  const data = await api('GET', '/api/login-history');
  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = data.logs.map(l => {
    const ts = new Date(l.created_at).toLocaleString();
    return '<tr>' +
      '<td style="color:var(--muted)">' + ts + '</td>' +
      '<td style="font-family:monospace">' + l.username + '</td>' +
      '<td><span class="badge badge-blue">' + l.idp_source + '</span></td>' +
      '<td>' + (l.success ? '<span class="badge badge-green">success</span>' : '<span class="badge badge-red">failed</span>') + '</td>' +
      '<td style="color:var(--muted)">' + (l.ip_address||'???') + '</td>' +
      '<td style="color:var(--red)">' + (l.failure_reason||'') + '</td>' +
      '</tr>';
  }).join('');
}

function toggleIdp(el) {
  const idp = el.dataset.idp;
  if (selectedIdps.has(idp)) { selectedIdps.delete(idp); el.classList.remove('selected'); }
  else { selectedIdps.add(idp); el.classList.add('selected'); }
}

async function runSimulate() {
  const count = parseInt(document.getElementById('sim-count').value);
  const failures = document.getElementById('sim-failures').value === 'true';
  document.getElementById('sim-result').textContent = '// running...';
  const r = await api('POST', '/api/simulate/login', {
    count, idp_sources: [...selectedIdps], include_failures: failures, failure_rate: 0.15
  });
  document.getElementById('sim-result').textContent =
    '// inserted: ' + r.inserted + ' | failures: ' + r.failures + ' | by IDP: ' + JSON.stringify(r.byIdp);
}

async function startContinuous() {
  const r = await api('POST', '/api/simulate/start', {
    intervalMs: parseInt(document.getElementById('cont-interval').value),
    burstMin:   parseInt(document.getElementById('cont-burst-min').value),
    burstMax:   parseInt(document.getElementById('cont-burst-max').value),
  });
  document.getElementById('cont-status').textContent = r.ok ? '??? running' : 'error';
}

async function stopContinuous() {
  await api('POST', '/api/simulate/stop');
  document.getElementById('cont-status').textContent = '??? stopped';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});
</script>
</body>
</html>`;
}

// ?????? Start ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
app.listen(PORT, () => {
  console.log(`[Umbrella Financial Admin] http://localhost:${PORT}`);
});
