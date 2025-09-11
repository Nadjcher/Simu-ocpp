package com.example.evsesimulator.model;

import lombok.Data;
import lombok.Builder;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.util.Date;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PerformanceMetrics {
    private Integer totalSessions;
    private Integer activeSessions;
    private Integer successCount;
    private Integer errorCount;
    private Double successRate;
    private Long avgLatency;
    private Long maxLatency;
    private Double cpuUsage;
    private Double memoryUsage;
    private Integer messagesPerSecond;
    private Date timestamp;
}