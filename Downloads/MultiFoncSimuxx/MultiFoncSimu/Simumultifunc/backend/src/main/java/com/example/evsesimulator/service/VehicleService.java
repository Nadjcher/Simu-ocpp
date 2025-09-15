package com.example.evsesimulator.service;

import com.example.evsesimulator.model.VehicleProfile;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class VehicleService {

    private final Map<String, VehicleProfile> profiles = new HashMap<>();

    public VehicleService() {
        // Initialiser les profils prédéfinis
        addProfile(VehicleProfile.TESLA_MODEL_3_LR);
        addProfile(VehicleProfile.RENAULT_ZOE_ZE50);
        addProfile(VehicleProfile.NISSAN_LEAF_62);
        addProfile(VehicleProfile.HYUNDAI_KONA_EV);
    }

    public void addProfile(VehicleProfile profile) {
        profiles.put(profile.getId(), profile);
    }

    public VehicleProfile getProfile(String id) {
        return profiles.get(id);
    }

    public List<VehicleProfile> getAllProfiles() {
        return new ArrayList<>(profiles.values());
    }

    public VehicleProfile createCustomProfile(VehicleProfile profile) {
        profile.setId("CUSTOM_" + System.currentTimeMillis());
        profiles.put(profile.getId(), profile);
        return profile;
    }

    public void deleteProfile(String id) {
        if (!id.startsWith("CUSTOM_")) {
            throw new IllegalArgumentException("Cannot delete predefined profiles");
        }
        profiles.remove(id);
    }
}