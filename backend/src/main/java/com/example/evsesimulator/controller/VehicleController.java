package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.VehicleProfile;
import com.example.evsesimulator.service.VehicleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/vehicles")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class VehicleController {

    private final VehicleService vehicleService;

    @GetMapping
    public ResponseEntity<List<VehicleProfile>> getAllProfiles() {
        return ResponseEntity.ok(vehicleService.getAllProfiles());
    }

    @GetMapping("/{id}")
    public ResponseEntity<VehicleProfile> getProfile(@PathVariable String id) {
        VehicleProfile profile = vehicleService.getProfile(id);
        if (profile != null) {
            return ResponseEntity.ok(profile);
        }
        return ResponseEntity.notFound().build();
    }

    @PostMapping
    public ResponseEntity<VehicleProfile> createProfile(@RequestBody VehicleProfile profile) {
        VehicleProfile created = vehicleService.createCustomProfile(profile);
        return ResponseEntity.ok(created);
    }

    @PutMapping("/{id}")
    public ResponseEntity<VehicleProfile> updateProfile(
            @PathVariable String id,
            @RequestBody VehicleProfile profile) {
        profile.setId(id);
        VehicleProfile updated = vehicleService.createCustomProfile(profile);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteProfile(@PathVariable String id) {
        try {
            vehicleService.deleteProfile(id);
            return ResponseEntity.ok(Map.of("success", true, "message", "Profile deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(
                    Map.of("success", false, "error", e.getMessage())
            );
        }
    }
}