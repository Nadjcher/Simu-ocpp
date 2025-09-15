package com.example.evsesimulator.model;

import lombok.Data;

@Data
public class ChartPoint {
    private Long timestamp;
    private Double soc;
    private Double offeredPower;
    private Double activePower;
    private String state;
}