package com.example.evsesimulator.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ChargingSchedulePoint {
    private Integer startOffset; // Offset en secondes depuis le début
    private Double limit;        // Limite de puissance en kW
}