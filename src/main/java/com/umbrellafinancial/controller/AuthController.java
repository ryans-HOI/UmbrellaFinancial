package com.umbrellafinancial.controller;

import com.umbrellafinancial.model.LoginHistory;
import com.umbrellafinancial.repository.LoginHistoryRepository;
import com.umbrellafinancial.repository.UserRepository;
import com.umbrellafinancial.model.User;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.ldap.core.LdapTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired private UserRepository userRepository;
    @Autowired private LoginHistoryRepository loginHistoryRepository;
    @Autowired(required = false) private LdapTemplate ldapTemplate;

    @Value("${umbrella.api.master-key}") private String masterKey;
    @Value("${umbrella.api.trading-key}") private String tradingKey;
    @Value("${umbrella.api.reporting-key}") private String reportingKey;
    @Value("${umbrella.jwt.secret}") private String jwtSecret;
    @Value("${umbrella.ldap.url}") private String ldapUrl;
    @Value("${umbrella.ldap.base}") private String ldapBase;

    // 1. Local DB Login (cleartext - INSECURE)
    @PostMapping("/login")
    public ResponseEntity<?> localLogin(@RequestBody Map<String, String> body, HttpServletRequest req) {
        String username = body.get("username");
        String password = body.get("password");
        Optional<User> userOpt = userRepository.findByUsernameAndPasswordCleartext(username, password);
        Map<String, Object> resp = new HashMap<>();
        boolean success = userOpt.isPresent();
        logLogin(username, "local", success, success ? null : "invalid_credentials",
                req.getRemoteAddr(), req.getHeader("User-Agent"));
        if (success) {
            User u = userOpt.get();
            updateLastLogin(u);
            resp.put("user", username);
            resp.put("role", u.getRole());
            resp.put("token", "sess-" + u.getId() + "-" + System.currentTimeMillis());
            resp.put("authMethod", "local-db-cleartext");
            resp.put("_debug_password", u.getPasswordCleartext());
            return ResponseEntity.ok(resp);
        }
        resp.put("error", "invalid_credentials");
        resp.put("authMethod", "local-db-cleartext");
        return ResponseEntity.status(401).body(resp);
    }

    // 2. HTTP Basic Auth (INSECURE)
    @PostMapping("/basic")
    public ResponseEntity<?> basicAuth(HttpServletRequest req) {
        String authHeader = req.getHeader("Authorization");
        Map<String, Object> resp = new HashMap<>();
        if (authHeader != null && authHeader.startsWith("Basic ")) {
            try {
                String decoded = new String(Base64.getDecoder().decode(authHeader.substring(6)));
                String[] parts = decoded.split(":", 2);
                if (parts.length == 2) {
                    String username = parts[0];
                    String password = parts[1];
                    Optional<User> userOpt = userRepository.findByUsernameAndPasswordCleartext(username, password);
                    boolean success = userOpt.isPresent();
                    logLogin(username, "basic-auth", success, success ? null : "invalid_credentials",
                            req.getRemoteAddr(), req.getHeader("User-Agent"));
                    if (success) {
                        User u = userOpt.get();
                        updateLastLogin(u);
                        resp.put("user", username);
                        resp.put("role", u.getRole());
                        resp.put("token", "basic-" + UUID.randomUUID());
                        resp.put("authMethod", "http-basic");
                        return ResponseEntity.ok(resp);
                    }
                }
            } catch (Exception e) {
                resp.put("error", "malformed_credentials");
                return ResponseEntity.status(400).body(resp);
            }
        }
        logLogin("unknown", "basic-auth", false, "missing_header", req.getRemoteAddr(), req.getHeader("User-Agent"));
        resp.put("error", "unauthorized");
        resp.put("authMethod", "http-basic");
        return ResponseEntity.status(401).body(resp);
    }

    // 3. LDAP / Active Directory (REAL bind via PowerShell DirectoryServices)
    @PostMapping("/ldap")
    public ResponseEntity<?> ldapAuth(@RequestBody Map<String, String> body, HttpServletRequest req) {
        String username = body.get("username");
        String password = body.get("password");
        Map<String, Object> resp = new HashMap<>();

        System.out.println("[LDAP-AUTH] Attempting bind for: " + username + " password=" + password);

        try {
            // Use PowerShell DirectoryServices which handles Windows AD auth natively
            String upn = username + "@umbrella-financial.local";
            String psCommand = "$u = New-Object System.DirectoryServices.DirectoryEntry(" +
                "'LDAP://localhost:389/DC=umbrella-financial,DC=local', " +
                "'" + upn.replace("'", "''") + "', " +
                "'" + password.replace("'", "''") + "'); " +
                "$u.RefreshCache(); Write-Output 'OK'";

            ProcessBuilder pb = new ProcessBuilder(
                "powershell.exe", "-NonInteractive", "-NoProfile", "-Command", psCommand
            );
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            String psOut = new String(proc.getInputStream().readAllBytes()).trim();
            int exitCode = proc.waitFor();

            System.out.println("[LDAP-AUTH] PS exit=" + exitCode + " output=" + psOut);

            if (!psOut.contains("OK")) {
                throw new Exception("AD authentication failed: " + psOut);
            }

            System.out.println("[LDAP-AUTH] SUCCESS for: " + upn);

            Optional<User> dbUser = userRepository.findByUsername(username);
            logLogin(username, "ldap", true, null, req.getRemoteAddr(), req.getHeader("User-Agent"));

            resp.put("user", username);
            resp.put("role", dbUser.map(User::getRole).orElse("viewer"));
            resp.put("token", "ldap-" + UUID.randomUUID());
            resp.put("authMethod", "ldap-ad-bind");
            resp.put("ldapServer", ldapUrl);
            resp.put("ldapBase", ldapBase);
            resp.put("_debug_bind_upn", upn);
            resp.put("_debug_bind_password", password);
            return ResponseEntity.ok(resp);

        } catch (Exception e) {
            System.out.println("[LDAP-AUTH] Bind failed for " + username + ": " + e.getMessage());
            // Fallback to DB for designated local accounts
            Optional<User> userOpt = userRepository.findByUsernameAndPasswordCleartext(username, password);
            boolean dbSuccess = userOpt.isPresent() && "ldap".equals(userOpt.get().getIdpSource());
            logLogin(username, "ldap", dbSuccess, dbSuccess ? null : "ldap_bind_failed",
                    req.getRemoteAddr(), req.getHeader("User-Agent"));
            if (dbSuccess) {
                User u = userOpt.get();
                updateLastLogin(u);
                resp.put("user", username);
                resp.put("role", u.getRole());
                resp.put("token", "ldap-db-" + UUID.randomUUID());
                resp.put("authMethod", "ldap-db-fallback");
                return ResponseEntity.ok(resp);
            }
            resp.put("error", "ldap_auth_failed");
            resp.put("authMethod", "ldap-ad-bind");
            resp.put("ldapServer", ldapUrl);
            return ResponseEntity.status(401).body(resp);
        }
    }

    // 4. OAuth2 Token Validation
    @PostMapping("/oauth2/validate")
    public ResponseEntity<?> oauth2Validate(@RequestBody Map<String, String> body, HttpServletRequest req) {
        String token = body.get("access_token");
        String username = body.get("username");
        Map<String, Object> resp = new HashMap<>();
        Optional<User> userOpt = userRepository.findByUsername(username);
        boolean success = userOpt.isPresent() && token != null && !token.isEmpty();
        logLogin(username, "oauth2", success, success ? null : "token_validation_failed",
                req.getRemoteAddr(), req.getHeader("User-Agent"));
        if (success) {
            User u = userOpt.get();
            updateLastLogin(u);
            resp.put("user", username);
            resp.put("role", u.getRole());
            resp.put("valid", true);
            resp.put("authMethod", "oauth2-oidc");
            return ResponseEntity.ok(resp);
        }
        resp.put("error", "invalid_token");
        return ResponseEntity.status(401).body(resp);
    }

    // 5. API Key Auth
    @PostMapping("/apikey")
    public ResponseEntity<?> apiKeyAuth(@RequestBody Map<String, String> body, HttpServletRequest req) {
        String apiKey = body.get("api_key");
        String service = body.get("service");
        Map<String, Object> resp = new HashMap<>();
        boolean valid = masterKey.equals(apiKey) || tradingKey.equals(apiKey) || reportingKey.equals(apiKey);
        String keyType = masterKey.equals(apiKey) ? "master" : tradingKey.equals(apiKey) ? "trading" : "reporting";
        logLogin(service != null ? service : "api-client", "api-key", valid,
                valid ? null : "invalid_api_key", req.getRemoteAddr(), req.getHeader("User-Agent"));
        if (valid) {
            resp.put("valid", true);
            resp.put("keyType", keyType);
            resp.put("authMethod", "api-key");
            resp.put("_debug_key", apiKey);
            return ResponseEntity.ok(resp);
        }
        resp.put("error", "invalid_api_key");
        return ResponseEntity.status(401).body(resp);
    }

    // 6. Service Account Auth
    @PostMapping("/service")
    public ResponseEntity<?> serviceAuth(@RequestBody Map<String, String> body, HttpServletRequest req) {
        String serviceId = body.get("service_id");
        String secret = body.get("service_secret");
        Map<String, Object> resp = new HashMap<>();
        Optional<User> userOpt = userRepository.findByUsernameAndPasswordCleartext(serviceId, secret);
        boolean success = userOpt.isPresent() && "service".equals(userOpt.get().getAccountType());
        logLogin(serviceId, "service-account", success, success ? null : "invalid_service_credentials",
                req.getRemoteAddr(), req.getHeader("User-Agent"));
        if (success) {
            User u = userOpt.get();
            updateLastLogin(u);
            resp.put("service", serviceId);
            resp.put("role", u.getRole());
            resp.put("token", "svc-" + UUID.randomUUID());
            resp.put("authMethod", "service-account");
            return ResponseEntity.ok(resp);
        }
        resp.put("error", "invalid_service_credentials");
        return ResponseEntity.status(401).body(resp);
    }

    // 7. Session Info
    @GetMapping("/session")
    public ResponseEntity<?> session(HttpServletRequest req) {
        Map<String, Object> resp = new HashMap<>();
        resp.put("app", "Umbrella Financial Systems");
        resp.put("authFlows", new String[]{"local", "basic-auth", "ldap-ad", "oauth2", "api-key", "service-account"});
        resp.put("_debug_api_keys", Map.of("master", masterKey, "trading", tradingKey, "reporting", reportingKey));
        resp.put("ldapServer", ldapUrl);
        resp.put("jwtSecret", jwtSecret);
        return ResponseEntity.ok(resp);
    }

    private void logLogin(String username, String idpSource, boolean success,
                          String failureReason, String ip, String userAgent) {
        try {
            LoginHistory log = new LoginHistory();
            log.setUsername(username);
            log.setIdpSource(idpSource);
            log.setSuccess(success);
            log.setFailureReason(failureReason);
            log.setIpAddress(ip);
            log.setUserAgent(userAgent != null ? userAgent : "unknown");
            log.setCreatedAt(LocalDateTime.now());
            loginHistoryRepository.save(log);
        } catch (Exception e) {
            System.err.println("[AUTH] Failed to log login: " + e.getMessage());
        }
    }

    private void updateLastLogin(User u) {
        try {
            u.setLastLogin(LocalDateTime.now());
            u.setLoginCount(u.getLoginCount() != null ? u.getLoginCount() + 1 : 1);
            userRepository.save(u);
        } catch (Exception e) {
            System.err.println("[AUTH] Failed to update last_login: " + e.getMessage());
        }
    }
}
