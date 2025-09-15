package com.example.evsesimulator.model;

import lombok.Data;
import java.time.Instant;

@Data
public class LogEntry {
    private Instant timestamp;
    private LogLevel level;
    private String message;
    private String sessionId;
    private String category;
    private Object details;

    public enum LogLevel {
        DEBUG, INFO, WARNING, ERROR, CRITICAL
    }
}