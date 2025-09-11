// backend/src/main/java/com/example/evsesimulator/model/TNREvent.java
package com.example.evsesimulator.model;

import lombok.Data;

@Data
public class TNREvent {
    private Long timestamp;
    private String sessionId;
    private String type; // connect, disconnect, authorize, startTransaction, etc.
    private String action;
    private Object payload;
    private Long latency;
}