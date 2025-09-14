package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.ChargingProfile;
import com.example.evsesimulator.service.OCPPService;
import com.example.evsesimulator.service.SmartChargingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/ocpp")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class OCPPController {

    private final OCPPService ocppService;
    private final SmartChargingService smartChargingService;

    @PostMapping("/{sessionId}/authorize")
    public CompletableFuture<ResponseEntity<Object>> authorize(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> request) {
        String idTag = request.getOrDefault("idTag", "TEST-TAG-001");
        return ocppService.authorize(sessionId, idTag)
                .thenApply(ResponseEntity::ok)
                .exceptionally(ex -> ResponseEntity.badRequest().body(
                        Map.of("error", ex.getMessage())
                ));
    }

    @PostMapping("/{sessionId}/start-transaction")
    public CompletableFuture<ResponseEntity<Object>> startTransaction(
            @PathVariable String sessionId,
            @RequestBody Map<String, String> request) {
        String idTag = request.getOrDefault("idTag", "TEST-TAG-001");
        return ocppService.startTransaction(sessionId, idTag)
                .thenApply(ResponseEntity::ok)
                .exceptionally(ex -> ResponseEntity.badRequest().body(
                        Map.of("error", ex.getMessage())
                ));
    }

    @PostMapping("/{sessionId}/stop-transaction")
    public CompletableFuture<ResponseEntity<Object>> stopTransaction(@PathVariable String sessionId) {
        return ocppService.stopTransaction(sessionId)
                .thenApply(ResponseEntity::ok)
                .exceptionally(ex -> ResponseEntity.badRequest().body(
                        Map.of("error", ex.getMessage())
                ));
    }

    @PostMapping("/{sessionId}/set-charging-profile")
    public CompletableFuture<ResponseEntity<Object>> setChargingProfile(
            @PathVariable String sessionId,
            @RequestBody ChargingProfile profile) {
        return smartChargingService.applyChargingProfile(sessionId, profile)
                .thenApply(ResponseEntity::ok)
                .exceptionally(ex -> ResponseEntity.badRequest().body(
                        Map.of("error", ex.getMessage())
                ));
    }

    @PostMapping("/{sessionId}/clear-charging-profile")
    public CompletableFuture<ResponseEntity<Object>> clearChargingProfile(
            @PathVariable String sessionId,
            @RequestBody Map<String, Object> request) {
        Integer profileId = (Integer) request.get("profileId");
        Integer connectorId = (Integer) request.get("connectorId");

        return smartChargingService.clearChargingProfile(sessionId, profileId, connectorId)
                .thenApply(ResponseEntity::ok)
                .exceptionally(ex -> ResponseEntity.badRequest().body(
                        Map.of("error", ex.getMessage())
                ));
    }

    @PostMapping("/{sessionId}/send")
    public CompletableFuture<ResponseEntity<Object>> sendMessage(
            @PathVariable String sessionId,
            @RequestBody Map<String, Object> request) {
        String action = (String) request.get("action");
        Object payload = request.get("payload");

        return ocppService.sendOCPPMessage(sessionId, action, payload)
                .thenApply(ResponseEntity::ok)
                .exceptionally(ex -> ResponseEntity.badRequest().body(
                        Map.of("error", ex.getMessage())
                ));
    }
}