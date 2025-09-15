package com.example.evsesimulator.model;

import lombok.Data;
import lombok.Builder;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VehicleProfile {
    private String id;
    private String name;
    private String brand;
    private String model;
    private Double batteryCapacityKwh;
    private Double maxChargingPowerAC;
    private Double maxChargingPowerDC;
    private Integer maxChargingCurrentAC;
    private Integer phases;
    private Double efficiency;
    private String connectorType;

    // Profils prédéfinis statiques
    public static final VehicleProfile TESLA_MODEL_3_LR = VehicleProfile.builder()
            .id("TESLA_MODEL_3_LR")
            .name("Tesla Model 3 Long Range")
            .brand("Tesla")
            .model("Model 3 LR")
            .batteryCapacityKwh(82.0)
            .maxChargingPowerAC(11000.0)
            .maxChargingPowerDC(250000.0)
            .maxChargingCurrentAC(16)
            .phases(3)
            .efficiency(0.95)
            .connectorType("Type2")
            .build();

    public static final VehicleProfile RENAULT_ZOE_ZE50 = VehicleProfile.builder()
            .id("RENAULT_ZOE_ZE50")
            .name("Renault Zoe ZE50")
            .brand("Renault")
            .model("Zoe ZE50")
            .batteryCapacityKwh(52.0)
            .maxChargingPowerAC(22000.0)
            .maxChargingPowerDC(50000.0)
            .maxChargingCurrentAC(32)
            .phases(3)
            .efficiency(0.92)
            .connectorType("Type2")
            .build();

    public static final VehicleProfile NISSAN_LEAF_62 = VehicleProfile.builder()
            .id("NISSAN_LEAF_62")
            .name("Nissan Leaf 62kWh")
            .brand("Nissan")
            .model("Leaf 62")
            .batteryCapacityKwh(62.0)
            .maxChargingPowerAC(7400.0)
            .maxChargingPowerDC(100000.0)
            .maxChargingCurrentAC(32)
            .phases(1)
            .efficiency(0.90)
            .connectorType("Type2")
            .build();

    public static final VehicleProfile HYUNDAI_KONA_EV = VehicleProfile.builder()
            .id("HYUNDAI_KONA_EV")
            .name("Hyundai Kona Electric")
            .brand("Hyundai")
            .model("Kona EV")
            .batteryCapacityKwh(64.0)
            .maxChargingPowerAC(11000.0)
            .maxChargingPowerDC(77000.0)
            .maxChargingCurrentAC(16)
            .phases(3)
            .efficiency(0.93)
            .connectorType("Type2")
            .build();

    // Méthodes statiques pour la compatibilité
    public static VehicleProfile getTeslaModel3() {
        return TESLA_MODEL_3_LR;
    }

    public static VehicleProfile getRenaultZoe() {
        return RENAULT_ZOE_ZE50;
    }

    public static VehicleProfile getNissanLeaf() {
        return NISSAN_LEAF_62;
    }

    public static VehicleProfile getHyundaiKona() {
        return HYUNDAI_KONA_EV;
    }
}