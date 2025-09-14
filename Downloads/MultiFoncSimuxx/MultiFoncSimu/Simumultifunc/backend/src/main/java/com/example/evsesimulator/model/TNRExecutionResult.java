// backend/src/main/java/com/example/evsesimulator/model/TNRExecutionResult.java
package com.example.evsesimulator.model;

import lombok.Data;
import java.util.*;

@Data
public class TNRExecutionResult {
    private String scenarioId;
    private String executionId;
    private Date timestamp;
    private boolean passed;
    private List<TNRDifference> differences;
    private List<TNREvent> events;
    private Metrics metrics;

    @Data
    public static class Metrics {
        private Integer totalEvents;
        private Double avgLatency;
        private Long maxLatency;
        private Integer errorCount;
    }
}