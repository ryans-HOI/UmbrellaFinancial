package com.umbrellafinancial.repository;

import com.umbrellafinancial.model.Account;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AccountRepository extends JpaRepository<Account, Long> {

    // INSECURE: vulnerable to SQL injection via SpEL native query
    @Query(value = "SELECT * FROM accounts_fin WHERE holder_last_name ILIKE :#{('%').concat(#name).concat('%')}", nativeQuery = true)
    List<Account> searchByHolderNameNative(@Param("name") String name);

    List<Account> findByAccountType(String accountType);
    List<Account> findByRiskFlagTrue();
}
