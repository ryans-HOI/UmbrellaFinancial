package com.umbrellafinancial.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "users_fin")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String username;

    @Column(name = "password_cleartext")
    private String passwordCleartext;

    private String email;
    private String role;
    private String department;
    private Boolean active = true;

    @Column(name = "mfa_enabled")
    private Boolean mfaEnabled = false;

    @Column(name = "last_login")
    private LocalDateTime lastLogin;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "idp_source")
    private String idpSource = "local";

    @Column(name = "account_type")
    private String accountType = "human";

    @Column(name = "risk_score")
    private Integer riskScore = 0;

    @Column(name = "login_count")
    private Integer loginCount = 0;

    @Column(name = "deactivate_at")
    private LocalDateTime deactivateAt;

    @Column(name = "password_changed_at")
    private LocalDateTime passwordChangedAt;

    @Column(name = "security_demo")
    private String securityDemo = "cleartext";

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPasswordCleartext() { return passwordCleartext; }
    public void setPasswordCleartext(String passwordCleartext) { this.passwordCleartext = passwordCleartext; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
    public Boolean getActive() { return active; }
    public void setActive(Boolean active) { this.active = active; }
    public Boolean getMfaEnabled() { return mfaEnabled; }
    public void setMfaEnabled(Boolean mfaEnabled) { this.mfaEnabled = mfaEnabled; }
    public LocalDateTime getLastLogin() { return lastLogin; }
    public void setLastLogin(LocalDateTime lastLogin) { this.lastLogin = lastLogin; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public String getIdpSource() { return idpSource; }
    public void setIdpSource(String idpSource) { this.idpSource = idpSource; }
    public String getAccountType() { return accountType; }
    public void setAccountType(String accountType) { this.accountType = accountType; }
    public Integer getRiskScore() { return riskScore; }
    public void setRiskScore(Integer riskScore) { this.riskScore = riskScore; }
    public Integer getLoginCount() { return loginCount; }
    public void setLoginCount(Integer loginCount) { this.loginCount = loginCount; }
    public LocalDateTime getDeactivateAt() { return deactivateAt; }
    public void setDeactivateAt(LocalDateTime deactivateAt) { this.deactivateAt = deactivateAt; }
    public LocalDateTime getPasswordChangedAt() { return passwordChangedAt; }
    public void setPasswordChangedAt(LocalDateTime passwordChangedAt) { this.passwordChangedAt = passwordChangedAt; }
    public String getSecurityDemo() { return securityDemo; }
    public void setSecurityDemo(String securityDemo) { this.securityDemo = securityDemo; }
}
