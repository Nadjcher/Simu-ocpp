package com.example.evsesimulator.model;

import lombok.Data;

@Data
public class ChargingProfileRequest {
    private String sessionId;
    private Integer connectorId;
    private Integer profileId;
    private Integer stackLevel;
    private String purpose;
    private String kind;
    private String recurrency;
    private String unit;
    private java.util.List<ChargingProfile.ChargingPeriod> periods;
}