package com.example.evsesimulator.model;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class TnrPlusCompareResult {
    private String baselineId;
    private String currentId;
    private boolean signatureMatch;
    private int totalEventsBaseline;
    private int totalEventsCurrent;
    private int differencesCount;
    private List<TNRDifference> differences; // réutilise ton modèle existant
}
