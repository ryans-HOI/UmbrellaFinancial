-- ============================================================
-- Umbrella Financial Systems — Seed Data
-- IDP Sources: OAuth2 (KC), LDAP (AD), Local
-- Personas: Traders, Analysts, Compliance, Retail, Wealth, Exec, Customers
-- ============================================================

-- ── Schema ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_fin (
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(50) UNIQUE NOT NULL,
    password_cleartext  VARCHAR(255) NOT NULL,
    email               VARCHAR(255),
    role                VARCHAR(50) DEFAULT 'viewer',
    department          VARCHAR(100),
    active              BOOLEAN DEFAULT true,
    mfa_enabled         BOOLEAN DEFAULT false,
    last_login          TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    idp_source          VARCHAR(50) DEFAULT 'local',
    account_type        VARCHAR(20) DEFAULT 'human',
    risk_score          INTEGER DEFAULT 0,
    login_count         INTEGER DEFAULT 0,
    deactivate_at       TIMESTAMP,
    password_changed_at TIMESTAMP,
    security_demo       TEXT DEFAULT 'cleartext'
);

CREATE TABLE IF NOT EXISTS accounts_fin (
    id               BIGSERIAL PRIMARY KEY,
    account_number   VARCHAR(20) UNIQUE NOT NULL,
    routing_number   VARCHAR(9),
    holder_first_name VARCHAR(100),
    holder_last_name  VARCHAR(100),
    ssn_plaintext    VARCHAR(11),
    account_type     VARCHAR(20),
    balance          NUMERIC(15,2),
    credit_card_number VARCHAR(19),
    credit_card_cvv  VARCHAR(4),
    email            VARCHAR(255),
    phone            VARCHAR(20),
    created_at       TIMESTAMP DEFAULT NOW(),
    risk_flag        BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS login_history_fin (
    id             BIGSERIAL PRIMARY KEY,
    username       VARCHAR(50),
    idp_source     VARCHAR(50),
    success        BOOLEAN,
    failure_reason VARCHAR(100),
    ip_address     VARCHAR(45),
    user_agent     TEXT,
    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups_fin (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members_fin (
    id         SERIAL PRIMARY KEY,
    group_id   INTEGER REFERENCES groups_fin(id),
    user_id    BIGINT REFERENCES users_fin(id),
    username   TEXT,
    added_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_permissions_fin (
    id         SERIAL PRIMARY KEY,
    group_id   INTEGER REFERENCES groups_fin(id),
    permission TEXT
);

-- ── Truncate for fresh seed ───────────────────────────────────────────────────
TRUNCATE users_fin, accounts_fin, login_history_fin, group_members_fin, group_permissions_fin, groups_fin RESTART IDENTITY CASCADE;

-- ── Helper function ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION random_ts(start_date TIMESTAMP, end_date TIMESTAMP)
RETURNS TIMESTAMP AS $$
BEGIN
    RETURN start_date + random() * (end_date - start_date);
END;
$$ LANGUAGE plpgsql;

-- ── Admin / IT Users (local auth) ────────────────────────────────────────────
INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, password_changed_at) VALUES
('fin.admin',        'admin123',         'admin@umbrella-financial.com',       'admin',          'IT',         true,  false, 'local', 'human',   95, '2023-01-15'),
('fin.devops',       'D3v0ps!2024',      'devops@umbrella-financial.com',      'admin',          'IT',         true,  false, 'local', 'human',   82, '2024-02-20'),
('fin.sysadmin',     'SysAdm1n!',        'sysadmin@umbrella-financial.com',    'admin',          'IT',         true,  false, 'local', 'human',   88, '2023-08-12'),
('fin.dba',          'DbAdmin2023',      'dba@umbrella-financial.com',         'admin',          'IT',         true,  false, 'local', 'human',   91, '2023-06-01'),
('fin.helpdesk1',    'Help1234',         'helpdesk1@umbrella-financial.com',   'support',        'IT',         true,  false, 'local', 'human',   28, '2025-01-10'),
('fin.helpdesk2',    'Desk5678',         'helpdesk2@umbrella-financial.com',   'support',        'IT',         true,  false, 'local', 'human',   24, '2025-02-14'),
('fin.neteng',       'N3twork!',         'neteng@umbrella-financial.com',      'admin',          'IT',         true,  false, 'local', 'human',   72, '2024-04-22'),
('fin.secops',       'Sec0ps!!',         'secops@umbrella-financial.com',      'admin',          'IT',         false, false, 'local', 'human',   65, '2023-03-01'),
('fin.backup',       'Backup2024',       'backup@umbrella-financial.com',      'admin',          'IT',         true,  false, 'local', 'human',   77, '2024-01-05');

-- ── Service Accounts ─────────────────────────────────────────────────────────
INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, password_changed_at) VALUES
('svc.trading.api',   'trading-api-key-prod-2024',  'svc-trading@umbrella-financial.com',  'service', 'Trading',    true, false, 'local', 'service', 88, '2024-01-01'),
('svc.reporting',     'report-svc-secret-99',        'svc-report@umbrella-financial.com',   'service', 'Reporting',  true, false, 'local', 'service', 82, '2023-09-15'),
('svc.batch.eod',     'batch-eod-nightly-pass',      'svc-batch@umbrella-financial.com',    'service', 'IT',         true, false, 'local', 'service', 91, '2023-05-01'),
('svc.compliance',    'compliance-svc-key!',         'svc-compliance@umbrella-financial.com','service','Compliance', true, false, 'local', 'service', 79, '2024-03-01'),
('svc.audit.export',  'audit-exp-key-fin-77',        'svc-audit@umbrella-financial.com',    'service', 'Compliance', true, false, 'local', 'service', 68, '2024-02-28'),
('svc.swift',         'swift-gateway-key-2024',      'svc-swift@umbrella-financial.com',    'service', 'Payments',   true, false, 'local', 'service', 94, '2023-11-01'),
('svc.fed.wire',      'fedwire-conn-secret-44',      'svc-fedwire@umbrella-financial.com',  'service', 'Payments',   true, false, 'local', 'service', 93, '2023-07-01'),
('svc.monitoring',    'mon-agent-fin-secret',        'svc-mon@umbrella-financial.com',      'service', 'IT',         true, false, 'local', 'service', 61, '2024-08-10'),
('svc.kyc.verify',    'kyc-verify-api-2024',         'svc-kyc@umbrella-financial.com',      'service', 'Compliance', true, false, 'local', 'service', 85, '2024-01-15'),
('svc.fx.engine',     'fx-rate-engine-key99',        'svc-fx@umbrella-financial.com',       'service', 'Trading',    true, false, 'local', 'service', 87, '2023-12-01');

-- ── Executives (OAuth2/KC) ────────────────────────────────────────────────────
INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count) VALUES
('ceo.thornton',     'Thornton!CEO2024', 'ceo@umbrella-financial.com',         'executive', 'Executive',   true, true,  'oauth2', 'human', 42, 48),
('cfo.nakamura',     'Nakamura!CFO9',   'cfo@umbrella-financial.com',         'executive', 'Finance',     true, true,  'oauth2', 'human', 38, 52),
('cro.walsh',        'Walsh!CRO2024',   'cro@umbrella-financial.com',         'executive', 'Risk',        true, true,  'oauth2', 'human', 35, 41),
('ciso.ibrahim',     'Ibrahim!CISO',    'ciso@umbrella-financial.com',        'executive', 'IT',          true, true,  'oauth2', 'human', 31, 37),
('coo.sterling',     'Sterling!COO8',   'coo@umbrella-financial.com',         'executive', 'Operations',  true, false, 'oauth2', 'human', 67, 29),
('vp.trading',       'VPTrade!2024',    'vp.trading@umbrella-financial.com',  'executive', 'Trading',     true, false, 'oauth2', 'human', 71, 33),
('vp.compliance',    'VPComp!2024',     'vp.compliance@umbrella-financial.com','executive','Compliance',  true, true,  'oauth2', 'human', 29, 44),
('vp.retail',        'VPRetail!9',      'vp.retail@umbrella-financial.com',   'executive', 'Retail',      true, false, 'oauth2', 'human', 58, 26);

-- ── Traders (LDAP/AD) ─────────────────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['James','Robert','Michael','David','William','Richard','Joseph','Thomas','Charles','Christopher',
                                 'Daniel','Matthew','Anthony','Mark','Donald','Steven','Paul','Andrew','Kenneth','Joshua',
                                 'Kevin','Brian','George','Timothy','Ronald','Edward','Jason','Jeffrey','Ryan','Jacob'];
    last_names  TEXT[] := ARRAY['Thornton','Walsh','Sterling','Nakamura','Ibrahim','Chen','Patel','Kim','Singh','Wong',
                                 'Mueller','Johansson','Fernandez','Kowalski','Tanaka','Gupta','Petrov','Santos','Hoffman','Novak',
                                 'Andersen','Kapoor','Fitzgerald','Moreau','Takahashi','Okafor','Reyes','Yamamoto','Choudhury','Borg'];
    desks TEXT[] := ARRAY['Equities','Fixed Income','FX','Derivatives','Commodities','Structured Products','Rates','Credit'];
    fn TEXT; ln TEXT; desk TEXT; uname TEXT; email TEXT; i INTEGER;
    pass TEXT; risk INTEGER; mfa BOOLEAN;
BEGIN
    FOR i IN 1..80 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        desk := desks[1 + floor(random() * array_length(desks, 1))::int];
        uname := lower(left(fn,1) || ln || '.trader' || i);
        email := uname || '@umbrella-financial.com';
        pass := 'Trade!' || i;
        risk := 30 + floor(random() * 60)::int;
        mfa := random() < 0.2;
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, pass, email, 'trader', desk || ' Desk', true, mfa, 'ldap', 'human', risk,
            floor(random() * 500)::int, NOW() - (random() * interval '30 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Analysts (LDAP/AD) ───────────────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['Sarah','Emily','Jessica','Ashley','Amanda','Melissa','Stephanie','Rebecca','Laura','Cynthia',
                                 'Amy','Angela','Shirley','Anna','Brenda','Pamela','Emma','Nicole','Helen','Samantha'];
    last_names  TEXT[] := ARRAY['Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Anderson','Taylor',
                                 'Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark'];
    teams TEXT[] := ARRAY['Equity Research','Credit Analysis','Risk Analytics','Quantitative Research','Market Intelligence','Portfolio Analysis'];
    fn TEXT; ln TEXT; team TEXT; uname TEXT; email TEXT; i INTEGER;
    pass TEXT; risk INTEGER;
BEGIN
    FOR i IN 1..60 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        team := teams[1 + floor(random() * array_length(teams, 1))::int];
        uname := lower(left(fn,1) || ln || '.analyst' || i);
        email := uname || '@umbrella-financial.com';
        pass := 'Analyze!' || i;
        risk := 15 + floor(random() * 40)::int;
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, pass, email, 'analyst', team, true, (random() < 0.3), 'ldap', 'human', risk,
            floor(random() * 300)::int, NOW() - (random() * interval '14 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Compliance Officers (OAuth2) ──────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['Karen','Patricia','Linda','Barbara','Margaret','Sandra','Betty','Dorothy','Lisa','Nancy'];
    last_names  TEXT[] := ARRAY['Johnson','Wilson','Moore','Jackson','Martin','Hall','Nelson','Carter','Mitchell','Roberts'];
    fn TEXT; ln TEXT; uname TEXT; email TEXT; i INTEGER;
BEGIN
    FOR i IN 1..20 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        uname := lower(left(fn,1) || ln || '.compliance' || i);
        email := uname || '@umbrella-financial.com';
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, 'Comply!' || i, email, 'compliance_officer', 'Compliance', true, (random() < 0.6), 'oauth2', 'human',
            10 + floor(random() * 25)::int, floor(random() * 200)::int, NOW() - (random() * interval '7 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Retail Bankers (Local) ───────────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['John','Mary','James','Jennifer','Charles','Elizabeth','George','Patricia','Edward','Susan'];
    last_names  TEXT[] := ARRAY['Adams','Baker','Clark','Davis','Evans','Foster','Green','Harris','Jones','King'];
    branches TEXT[] := ARRAY['Downtown Branch','Westside Branch','Airport Branch','Midtown Branch','Suburban Branch','Online Banking'];
    fn TEXT; ln TEXT; branch TEXT; uname TEXT; email TEXT; i INTEGER;
BEGIN
    FOR i IN 1..50 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        branch := branches[1 + floor(random() * array_length(branches, 1))::int];
        uname := lower(left(fn,1) || ln || '.retail' || i);
        email := uname || '@umbrella-financial.com';
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, 'Bank!' || i, email, 'retail_banker', branch, true, (random() < 0.2), 'local', 'human',
            10 + floor(random() * 30)::int, floor(random() * 150)::int, NOW() - (random() * interval '3 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Loan Officers (Local) ────────────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['Robert','Linda','Michael','Barbara','William','Carol','David','Ruth','Richard','Sharon'];
    last_names  TEXT[] := ARRAY['Lewis','Lee','Walker','Hall','Allen','Young','Hernandez','King','Wright','Scott'];
    fn TEXT; ln TEXT; uname TEXT; email TEXT; i INTEGER;
BEGIN
    FOR i IN 1..30 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        uname := lower(left(fn,1) || ln || '.loans' || i);
        email := uname || '@umbrella-financial.com';
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, 'Loan!' || i, email, 'loan_officer', 'Lending', true, (random() < 0.25), 'local', 'human',
            15 + floor(random() * 35)::int, floor(random() * 120)::int, NOW() - (random() * interval '5 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Wealth Managers (OAuth2) ─────────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['Alexander','Victoria','Sebastian','Natalie','Harrison','Olivia','Maxwell','Charlotte','Theodore','Eleanor'];
    last_names  TEXT[] := ARRAY['Pemberton','Harrington','Whitmore','Ashford','Blackwell','Caldwell','Dunmore','Fairfax','Grantham','Huxley'];
    fn TEXT; ln TEXT; uname TEXT; email TEXT; i INTEGER;
BEGIN
    FOR i IN 1..25 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        uname := lower(left(fn,1) || ln || '.wealth' || i);
        email := uname || '@umbrella-financial.com';
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, 'Wealth!' || i, email, 'wealth_manager', 'Private Banking', true, (random() < 0.5), 'oauth2', 'human',
            20 + floor(random() * 40)::int, floor(random() * 250)::int, NOW() - (random() * interval '2 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Risk Officers (OAuth2) ────────────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['Marcus','Diana','Felix','Ingrid','Leon','Petra','Stefan','Ursula','Viktor','Xenia'];
    last_names  TEXT[] := ARRAY['Mueller','Schreiber','Hoffmann','Wagner','Schmidt','Fischer','Weber','Meyer','Schulz','Bauer'];
    fn TEXT; ln TEXT; uname TEXT; email TEXT; i INTEGER;
BEGIN
    FOR i IN 1..20 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        uname := lower(left(fn,1) || ln || '.risk' || i);
        email := uname || '@umbrella-financial.com';
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, 'Risk!' || i, email, 'risk_officer', 'Risk Management', true, (random() < 0.4), 'oauth2', 'human',
            18 + floor(random() * 35)::int, floor(random() * 180)::int, NOW() - (random() * interval '4 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Stale / Dormant Accounts (inactive) ──────────────────────────────────────
INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, last_login, deactivate_at) VALUES
('j.sterling.old',   'Sterling123',    'j.sterling@umbrella-financial.com',   'trader',          'Equities Desk',   false, false, 'ldap',   'human', 89, NOW() - interval '280 days', NOW() - interval '90 days'),
('m.chase.ex',       'Chase!2022',     'm.chase@umbrella-financial.com',       'wealth_manager',  'Private Banking', false, false, 'oauth2', 'human', 76, NOW() - interval '320 days', NOW() - interval '120 days'),
('vendor.bloomex',   'BloomEx!2023',   'vendor.bloomex@umbrella-financial.com','vendor',          'Trading',         false, false, 'local',  'human', 92, NOW() - interval '240 days', NOW() - interval '60 days'),
('contractor.finrsk','FinRsk!2022',    'c.finrsk@umbrella-financial.com',      'risk_officer',    'Risk Management', false, false, 'local',  'human', 84, NOW() - interval '365 days', NOW() - interval '180 days'),
('shared.trading.1', 'Shared!Trade1',  'shared1@umbrella-financial.com',       'trader',          'Equities Desk',   false, false, 'ldap',   'human', 97, NOW() - interval '180 days', NOW() - interval '45 days');

-- ── Customers (local, personal emails) ───────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['James','Maria','Robert','Linda','David','Susan','Carlos','Patricia','Thomas','Angela',
                                 'Michael','Jennifer','Kevin','Grace','Brian','Sandra','Daniel','Dorothy','Matthew','Melissa'];
    last_names  TEXT[] := ARRAY['Whitfield','Santos','Nguyen','Okafor','Chen','Park','Mendez','Baker','Ross','Williams',
                                 'Johnson','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas','Jackson'];
    email_domains TEXT[] := ARRAY['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com'];
    fn TEXT; ln TEXT; uname TEXT; email TEXT; i INTEGER; risk INTEGER;
BEGIN
    FOR i IN 1..100 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        uname := lower(fn || '.' || ln || i);
        email := lower(fn) || '.' || lower(ln) || floor(random()*99)::text || '@' || email_domains[1 + floor(random() * 5)::int];
        risk := 2 + floor(random() * 20)::int;
        INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, login_count, last_login)
        VALUES (uname, 'Cust!' || i, email, 'customer', 'Retail', true, (random() < 0.1), 'local', 'human', risk,
            floor(random() * 50)::int, NOW() - (random() * interval '60 days'))
        ON CONFLICT (username) DO NOTHING;
    END LOOP;
END $$;

-- ── Vendor / Contractor accounts ──────────────────────────────────────────────
INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score) VALUES
('vendor.bloomberg',  'Bloomberg!API9', 'vendor.bb@umbrella-financial.com',    'vendor',    'Trading',    true, false, 'local', 'human', 74),
('vendor.refinitiv',  'Refinitiv!Key2', 'vendor.ref@umbrella-financial.com',   'vendor',    'Research',   true, false, 'local', 'human', 71),
('vendor.swift.ops',  'SWIFTops!2024',  'vendor.swift@umbrella-financial.com', 'vendor',    'Payments',   true, false, 'local', 'human', 83),
('contractor.devsec', 'DevSec!2024',    'c.devsec@umbrella-financial.com',     'contractor','IT',         true, false, 'local', 'human', 68),
('contractor.audit',  'Audit!Ext24',    'c.audit@umbrella-financial.com',      'contractor','Compliance', true, false, 'local', 'human', 62);

-- ── Key demo accounts (high risk, named) ─────────────────────────────────────
INSERT INTO users_fin (username, password_cleartext, email, role, department, active, mfa_enabled, idp_source, account_type, risk_score, last_login, login_count) VALUES
('derek.sterling',   'Sterling!Legacy', 'derek.sterling@umbrella-financial.com', 'trader',     'Equities Desk', false, false, 'ldap',   'human', 94, NOW() - interval '5 days',  12),
('r.walsh.trader',   'WalshTrade!99',   'r.walsh@umbrella-financial.com',        'trader',     'FX Desk',       true,  false, 'ldap',   'human', 88, NOW() - interval '1 day',   210),
('p.nakamura.risk',  'NakRisk!2024',    'p.nakamura@umbrella-financial.com',     'risk_officer','Risk Mgmt',    true,  true,  'oauth2', 'human', 31, NOW() - interval '2 days',  87),
('shared.desk.fx',   'FXDesk!Shared1',  'fx.desk@umbrella-financial.com',        'trader',     'FX Desk',       true,  false, 'ldap',   'human', 96, NOW() - interval '3 hours', 891),
('svc.algo.trading', 'algo-trade-key-2024-prod', 'svc.algo@umbrella-financial.com','service',  'Trading',       true,  false, 'local',  'service',93, NOW() - interval '10 minutes', 44210);

-- Update last_login for most users
UPDATE users_fin SET last_login = NOW() - (random() * interval '90 days'),
    login_count = floor(random() * 200 + 5)::int
WHERE last_login IS NULL AND active = true AND account_type = 'human';

UPDATE users_fin SET last_login = NOW() - (random() * interval '30 days'),
    login_count = floor(random() * 5000 + 100)::int
WHERE account_type = 'service';

-- ── Banking accounts (with PII) ───────────────────────────────────────────────
DO $$
DECLARE
    first_names TEXT[] := ARRAY['James','Maria','Robert','Linda','David','Carlos','Thomas','Angela','Michael','Jennifer'];
    last_names  TEXT[] := ARRAY['Whitfield','Santos','Nguyen','Chen','Park','Mendez','Baker','Ross','Johnson','Williams'];
    acct_types  TEXT[] := ARRAY['checking','savings','investment','trading','loan'];
    fn TEXT; ln TEXT; acct_num TEXT; routing TEXT; ssn TEXT; cc TEXT; i INTEGER; balance NUMERIC;
BEGIN
    FOR i IN 1..200 LOOP
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        acct_num := lpad(floor(random() * 9999999999)::text, 10, '0');
        routing := '021000021';
        ssn := floor(random()*900+100)::text || '-' || floor(random()*90+10)::text || '-' || floor(random()*9000+1000)::text;
        cc := '4' || lpad(floor(random() * 999999999999999)::text, 15, '0');
        balance := (random() * 500000)::numeric(15,2);
        INSERT INTO accounts_fin (account_number, routing_number, holder_first_name, holder_last_name, ssn_plaintext, account_type, balance, credit_card_number, credit_card_cvv, email, created_at)
        VALUES (acct_num, routing, fn, ln, ssn,
            acct_types[1 + floor(random() * array_length(acct_types, 1))::int],
            balance, cc, floor(random()*900+100)::text,
            lower(fn) || '.' || lower(ln) || i || '@gmail.com',
            NOW() - (random() * interval '3650 days'))
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- ── Groups ────────────────────────────────────────────────────────────────────
INSERT INTO groups_fin (name, description) VALUES
('Traders',          'All trading desk personnel'),
('Analysts',         'Research and analytics staff'),
('Compliance',       'Compliance and audit team'),
('RiskManagement',   'Risk officers and managers'),
('RetailBanking',    'Branch and retail staff'),
('Lending',          'Loan officers and credit staff'),
('WealthManagement', 'Private banking and wealth managers'),
('Executives',       'C-suite and senior leadership'),
('ITAdministrators', 'IT and system administrators'),
('Vendors',          'External vendors and contractors'),
('Customers',        'Retail and investment customers'),
('ServiceAccounts',  'Automated service accounts');

-- ── Permissions ───────────────────────────────────────────────────────────────
INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['trades.read','trades.execute','trades.cancel','accounts.read','positions.read','risk.read'])
FROM groups_fin WHERE name='Traders';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['research.read','research.write','accounts.read','positions.read','reports.read'])
FROM groups_fin WHERE name='Analysts';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['audit.read','audit.export','trades.read','accounts.read','users.read','reports.read','kyc.read'])
FROM groups_fin WHERE name='Compliance';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['risk.read','risk.write','risk.approve','trades.read','positions.read','reports.read'])
FROM groups_fin WHERE name='RiskManagement';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['accounts.read','accounts.write','customers.read','transactions.read','loans.read'])
FROM groups_fin WHERE name='RetailBanking';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['loans.read','loans.write','loans.approve','customers.read','accounts.read'])
FROM groups_fin WHERE name='Lending';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['accounts.read','accounts.write','portfolios.*','customers.read','trades.read','reports.read'])
FROM groups_fin WHERE name='WealthManagement';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['*.*'])
FROM groups_fin WHERE name='Executives';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['config.*','users.*','api_keys.*','audit.read','systems.*'])
FROM groups_fin WHERE name='ITAdministrators';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['api.read','reports.read'])
FROM groups_fin WHERE name='Vendors';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['accounts.read_own','transactions.read_own','statements.read_own'])
FROM groups_fin WHERE name='Customers';

