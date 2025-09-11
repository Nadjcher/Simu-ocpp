package com.example.evsesimulator.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.servers.Server;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI evseOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("EVSE Simulator — Runner HTTP API")
                        .version("1.0.0")
                        .description("Pilotage EVSE Simu / Perf / TNR (OCPP 1.6)"))
                .servers(List.of(new Server().url("http://localhost:8081")));
    }

    // groupe global (tout sous /api/**)
    @Bean
    public GroupedOpenApi allApi() {
        return GroupedOpenApi.builder()
                .group("all")
                .pathsToMatch("/api/**")
                .build();
    }

    // groupes par domaine (facultatif mais pratique dans l’UI)
    @Bean
    public GroupedOpenApi sessionsApi() {
        return GroupedOpenApi.builder()
                .group("sessions")
                .pathsToMatch("/api/simu/**")
                .build();
    }

    @Bean
    public GroupedOpenApi ocppApi() {
        return GroupedOpenApi.builder()
                .group("ocpp")
                .pathsToMatch("/api/ocpp/**")
                .build();
    }

    @Bean
    public GroupedOpenApi smartChargingApi() {
        return GroupedOpenApi.builder()
                .group("smart-charging")
                .pathsToMatch("/api/smart-charging/**")
                .build();
    }

    @Bean
    public GroupedOpenApi perfApi() {
        return GroupedOpenApi.builder()
                .group("perf")
                .pathsToMatch("/api/perf/**")
                .build();
    }

    @Bean
    public GroupedOpenApi tnrApi() {
        return GroupedOpenApi.builder()
                .group("tnr")
                .pathsToMatch("/api/tnr/**")
                .build();
    }

    @Bean
    public GroupedOpenApi vehiclesApi() {
        return GroupedOpenApi.builder()
                .group("vehicles")
                .pathsToMatch("/api/vehicles/**")
                .build();
    }
}
