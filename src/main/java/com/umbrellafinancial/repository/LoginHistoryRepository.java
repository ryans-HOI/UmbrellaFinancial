package com.umbrellafinancial.repository;

import com.umbrellafinancial.model.LoginHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LoginHistoryRepository extends JpaRepository<LoginHistory, Long> {
    List<LoginHistory> findTop200ByOrderByCreatedAtDesc();
}
