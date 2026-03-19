package com.umbrellafinancial;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.support.SpringBootServletInitializer;

@SpringBootApplication
public class UmbrellaFinancialApplication extends SpringBootServletInitializer {

    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder application) {
        return application.sources(UmbrellaFinancialApplication.class);
    }

    public static void main(String[] args) {
        System.out.println("==== Umbrella Financial Systems v1.0 ====");
        System.out.println("DEMO ENVIRONMENT - Insecure by design for Orchid discovery");
        SpringApplication.run(UmbrellaFinancialApplication.class, args);
    }
}
