package com.umbrellafinancial.controller;

import com.umbrellafinancial.repository.AccountRepository;
import com.umbrellafinancial.repository.LoginHistoryRepository;
import com.umbrellafinancial.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/umbrella-financial")
public class DataController {

    @Autowired private UserRepository userRepository;
    @Autowired private LoginHistoryRepository loginHistoryRepository;
    @Autowired private AccountRepository accountRepository;

    @Value("${umbrella.api.master-key}") private String masterKey;
    @Value("${umbrella.api.trading-key}") private String tradingKey;
    @Value("${umbrella.api.reporting-key}") private String reportingKey;
    @Value("${umbrella.ldap.url}") private String ldapUrl;
    @Value("${umbrella.ldap.password}") private String ldapPassword;
    @Value("${umbrella.jwt.secret}") private String jwtSecret;
    @Value("${umbrella.smtp.password}") private String smtpPassword;

    // ── Health / Discovery endpoint ───────────────────────────────────────────
    @GetMapping("/health")
    public ResponseEntity<?> health() {
        Map<String, Object> resp = new HashMap<>();
        resp.put("status", "ok");
        resp.put("app", "Umbrella Financial Systems");
        resp.put("version", "1.0.0");
        resp.put("framework", "Spring Boot + Spring Security");
        resp.put("orm", "Hibernate/JPA");
        resp.put("users", userRepository.count());
        resp.put("accounts", accountRepository.count());
        resp.put("authFlows", List.of("local", "basic-auth", "ldap-ad", "oauth2", "api-key", "service-account"));
        return ResponseEntity.ok(resp);
    }

    // ── Users (all — unauthenticated, INSECURE) ───────────────────────────────
    @GetMapping("/api/users")
    public ResponseEntity<?> getUsers() {
        // INSECURE: returns all users including cleartext passwords
        var users = userRepository.findAllOrderByRiskScoreDesc();
        Map<String, Object> resp = new HashMap<>();
        resp.put("count", users.size());
        resp.put("users", users);
        return ResponseEntity.ok(resp);
    }

    // ── Accounts (with account numbers — INSECURE) ────────────────────────────
    @GetMapping("/api/accounts")
    public ResponseEntity<?> getAccounts() {
        // INSECURE: returns full account numbers, routing numbers
        var accounts = accountRepository.findAll();
        Map<String, Object> resp = new HashMap<>();
        resp.put("count", accounts.size());
        resp.put("accounts", accounts);
        return ResponseEntity.ok(resp);
    }

    // ── Account search (SQL injection via native query) ───────────────────────
    @GetMapping("/api/accounts/search")
    public ResponseEntity<?> searchAccounts(@RequestParam String name) {
        // INSECURE: SQL injection via native query
        var accounts = accountRepository.searchByHolderNameNative(name);
        return ResponseEntity.ok(Map.of("results", accounts));
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    @GetMapping("/api/audit")
    public ResponseEntity<?> getAudit() {
        var logs = loginHistoryRepository.findTop200ByOrderByCreatedAtDesc();
        Map<String, Object> resp = new HashMap<>();
        resp.put("count", logs.size());
        resp.put("logs", logs);
        return ResponseEntity.ok(resp);
    }

    // ── Security posture (INSECURE: exposes all findings) ────────────────────
    @GetMapping("/api/security/posture")
    public ResponseEntity<?> securityPosture() {
        long totalUsers = userRepository.count();
        long mfaEnabled = userRepository.countByMfaEnabledTrue();
        long activeUsers = userRepository.countByActiveTrue();
        long staleAccounts = userRepository.countByActiveFalse();

        Map<String, Object> resp = new HashMap<>();
        resp.put("mfaRate", totalUsers > 0 ? String.format("%.1f%%", (mfaEnabled * 100.0 / totalUsers)) : "0%");
        resp.put("mfaEnforced", false);
        resp.put("totalUsers", totalUsers);
        resp.put("activeUsers", activeUsers);
        resp.put("staleAccounts", staleAccounts);
        resp.put("passwordPolicy", "min-length=4, no-complexity, no-rotation");
        resp.put("sessionTimeout", "none");
        resp.put("rateLimiting", false);
        resp.put("accountLockout", false);

        // INSECURE: hardcoded credentials exposed in security endpoint
        resp.put("_exposed_credentials", Map.of(
            "masterApiKey", masterKey,
            "tradingApiKey", tradingKey,
            "ldapBindPassword", ldapPassword,
            "jwtSecret", jwtSecret,
            "smtpPassword", smtpPassword
        ));

        resp.put("authFlows", List.of(
            Map.of("name", "Local DB", "mfaEnforced", false, "passwordHashing", "cleartext"),
            Map.of("name", "HTTP Basic", "mfaEnforced", false, "encrypted", false),
            Map.of("name", "LDAP/AD", "mfaEnforced", false, "server", ldapUrl),
            Map.of("name", "OAuth2/OIDC", "mfaEnforced", false, "provider", "Keycloak"),
            Map.of("name", "API Key", "mfaEnforced", false, "rotated", false),
            Map.of("name", "Service Account", "mfaEnforced", false, "shared", true)
        ));
        return ResponseEntity.ok(resp);
    }

    // ── API Keys (INSECURE: all keys exposed) ────────────────────────────────
    @GetMapping("/api/admin/api-keys")
    public ResponseEntity<?> getApiKeys() {
        return ResponseEntity.ok(List.of(
            Map.of("key", masterKey,    "name", "Master Internal Key",   "rotated", false, "created", "2024-01-01", "scope", "admin.*"),
            Map.of("key", tradingKey,   "name", "Trading API Key",       "rotated", false, "created", "2024-03-15", "scope", "trading.*"),
            Map.of("key", reportingKey, "name", "Reporting Read Key",    "rotated", false, "created", "2023-11-01", "scope", "reports.read")
        ));
    }

    // ── MFA status ────────────────────────────────────────────────────────────
    @GetMapping("/api/security/mfa-status")
    public ResponseEntity<?> mfaStatus() {
        long total = userRepository.count();
        long mfaOn = userRepository.countByMfaEnabledTrue();
        Map<String, Object> resp = new HashMap<>();
        resp.put("totalUsers", total);
        resp.put("mfaEnabled", mfaOn);
        resp.put("mfaRate", total > 0 ? String.format("%.1f%%", (mfaOn * 100.0 / total)) : "0%");
        resp.put("warning", "MFA not enforced for any role including privileged users");
        return ResponseEntity.ok(resp);
    }
}


