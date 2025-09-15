package com.example.evsesimulator.model;

import lombok.Data;
import java.util.Map;

@Data
public class TNRRecord {
    private long timestamp;
    private String sessionId;
    private String eventType;
    private Map<String, Object> data;
}