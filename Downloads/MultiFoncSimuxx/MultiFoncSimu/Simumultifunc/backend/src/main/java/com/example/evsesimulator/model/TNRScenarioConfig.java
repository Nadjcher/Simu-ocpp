// backend/src/main/java/com/example/evsesimulator/model/TNRScenarioConfig.java
package com.example.evsesimulator.model;

import lombok.Data;
import java.util.*;

@Data
public class TNRScenarioConfig {
    private String name;
    private String description;
    private Map<String, Object> parameters;
    private List<String> tags;
}