INSERT INTO group_permissions_fin (group_id, permission)
SELECT id, unnest(ARRAY['api.*','service.execute'])
FROM groups_fin WHERE name='ServiceAccounts';

-- ── Wire users to groups ──────────────────────────────────────────────────────
INSERT INTO group_members_fin (group_id, user_id, username)
SELECT g.id, u.id, u.username FROM users_fin u
JOIN groups_fin g ON (
    (u.role = 'trader'           AND g.name = 'Traders') OR
    (u.role = 'analyst'          AND g.name = 'Analysts') OR
    (u.role = 'compliance_officer' AND g.name = 'Compliance') OR
    (u.role = 'risk_officer'     AND g.name = 'RiskManagement') OR
    (u.role = 'retail_banker'    AND g.name = 'RetailBanking') OR
    (u.role = 'loan_officer'     AND g.name = 'Lending') OR
    (u.role = 'wealth_manager'   AND g.name = 'WealthManagement') OR
    (u.role = 'executive'        AND g.name = 'Executives') OR
    (u.role IN ('admin','support') AND g.name = 'ITAdministrators') OR
    (u.role IN ('vendor','contractor') AND g.name = 'Vendors') OR
    (u.role = 'customer'         AND g.name = 'Customers') OR
    (u.account_type = 'service'  AND g.name = 'ServiceAccounts')
) ON CONFLICT DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT role, COUNT(*) as count FROM users_fin GROUP BY role ORDER BY count DESC;
SELECT name, COUNT(gm.user_id) as members FROM groups_fin g
LEFT JOIN group_members_fin gm ON g.id = gm.group_id
GROUP BY g.name ORDER BY members DESC;
SELECT COUNT(*) as total_users FROM users_fin;
SELECT COUNT(*) as total_accounts FROM accounts_fin;
