// backend/src/main/java/com/example/evsesimulator/model/ValidationRule.java
package com.example.evsesimulator.model;

import lombok.Data;

@Data
public class ValidationRule {
    private String type; // response, latency, value, scp
    private String target;
    private Object expected;
    private Double tolerance;
}