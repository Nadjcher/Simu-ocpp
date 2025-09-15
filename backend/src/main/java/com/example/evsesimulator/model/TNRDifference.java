// backend/src/main/java/com/example/evsesimulator/model/TNRDifference.java
package com.example.evsesimulator.model;

import lombok.Data;

@Data
public class TNRDifference {
    private Integer eventIndex;
    private String path;
    private Object expected;
    private Object actual;
    private String type; // missing, different, extra, error
}