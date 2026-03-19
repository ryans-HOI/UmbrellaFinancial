package com.umbrellafinancial.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "accounts_fin")
public class Account {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "account_number", unique = true)
    private String accountNumber;

    @Column(name = "routing_number")
    private String routingNumber;

    @Column(name = "holder_first_name")
    private String holderFirstName;

    @Column(name = "holder_last_name")
    private String holderLastName;

    @Column(name = "ssn_plaintext")
    private String ssnPlaintext;

    @Column(name = "account_type")
    private String accountType; // checking, savings, investment, trading, loan

    private BigDecimal balance;

    @Column(name = "credit_card_number")
    private String creditCardNumber;

    @Column(name = "credit_card_cvv")
    private String creditCardCvv;

    private String email;
    private String phone;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "risk_flag")
    private Boolean riskFlag = false;

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getAccountNumber() { return accountNumber; }
    public void setAccountNumber(String n) { this.accountNumber = n; }
    public String getRoutingNumber() { return routingNumber; }
    public void setRoutingNumber(String r) { this.routingNumber = r; }
    public String getHolderFirstName() { return holderFirstName; }
    public void setHolderFirstName(String n) { this.holderFirstName = n; }
    public String getHolderLastName() { return holderLastName; }
    public void setHolderLastName(String n) { this.holderLastName = n; }
    public String getSsnPlaintext() { return ssnPlaintext; }
    public void setSsnPlaintext(String s) { this.ssnPlaintext = s; }
    public String getAccountType() { return accountType; }
    public void setAccountType(String t) { this.accountType = t; }
    public BigDecimal getBalance() { return balance; }
    public void setBalance(BigDecimal b) { this.balance = b; }
    public String getCreditCardNumber() { return creditCardNumber; }
    public void setCreditCardNumber(String c) { this.creditCardNumber = c; }
    public String getCreditCardCvv() { return creditCardCvv; }
    public void setCreditCardCvv(String c) { this.creditCardCvv = c; }
    public String getEmail() { return email; }
    public void setEmail(String e) { this.email = e; }
    public String getPhone() { return phone; }
    public void setPhone(String p) { this.phone = p; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime t) { this.createdAt = t; }
    public Boolean getRiskFlag() { return riskFlag; }
    public void setRiskFlag(Boolean r) { this.riskFlag = r; }
}
