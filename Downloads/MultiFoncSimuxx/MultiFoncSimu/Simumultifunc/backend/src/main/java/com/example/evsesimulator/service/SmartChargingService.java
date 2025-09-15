package com.example.evsesimulator.service;

import com.example.evsesimulator.model.ChargingProfile;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;
import java.util.concurrent.CompletableFuture;

@Slf4j
@Service
public class SmartChargingService {

    @Autowired
    private OCPPService ocppService;

    private final Map<String, ChargingProfile> savedProfiles = new HashMap<>();
    private final RestTemplate restTemplate = new RestTemplate();

    public CompletableFuture<Object> applyChargingProfile(String sessionId, ChargingProfile profile) {
        Map<String, Object> payload = buildSetChargingProfilePayload(profile);
        return ocppService.sendOCPPMessage(sessionId, "SetChargingProfile", payload);
    }

    public CompletableFuture<Object> clearChargingProfile(String sessionId, Integer profileId, Integer connectorId) {
        Map<String, Object> payload = new HashMap<>();
        if (profileId != null) {
            payload.put("id", profileId);
        }
        if (connectorId != null) {
            payload.put("connectorId", connectorId);
        }

        return ocppService.sendOCPPMessage(sessionId, "ClearChargingProfile", payload);
    }

    public CompletableFuture<Object> applyCentralProfile(String evpId, String bearerToken, ChargingProfile profile) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String url = "https://api.total-ev-charge.com/evp/" + evpId + "/charging-profile";

                HttpHeaders headers = new HttpHeaders();
                headers.setBearerAuth(bearerToken);
                headers.set("Content-Type", "application/json");

                Map<String, Object> body = buildSetChargingProfilePayload(profile);
                HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);

                ResponseEntity<Object> response = restTemplate.exchange(
                        url, HttpMethod.POST, request, Object.class
                );

                log.info("Central charging profile applied for EVP: {}", evpId);
                return response.getBody();

            } catch (Exception e) {
                log.error("Failed to apply central charging profile", e);
                throw new RuntimeException("Failed to apply central profile: " + e.getMessage());
            }
        });
    }

    private Map<String, Object> buildSetChargingProfilePayload(ChargingProfile profile) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("connectorId", profile.getConnectorId() != null ? profile.getConnectorId() : 1);

        Map<String, Object> csProfile = new HashMap<>();
        csProfile.put("chargingProfileId", profile.getProfileId() != null ? profile.getProfileId() : 1);
        csProfile.put("stackLevel", profile.getStackLevel() != null ? profile.getStackLevel() : 0);
        csProfile.put("chargingProfilePurpose", profile.getPurpose() != null ? profile.getPurpose() : "TxProfile");
        csProfile.put("chargingProfileKind", profile.getKind() != null ? profile.getKind() : "Absolute");

        if ("Recurring".equals(profile.getKind())) {
            csProfile.put("recurrencyKind", profile.getRecurrency());
            if (profile.getValidFrom() != null) {
                csProfile.put("validFrom", profile.getValidFrom().toInstant().toString());
            }
            if (profile.getValidTo() != null) {
                csProfile.put("validTo", profile.getValidTo().toInstant().toString());
            }
        }

        Map<String, Object> schedule = new HashMap<>();
        schedule.put("chargingRateUnit", profile.getUnit() != null ? profile.getUnit() : "W");

        List<Map<String, Object>> periods = new ArrayList<>();
        if (profile.getPeriods() != null) {
            for (ChargingProfile.ChargingPeriod period : profile.getPeriods()) {
                Map<String, Object> p = new HashMap<>();
                p.put("startPeriod", period.getStartPeriod() != null ? period.getStartPeriod() : 0);
                p.put("limit", period.getLimit() != null ? period.getLimit() : 0.0);
                if (period.getNumberPhases() != null) {
                    p.put("numberPhases", period.getNumberPhases());
                }
                periods.add(p);
            }
        } else {
            // Default period
            Map<String, Object> defaultPeriod = new HashMap<>();
            defaultPeriod.put("startPeriod", 0);
            defaultPeriod.put("limit", 10000.0);
            periods.add(defaultPeriod);
        }
        schedule.put("chargingSchedulePeriod", periods);

        csProfile.put("chargingSchedule", schedule);
        payload.put("csChargingProfiles", csProfile);

        return payload;
    }

    public ChargingProfile saveProfile(ChargingProfile profile) {
        if (profile.getId() == null) {
            profile.setId("profile-" + System.currentTimeMillis());
        }
        savedProfiles.put(profile.getId(), profile);
        log.info("Saved charging profile: {}", profile.getId());
        return profile;
    }

    public void deleteProfile(String id) {
        if (savedProfiles.remove(id) != null) {
            log.info("Deleted charging profile: {}", id);
        }
    }

    public List<ChargingProfile> getAllProfiles() {
        return new ArrayList<>(savedProfiles.values());
    }

    public Optional<ChargingProfile> getProfile(String id) {
        return Optional.ofNullable(savedProfiles.get(id));
    }

    public ChargingProfile updateProfile(String id, ChargingProfile profile) {
        profile.setId(id);
        savedProfiles.put(id, profile);
        log.info("Updated charging profile: {}", id);
        return profile;
    }
}