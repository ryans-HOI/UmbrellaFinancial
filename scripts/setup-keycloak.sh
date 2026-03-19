#!/bin/bash
# ============================================================
# Umbrella Financial ??? Keycloak Realm Setup
# Run after Keycloak container is up
# ============================================================

KC_URL="http://localhost:8180"
REALM="umbrella-financial"

echo "==== Umbrella Financial Keycloak Setup ===="

# Get admin token
TOKEN=$(curl -sf -d 'client_id=admin-cli&username=admin&password=admin&grant_type=password' \
  "${KC_URL}/realms/master/protocol/openid-connect/token" | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: Could not get admin token. Is Keycloak running?"
  exit 1
fi

echo "[1] Creating realm: $REALM"
curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms" -d "{
    \"realm\": \"$REALM\",
    \"displayName\": \"Umbrella Financial Systems\",
    \"enabled\": true,
    \"registrationAllowed\": false,
    \"loginWithEmailAllowed\": true,
    \"duplicateEmailsAllowed\": false,
    \"sslRequired\": \"none\",
    \"attributes\": {
      \"frontendUrl\": \"https://umbrella-financial.houseofidentity.io\"
    }
  }" && echo "  Realm created" || echo "  Realm may already exist"

# Refresh token for new realm ops
TOKEN=$(curl -sf -d 'client_id=admin-cli&username=admin&password=admin&grant_type=password' \
  "${KC_URL}/realms/master/protocol/openid-connect/token" | jq -r '.access_token')

echo "[2] Creating clients"

# Staff portal client
curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}/clients" -d '{
    "clientId": "finapp-client",
    "name": "Umbrella Financial Staff Portal",
    "enabled": true,
    "publicClient": false,
    "secret": "finapp-secret-2026",
    "redirectUris": [
      "https://umbrella-financial.houseofidentity.io/*",
      "http://localhost:3012/*"
    ],
    "webOrigins": ["*"],
    "standardFlowEnabled": true,
    "directAccessGrantsEnabled": true,
    "protocol": "openid-connect"
  }' && echo "  finapp-client created"

# Simulator client
curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}/clients" -d '{
    "clientId": "fin-sim",
    "name": "Umbrella Financial Simulator",
    "enabled": true,
    "publicClient": false,
    "secret": "fin-sim-secret-2026",
    "redirectUris": ["http://localhost:3011/*"],
    "standardFlowEnabled": true,
    "directAccessGrantsEnabled": true,
    "protocol": "openid-connect"
  }' && echo "  fin-sim client created"

echo "[3] Disabling VERIFY_PROFILE required action"
curl -sf -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}/authentication/required-actions/VERIFY_PROFILE" \
  -d '{"alias":"VERIFY_PROFILE","name":"Verify Profile","enabled":false,"defaultAction":false}'

echo "[4] Creating KC users (executives, compliance, wealth managers)"

create_kc_user() {
  local username=$1
  local password=$2
  local first=$3
  local last=$4
  local email=$5

  HTTP=$(curl -sf -o /dev/null -w "%{http_code}" \
    -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/users" -d "{
      \"username\": \"${username}\",
      \"firstName\": \"${first}\",
      \"lastName\": \"${last}\",
      \"email\": \"${email}\",
      \"enabled\": true,
      \"credentials\": [{\"type\":\"password\",\"value\":\"${password}\",\"temporary\":false}]
    }")
  echo "  $username ??? HTTP $HTTP"
}

# Executives
create_kc_user "ceo.thornton"   "Thornton!CEO2024" "Edward"    "Thornton"   "ceo@umbrella-financial.com"
create_kc_user "cfo.nakamura"   "Nakamura!CFO9"    "Hiroshi"   "Nakamura"   "cfo@umbrella-financial.com"
create_kc_user "cro.walsh"      "Walsh!CRO2024"    "Brendan"   "Walsh"      "cro@umbrella-financial.com"
create_kc_user "ciso.ibrahim"   "Ibrahim!CISO"     "Amir"      "Ibrahim"    "ciso@umbrella-financial.com"
create_kc_user "coo.sterling"   "Sterling!COO8"    "Caroline"  "Sterling"   "coo@umbrella-financial.com"
create_kc_user "vp.trading"     "VPTrade!2024"     "Victor"    "Pemberton"  "vp.trading@umbrella-financial.com"
create_kc_user "vp.compliance"  "VPComp!2024"      "Diana"     "Harrington" "vp.compliance@umbrella-financial.com"
create_kc_user "vp.retail"      "VPRetail!9"       "Marcus"    "Caldwell"   "vp.retail@umbrella-financial.com"

# Admin console users
create_kc_user "ryan"  "Orchid2026!" "Ryan"  "Demo" "ryan@orchid.security"
create_kc_user "karin" "Orchid2026!" "Karin" "Demo" "karin@orchid.security"

echo "[5] Setting realm frontend URL"
curl -sf -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}" \
  -d "{\"attributes\":{\"frontendUrl\":\"https://umbrella-financial.houseofidentity.io\"}}"

echo ""
echo "==== Keycloak Setup Complete ===="
echo "Realm:          $REALM"
echo "Admin URL:      ${KC_URL}/admin/realms/${REALM}"
echo "OIDC endpoint:  ${KC_URL}/realms/${REALM}/protocol/openid-connect/token"
echo "Clients:        finapp-client, fin-sim"
echo ""
echo "Test exec login:"
echo "  curl -X POST '${KC_URL}/realms/${REALM}/protocol/openid-connect/token' \\"
echo "    --data-urlencode 'grant_type=password' \\"
echo "    --data-urlencode 'client_id=fin-sim' \\"
echo "    --data-urlencode 'client_secret=fin-sim-secret-2026' \\"
echo "    --data-urlencode 'username=ceo.thornton' \\"
echo "    --data-urlencode 'password=Thornton!CEO2024' | jq -r '.access_token'"
