package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.ChargingProfile;
import com.example.evsesimulator.service.SmartChargingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/smart-charging")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class SmartChargingController {

    private final SmartChargingService smartChargingService;

    @PostMapping("/profile/apply")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> applyChargingProfile(
            @RequestBody Map<String, Object> request) {

        String sessionId = (String) request.get("sessionId");
        ChargingProfile profile = convertToProfile(request);

        return smartChargingService.applyChargingProfile(sessionId, profile)
                .thenApply(result -> {
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", true);
                    response.put("result", result);
                    return ResponseEntity.ok(response);
                })
                .exceptionally(ex -> {
                    Map<String, Object> error = new HashMap<>();
                    error.put("success", false);
                    error.put("error", ex.getMessage());
                    return ResponseEntity.badRequest().body(error);
                });
    }

    @PostMapping("/profile/clear")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> clearChargingProfile(
            @RequestBody Map<String, Object> request) {

        String sessionId = (String) request.get("sessionId");
        Integer profileId = (Integer) request.get("profileId");
        Integer connectorId = (Integer) request.get("connectorId");

        return smartChargingService.clearChargingProfile(sessionId, profileId, connectorId)
                .thenApply(result -> {
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", true);
                    response.put("result", result);
                    return ResponseEntity.ok(response);
                })
                .exceptionally(ex -> {
                    Map<String, Object> error = new HashMap<>();
                    error.put("success", false);
                    error.put("error", ex.getMessage());
                    return ResponseEntity.badRequest().body(error);
                });
    }

    @GetMapping("/profiles")
    public ResponseEntity<List<ChargingProfile>> getAllProfiles() {
        return ResponseEntity.ok(smartChargingService.getAllProfiles());
    }

    @PostMapping("/profile/save")
    public ResponseEntity<ChargingProfile> saveProfile(@RequestBody ChargingProfile profile) {
        ChargingProfile saved = smartChargingService.saveProfile(profile);
        return ResponseEntity.ok(saved);
    }

    @DeleteMapping("/profile/{id}")
    public ResponseEntity<Map<String, Object>> deleteProfile(@PathVariable String id) {
        smartChargingService.deleteProfile(id);
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "Profile deleted");
        return ResponseEntity.ok(response);
    }

    @PostMapping("/central/apply")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> applyCentralProfile(
            @RequestBody Map<String, Object> request) {

        String evpId = (String) request.get("evpId");
        String bearerToken = (String) request.get("bearerToken");
        ChargingProfile profile = convertToProfile(request);

        return smartChargingService.applyCentralProfile(evpId, bearerToken, profile)
                .thenApply(result -> {
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", true);
                    response.put("result", result);
                    return ResponseEntity.ok(response);
                })
                .exceptionally(ex -> {
                    Map<String, Object> error = new HashMap<>();
                    error.put("success", false);
                    error.put("error", ex.getMessage());
                    return ResponseEntity.badRequest().body(error);
                });
    }

    private ChargingProfile convertToProfile(Map<String, Object> request) {
        ChargingProfile profile = new ChargingProfile();
        profile.setConnectorId((Integer) request.get("connectorId"));
        profile.setProfileId((Integer) request.get("profileId"));
        profile.setStackLevel((Integer) request.get("stackLevel"));
        profile.setPurpose((String) request.get("purpose"));
        profile.setKind((String) request.get("kind"));
        profile.setRecurrency((String) request.get("recurrency"));
        profile.setUnit((String) request.get("unit"));

        List<Map<String, Object>> periods = (List<Map<String, Object>>) request.get("periods");
        if (periods != null) {
            List<ChargingProfile.ChargingPeriod> chargingPeriods = new ArrayList<>();
            for (Map<String, Object> period : periods) {
                ChargingProfile.ChargingPeriod cp = new ChargingProfile.ChargingPeriod();
                cp.setStartPeriod((Integer) period.get("startPeriod"));
                cp.setLimit(((Number) period.get("limit")).doubleValue());
                cp.setNumberPhases((Integer) period.get("numberPhases"));
                chargingPeriods.add(cp);
            }
            profile.setPeriods(chargingPeriods);
        }

        return profile;
    }
}