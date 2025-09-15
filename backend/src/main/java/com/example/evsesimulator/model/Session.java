package com.example.evsesimulator.model;

import java.util.*;

public class Session {
    private String id;
    private String title;
    private String url;
    private String cpId;
    private String state;
    private String vehicleProfile;
    private String chargerType;
    private Integer maxCurrentA;
    private Double soc;
    private Integer initialSoc;
    private Integer targetSoc;
    private Double currentPowerW;
    private Double offeredPowerW;
    private Double activePowerW;
    private Double meterWh;
    private Integer transactionId;
    private String lastIdTag;
    private String bearerToken;
    private Boolean fuzzyEnabled;
    private Double fuzzyIntensity;
    private Boolean includeSoc;
    private Boolean includeOffered;
    private Boolean includeActive;
    private Double physicalLimitW;
    private Double appliedLimitW;
    private String txpLimit;
    private String txdpLimit;
    private List<Map<String, Object>> logs;
    private List<Map<String, Object>> socData;
    private List<Map<String, Object>> powerData;
    private Boolean hidden;
    private Date startTime;
    private Date lastMeterValueSent;
    private Integer meterValueCount;

    public Session() {
        this.logs = new ArrayList<>();
        this.socData = new ArrayList<>();
        this.powerData = new ArrayList<>();
    }

    public Session(String title) {
        this();
        this.title = title;
    }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }

    public String getCpId() { return cpId; }
    public void setCpId(String cpId) { this.cpId = cpId; }

    public String getState() { return state; }
    public void setState(String state) { this.state = state; }

    public String getVehicleProfile() { return vehicleProfile; }
    public void setVehicleProfile(String vehicleProfile) { this.vehicleProfile = vehicleProfile; }

    public String getChargerType() { return chargerType; }
    public void setChargerType(String chargerType) { this.chargerType = chargerType; }

    public Integer getMaxCurrentA() { return maxCurrentA; }
    public void setMaxCurrentA(Integer maxCurrentA) { this.maxCurrentA = maxCurrentA; }

    public Double getSoc() { return soc; }
    public void setSoc(Double soc) { this.soc = soc; }

    public Integer getInitialSoc() { return initialSoc; }
    public void setInitialSoc(Integer initialSoc) { this.initialSoc = initialSoc; }

    public Integer getTargetSoc() { return targetSoc; }
    public void setTargetSoc(Integer targetSoc) { this.targetSoc = targetSoc; }

    public Double getCurrentPowerW() { return currentPowerW; }
    public void setCurrentPowerW(Double currentPowerW) { this.currentPowerW = currentPowerW; }

    public Double getOfferedPowerW() { return offeredPowerW; }
    public void setOfferedPowerW(Double offeredPowerW) { this.offeredPowerW = offeredPowerW; }

    public Double getActivePowerW() { return activePowerW; }
    public void setActivePowerW(Double activePowerW) { this.activePowerW = activePowerW; }

    public Double getMeterWh() { return meterWh; }
    public void setMeterWh(Double meterWh) { this.meterWh = meterWh; }

    public Integer getTransactionId() { return transactionId; }
    public void setTransactionId(Integer transactionId) { this.transactionId = transactionId; }

    public String getLastIdTag() { return lastIdTag; }
    public void setLastIdTag(String lastIdTag) { this.lastIdTag = lastIdTag; }

    public String getBearerToken() { return bearerToken; }
    public void setBearerToken(String bearerToken) { this.bearerToken = bearerToken; }

    public Boolean getFuzzyEnabled() { return fuzzyEnabled; }
    public void setFuzzyEnabled(Boolean fuzzyEnabled) { this.fuzzyEnabled = fuzzyEnabled; }

    public Double getFuzzyIntensity() { return fuzzyIntensity; }
    public void setFuzzyIntensity(Double fuzzyIntensity) { this.fuzzyIntensity = fuzzyIntensity; }

    public Boolean getIncludeSoc() { return includeSoc; }
    public void setIncludeSoc(Boolean includeSoc) { this.includeSoc = includeSoc; }

    public Boolean getIncludeOffered() { return includeOffered; }
    public void setIncludeOffered(Boolean includeOffered) { this.includeOffered = includeOffered; }

    public Boolean getIncludeActive() { return includeActive; }
    public void setIncludeActive(Boolean includeActive) { this.includeActive = includeActive; }

    public Double getPhysicalLimitW() { return physicalLimitW; }
    public void setPhysicalLimitW(Double physicalLimitW) { this.physicalLimitW = physicalLimitW; }

    public Double getAppliedLimitW() { return appliedLimitW; }
    public void setAppliedLimitW(Double appliedLimitW) { this.appliedLimitW = appliedLimitW; }

    public String getTxpLimit() { return txpLimit; }
    public void setTxpLimit(String txpLimit) { this.txpLimit = txpLimit; }

    public String getTxdpLimit() { return txdpLimit; }
    public void setTxdpLimit(String txdpLimit) { this.txdpLimit = txdpLimit; }

    public List<Map<String, Object>> getLogs() { return logs; }
    public void setLogs(List<Map<String, Object>> logs) { this.logs = logs; }

    public List<Map<String, Object>> getSocData() { return socData; }
    public void setSocData(List<Map<String, Object>> socData) { this.socData = socData; }

    public List<Map<String, Object>> getPowerData() { return powerData; }
    public void setPowerData(List<Map<String, Object>> powerData) { this.powerData = powerData; }

    public Boolean getHidden() { return hidden; }
    public void setHidden(Boolean hidden) { this.hidden = hidden; }

    public Date getStartTime() { return startTime; }
    public void setStartTime(Date startTime) { this.startTime = startTime; }

    public Date getLastMeterValueSent() { return lastMeterValueSent; }
    public void setLastMeterValueSent(Date lastMeterValueSent) { this.lastMeterValueSent = lastMeterValueSent; }

    public Integer getMeterValueCount() { return meterValueCount; }
    public void setMeterValueCount(Integer meterValueCount) { this.meterValueCount = meterValueCount; }
}