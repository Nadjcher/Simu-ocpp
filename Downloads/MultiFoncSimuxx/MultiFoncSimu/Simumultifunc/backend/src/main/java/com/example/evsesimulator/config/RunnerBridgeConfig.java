package com.example.evsesimulator.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

@Configuration
public class RunnerBridgeConfig {

    /** Base URL du runner Node (peut être sur 8877) */
    @Value("${runner.baseUrl:http://localhost:8877}")
    private String runnerBaseUrl;

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    /** Expose la valeur pour l’injecter dans le contrôleur */
    @Bean
    public String runnerBaseUrl() {
        return runnerBaseUrl.endsWith("/") ? runnerBaseUrl.substring(0, runnerBaseUrl.length() - 1) : runnerBaseUrl;
    }
}

