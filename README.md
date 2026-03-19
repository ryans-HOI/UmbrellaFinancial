# Umbrella Financial Systems
## Demo Environment — Windows Server 2022 + IIS + AD DS

> Intentionally insecure financial identity management platform for Orchid Security discovery demos.

---

## Architecture

```
Internet
    │
    ▼
IIS 10 (port 80/443)                ← Windows Server 2022
    │  web.config reverse proxy
    ▼
Tomcat 10 (port 8080)               ← Spring Boot WAR
    │  umbrella-financial.war
    ├── POST /api/auth/login         ← Local DB cleartext
    ├── POST /api/auth/ldap          ← Real AD DS bind
    ├── POST /api/auth/basic         ← HTTP Basic
    ├── POST /api/auth/oauth2/validate ← KC token validation
    ├── POST /api/auth/apikey        ← API key check
    ├── POST /api/auth/service       ← Service account
    └── GET  /api/*                  ← Data endpoints (unauthenticated)

AD DS (port 389/636)                ← Windows Active Directory
    │  umbrella-financial.local
    └── Users, Traders, Analysts, Execs, Service Accounts

Keycloak (port 8180)                ← Docker on Windows
    │  realm: umbrella-financial
    └── OAuth2/OIDC for executives, compliance, wealth

Node.js Admin Console (port 3011)   ← Simulator + dashboard
Node.js Staff Portal  (port 3012)   ← OAuth2 + fallback login

PostgreSQL (port 5432)              ← findb
    ├── users_fin                   ← All identities
    ├── accounts_fin                ← Banking accounts (PII)
    ├── login_history_fin           ← Auth audit trail
    ├── groups_fin                  ← IAM groups
    └── group_permissions_fin       ← Permission mappings
```

---

## Deployment Steps

### 1. Launch Windows EC2
- AMI: Windows Server 2022 Base
- Instance: t3.medium
- Storage: 60GB gp3
- Security Group: ports 80, 443, 3389, 8080, 8180, 389, 636, 5432, 3011, 3012

### 2. Run Bootstrap Script
```powershell
# RDP in, open PowerShell as Administrator
# Paste contents of scripts/bootstrap-windows.ps1
```

### 3. Promote AD DS
```powershell
Install-ADDSForest `
  -DomainName "umbrella-financial.local" `
  -DomainNetbiosName "UMBRELLAFINANCIAL" `
  -InstallDns:$true `
  -SafeModeAdministratorPassword (ConvertTo-SecureString "ADSafe!Mode2024" -AsPlainText -Force) `
  -Force:$true
# Server will reboot
```

### 4. After Reboot — Create AD Users
```powershell
.\scripts\setup-ad-users.ps1
```

### 5. Start Keycloak
```powershell
docker run -d --name keycloak-fin --restart unless-stopped -p 8180:8080 `
  -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin `
  -e KC_HTTP_ENABLED=true -e KC_HOSTNAME_STRICT=false `
  -e KC_HOSTNAME_STRICT_HTTPS=false -e KC_PROXY=edge `
  quay.io/keycloak/keycloak:24.0.1 start --http-port=8080
```

### 6. Configure Keycloak Realm
```bash
# Run from WSL or Git Bash
bash scripts/setup-keycloak.sh
```

### 7. Build and Deploy WAR
```bash
mvn clean package -DskipTests
copy target\umbrella-financial.war "C:\deploy\"
# Tomcat auto-deploys from webapps\
```

### 8. Run Database Seed
```powershell
$env:PGPASSWORD = "finapp123"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U finapp -d findb -f scripts\seed-data.sql
```

### 9. Install and Start Node Services
```powershell
# Admin Console
cd C:\umbrella-financial\admin-console
npm install
nssm start UmbrellaFinancialAdmin

# Staff Portal
cd C:\umbrella-financial\staff-portal
npm install
nssm install UmbrellaFinancialPortal node.exe
nssm set UmbrellaFinancialPortal AppDirectory "C:\umbrella-financial\staff-portal"
nssm set UmbrellaFinancialPortal AppParameters "server.js"
nssm set UmbrellaFinancialPortal AppEnvironmentExtra "PORT=3012" "DB_HOST=localhost" "DB_NAME=findb" "DB_USER=finapp" "DB_PASS=finapp123" "APP_URL=https://umbrella-financial.houseofidentity.io" "KC_REALM=umbrella-financial" "KC_CLIENT_ID=finapp-client" "KC_CLIENT_SECRET=finapp-secret-2026"
nssm set UmbrellaFinancialPortal Start SERVICE_AUTO_START
nssm start UmbrellaFinancialPortal
```

### 10. Configure DNS
Add A record: `umbrella-financial.houseofidentity.io` → EC2 public IP

---

## Key Credentials

| Service | Username | Password |
|---------|----------|----------|
| Windows Admin | Administrator | (set at launch) |
| AD DS Safe Mode | — | ADSafe!Mode2024 |
| PostgreSQL | finapp | finapp123 |
| Keycloak Admin | admin | admin |
| App DB bind | finapp | finapp123 |
| LDAP bind | svc-finapp | LdapB1nd!Finance2024 |
| CEO | ceo.thornton | Thornton!CEO2024 |
| Shared FX Desk | shared.fxdesk | FXDesk!Shared1 |

---

## Auth Flows (all real)

| Flow | Endpoint | Users |
|------|----------|-------|
| Local DB (cleartext) | POST /api/auth/login | IT, Retail, Customers |
| AD DS LDAP bind | POST /api/auth/ldap | Traders, Analysts |
| OAuth2/OIDC (KC) | KC token exchange | Executives, Compliance |
| HTTP Basic | POST /api/auth/basic | Legacy endpoints |
| API Key | POST /api/auth/apikey | Trading systems |
| Service Account | POST /api/auth/service | Batch jobs, integrations |
| Fallback DB | POST /fallback-login (portal) | Emergency access |

---

## Key Orchid Findings

- `shared.fxdesk` — shared account with 800+ logins, no MFA
- `derek.sterling` — disabled in AD, still active in PostgreSQL
- `svc-finapp` — LDAP bind password in plaintext app config
- `svc.swift` / `svc.fed.wire` — payment gateway service accounts, never rotated
- 0% MFA enforcement across all auth flows
- Cleartext passwords in `users_fin.password_cleartext`
- API keys exposed in `/umbrella-financial/health` endpoint
- No session timeout, no rate limiting, no lockout policy
- IIS headers reveal exact server version
- Cookie security flags disabled

---

## Ports

| Port | Service |
|------|---------|
| 80/443 | IIS (reverse proxy) |
| 8080 | Tomcat (Spring Boot API) |
| 8180 | Keycloak |
| 3011 | Admin Console / Simulator |
| 3012 | Staff Portal |
| 5432 | PostgreSQL |
| 389 | LDAP (AD DS) |
| 636 | LDAPS (AD DS) |
