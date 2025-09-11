package com.example.evsesimulator.repository;

import com.example.evsesimulator.model.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Repository;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

@Repository
public class JsonFileRepository {

    private static final Logger log = LoggerFactory.getLogger(JsonFileRepository.class);

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Path dataDir = Paths.get("data");
    private final Path sessionsFile = dataDir.resolve("sessions.json");
    private final Path profilesFile = dataDir.resolve("profiles.json");

    @PostConstruct
    public void init() {
        try {
            Files.createDirectories(dataDir);

            if (!Files.exists(sessionsFile)) {
                saveAll(sessionsFile, new ArrayList<>());
            }

            if (!Files.exists(profilesFile)) {
                List<VehicleProfile> defaultProfiles = Arrays.asList(
                        VehicleProfile.TESLA_MODEL_3_LR,
                        VehicleProfile.RENAULT_ZOE_ZE50,
                        VehicleProfile.NISSAN_LEAF_62,
                        VehicleProfile.HYUNDAI_KONA_EV
                );
                saveAll(profilesFile, defaultProfiles);
            }
        } catch (IOException e) {
            log.error("Failed to initialize repository", e);
        }
    }

    public List<Session> loadSessions() {
        return loadAll(sessionsFile, Session.class);
    }

    public void saveSessions(List<Session> sessions) {
        saveAll(sessionsFile, sessions);
    }

    public List<VehicleProfile> loadProfiles() {
        return loadAll(profilesFile, VehicleProfile.class);
    }

    public void saveProfiles(List<VehicleProfile> profiles) {
        saveAll(profilesFile, profiles);
    }

    private <T> List<T> loadAll(Path file, Class<T> type) {
        try {
            if (Files.exists(file)) {
                String json = Files.readString(file);
                return objectMapper.readValue(json,
                        objectMapper.getTypeFactory().constructCollectionType(List.class, type));
            }
        } catch (IOException e) {
            log.error("Failed to load from {}", file, e);
        }
        return new ArrayList<>();
    }

    private void saveAll(Path file, Object data) {
        try {
            String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(data);
            Files.writeString(file, json);
        } catch (IOException e) {
            log.error("Failed to save to {}", file, e);
        }
    }
}