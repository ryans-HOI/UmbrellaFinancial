package com.umbrellafinancial.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.ldap.core.LdapTemplate;
import org.springframework.ldap.core.support.LdapContextSource;

@Configuration
public class LdapConfig {

    @Value("${umbrella.ldap.url}") private String ldapUrl;
    @Value("${umbrella.ldap.base}") private String ldapBase;
    @Value("${umbrella.ldap.user-dn}") private String userDn;
    @Value("${umbrella.ldap.password}") private String password;

    @Bean
    public LdapContextSource contextSource() {
        LdapContextSource source = new LdapContextSource();
        source.setUrl(ldapUrl);
        source.setBase(ldapBase);
        source.setUserDn(userDn);
        source.setPassword(password);
        // INSECURE: no SSL/TLS, plain LDAP
        source.setPooled(true);
        // INSECURE: disable integrity checking to allow plain LDAP on Windows AD
        java.util.Map<String,Object> env = new java.util.HashMap<>();
        env.put("java.naming.ldap.version", "3");
        env.put("com.sun.jndi.ldap.connect.pool.authentication", "simple");
        source.setBaseEnvironmentProperties(env);
        try {
            source.afterPropertiesSet();
        } catch (Exception e) {
            // Allow app to start even if LDAP is unavailable
            System.err.println("[LDAP] Context source init failed (will retry on use): " + e.getMessage());
        }
        return source;
    }

    @Bean
    public LdapTemplate ldapTemplate() {
        LdapTemplate template = new LdapTemplate(contextSource());
        // INSECURE: ignore partial results, ignore name-not-found
        template.setIgnorePartialResultException(true);
        template.setIgnoreNameNotFoundException(true);
        return template;
    }
}


