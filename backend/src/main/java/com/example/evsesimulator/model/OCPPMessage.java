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
public class OCPPMessage {
    private String id;
    private String sessionId;
    private String cpId;
    private String direction; // "SENT" ou "RECEIVED"
    private String action;
    private Object payload;
    private String raw;
    private Date timestamp;
    private Long latency;

    // Enum pour la direction si nécessaire
    public enum MessageDirection {
        SENT, RECEIVED;

        public String toLowerCase() {
            return this.name().toLowerCase();
        }
    }
}