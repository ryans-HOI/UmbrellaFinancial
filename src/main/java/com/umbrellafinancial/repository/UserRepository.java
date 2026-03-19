package com.umbrellafinancial.repository;

import com.umbrellafinancial.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    // INSECURE: cleartext password comparison
    @Query("SELECT u FROM User u WHERE u.username = :username AND u.passwordCleartext = :password")
    Optional<User> findByUsernameAndPasswordCleartext(
        @Param("username") String username,
        @Param("password") String password
    );

    @Query("SELECT u FROM User u ORDER BY u.riskScore DESC")
    List<User> findAllOrderByRiskScoreDesc();

    long countByMfaEnabledTrue();
    long countByActiveTrue();
    long countByActiveFalse();
}
