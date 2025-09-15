
package com.example.evsesimulator.model;

import lombok.Data;
import java.util.*;

@Data
public class TNRScenario {
    private String id;
    private String name;
    private String description;
    private Date createdAt;
    private List<Session> sessions;
    private List<TNREvent> events;
    private List<ValidationRule> validationRules;
    private Boolean baseline;
    private List<String> tags;
}
