package com.example.evsesimulator.model;

import lombok.Data;
import java.util.*;

@Data
public class ChargingProfile {
    private String id;
    private String name;
    private Integer connectorId;
    private Integer profileId;
    private Integer stackLevel;
    private String purpose; // TxProfile, TxDefaultProfile, ChargePointMaxProfile
    private String kind; // Absolute, Recurring, Relative
    private String recurrency; // Daily, Weekly
    private String unit; // W, A
    private Date validFrom;
    private Date validTo;
    private List<ChargingPeriod> periods;

    @Data
    public static class ChargingPeriod {
        private Integer startPeriod;
        private Double limit;
        private Integer numberPhases;
    }
}