package com.example.evsesimulator.service;

import com.example.evsesimulator.model.Session;
import com.example.evsesimulator.model.VehicleProfile;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
public class SessionService {

    @Autowired
    private WebSocketBroadcaster broadcaster;

    @Autowired
    private VehicleService vehicleService;

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(10);

    public Session createSession(String title) {
        Session session = new Session(title);
        session.setId(UUID.randomUUID().toString());
        session.setUrl("wss://pp.total-ev-charge.com/ocpp/WebSocket");
        session.setCpId("CP-" + System.currentTimeMillis());
        session.setState("DISCONNECTED");
        session.setVehicleProfile("TESLA_MODEL_3_LR");
        session.setChargerType("AC Tri");
        session.setMaxCurrentA(32);
        session.setSoc(20.0);
        session.setInitialSoc(20);
        session.setTargetSoc(80);
        session.setMeterWh(0.0);
        session.setCurrentPowerW(0.0);
        session.setOfferedPowerW(0.0);
        session.setActivePowerW(0.0);
        session.setFuzzyEnabled(false);
        session.setFuzzyIntensity(0.5);
        session.setIncludeSoc(true);
        session.setIncludeOffered(true);
        session.setIncludeActive(true);
        session.setLogs(new ArrayList<>());
        session.setSocData(new ArrayList<>());
        session.setPowerData(new ArrayList<>());
        session.setHidden(false);
        session.setMeterValueCount(0);

        sessions.put(session.getId(), session);
        broadcaster.broadcastSessionUpdate(session);

        log.info("Created session: {} - {}", session.getId(), session.getTitle());
        return session;
    }

    public Optional<Session> getSession(String id) {
        return Optional.ofNullable(sessions.get(id));
    }

    public List<Session> getAllSessions() {
        return new ArrayList<>(sessions.values());
    }

    public Session updateSession(String id, Session updates) {
        Session session = sessions.get(id);
        if (session == null) {
            throw new RuntimeException("Session not found: " + id);
        }

        // Mettre à jour les champs non null
        if (updates.getTitle() != null) session.setTitle(updates.getTitle());
        if (updates.getUrl() != null) session.setUrl(updates.getUrl());
        if (updates.getCpId() != null) session.setCpId(updates.getCpId());
        if (updates.getVehicleProfile() != null) session.setVehicleProfile(updates.getVehicleProfile());
        if (updates.getChargerType() != null) session.setChargerType(updates.getChargerType());
        if (updates.getMaxCurrentA() != null) session.setMaxCurrentA(updates.getMaxCurrentA());
        if (updates.getInitialSoc() != null) session.setInitialSoc(updates.getInitialSoc());
        if (updates.getTargetSoc() != null) session.setTargetSoc(updates.getTargetSoc());
        if (updates.getBearerToken() != null) session.setBearerToken(updates.getBearerToken());
        if (updates.getFuzzyEnabled() != null) session.setFuzzyEnabled(updates.getFuzzyEnabled());
        if (updates.getFuzzyIntensity() != null) session.setFuzzyIntensity(updates.getFuzzyIntensity());
        if (updates.getIncludeSoc() != null) session.setIncludeSoc(updates.getIncludeSoc());
        if (updates.getIncludeOffered() != null) session.setIncludeOffered(updates.getIncludeOffered());
        if (updates.getIncludeActive() != null) session.setIncludeActive(updates.getIncludeActive());
        if (updates.getHidden() != null) session.setHidden(updates.getHidden());

        broadcaster.broadcastSessionUpdate(session);
        return session;
    }

    public void deleteSession(String id) {
        Session session = sessions.remove(id);
        if (session != null) {
            broadcaster.broadcastSessionDelete(id);
            log.info("Deleted session: {} - {}", id, session.getTitle());
        }
    }

    public void updateSessionState(String sessionId, String state) {
        Session session = sessions.get(sessionId);
        if (session != null) {
            session.setState(state);
            broadcaster.broadcastSessionUpdate(session);
        }
    }

    public void updateSessionMetrics(String sessionId, Double soc, Double meterWh,
                                     Double activePower, Double offeredPower) {
        Session session = sessions.get(sessionId);
        if (session != null) {
            if (soc != null) session.setSoc(soc);
            if (meterWh != null) session.setMeterWh(meterWh);
            if (activePower != null) session.setActivePowerW(activePower);
            if (offeredPower != null) session.setOfferedPowerW(offeredPower);

            // Ajouter aux données de graphique
            Map<String, Object> socPoint = new HashMap<>();
            socPoint.put("time", System.currentTimeMillis());
            socPoint.put("soc", session.getSoc());
            session.getSocData().add(socPoint);

            Map<String, Object> powerPoint = new HashMap<>();
            powerPoint.put("time", System.currentTimeMillis());
            powerPoint.put("offered", session.getOfferedPowerW());
            powerPoint.put("active", session.getActivePowerW());
            session.getPowerData().add(powerPoint);

            // Limiter la taille des données
            if (session.getSocData().size() > 1000) {
                session.setSocData(new ArrayList<>(
                        session.getSocData().subList(session.getSocData().size() - 500, session.getSocData().size())
                ));
            }
            if (session.getPowerData().size() > 1000) {
                session.setPowerData(new ArrayList<>(
                        session.getPowerData().subList(session.getPowerData().size() - 500, session.getPowerData().size())
                ));
            }

            broadcaster.broadcastSessionUpdate(session);
        }
    }

    public void addLog(String sessionId, String message, String type, Object payload) {
        Session session = sessions.get(sessionId);
        if (session != null) {
            Map<String, Object> log = new HashMap<>();
            log.put("timestamp", new Date());
            log.put("message", message);
            log.put("type", type);
            log.put("payload", payload);

            session.getLogs().add(log);

            // Limiter la taille des logs
            if (session.getLogs().size() > 1000) {
                session.setLogs(new ArrayList<>(
                        session.getLogs().subList(session.getLogs().size() - 500, session.getLogs().size())
                ));
            }

            broadcaster.broadcastLogEntry(sessionId, log);
        }
    }

    public void parkVehicle(String sessionId) {
        Session session = sessions.get(sessionId);
        if (session != null && "CONNECTED".equals(session.getState())) {
            session.setState("AVAILABLE");
            addLog(sessionId, "Vehicle parked", "info", null);
            broadcaster.broadcastSessionUpdate(session);
        }
    }

    public void plugVehicle(String sessionId) {
        Session session = sessions.get(sessionId);
        if (session != null && "AVAILABLE".equals(session.getState())) {
            session.setState("PREPARING");
            addLog(sessionId, "Vehicle plugged", "info", null);
            broadcaster.broadcastSessionUpdate(session);
        }
    }

    public void startChargingSimulation(String sessionId) {
        Session session = sessions.get(sessionId);
        if (session == null) return;

        session.setState("CHARGING");
        session.setStartTime(new Date());

        // Simulation de charge
        scheduler.scheduleAtFixedRate(() -> {
            Session s = sessions.get(sessionId);
            if (s == null || !"CHARGING".equals(s.getState())) {
                return;
            }

            VehicleProfile vehicle = vehicleService.getProfile(s.getVehicleProfile());
            if (vehicle == null) {
                vehicle = VehicleProfile.TESLA_MODEL_3_LR;
            }

            // Calculer la puissance de charge
            double maxPowerW = calculateMaxPower(s, vehicle);

            // Appliquer le mode flou si activé
            if (s.getFuzzyEnabled()) {
                double variation = (Math.random() - 0.5) * 2 * s.getFuzzyIntensity();
                maxPowerW *= (1 + variation * 0.1);
            }

            // Corriger Math.min pour ne prendre que 2 arguments à la fois
            double tempMin = Math.min(maxPowerW, s.getPhysicalLimitW() != null ? s.getPhysicalLimitW() : Double.MAX_VALUE);
            s.setCurrentPowerW(Math.min(tempMin, s.getAppliedLimitW() != null ? s.getAppliedLimitW() : Double.MAX_VALUE));

            // Mettre à jour l'énergie et le SoC
            double energyKwh = s.getCurrentPowerW() * (1.0 / 3600.0); // 1 seconde
            s.setMeterWh(s.getMeterWh() + energyKwh * 1000);

            double socIncrease = (energyKwh / vehicle.getBatteryCapacityKwh()) * 100;
            s.setSoc(Math.min(s.getSoc() + socIncrease, s.getTargetSoc()));

            // Arrêter si SoC cible atteint
            if (s.getSoc() >= s.getTargetSoc()) {
                s.setState("SUSPENDED_EV");
                s.setCurrentPowerW(0.0);
            }

            updateSessionMetrics(sessionId, s.getSoc(), s.getMeterWh(),
                    s.getCurrentPowerW(), s.getOfferedPowerW());

        }, 0, 1, TimeUnit.SECONDS);
    }

    private double calculateMaxPower(Session session, VehicleProfile vehicle) {
        double maxPower;

        if ("DC".equals(session.getChargerType())) {
            maxPower = vehicle.getMaxChargingPowerDC();
        } else {
            int phases = "AC Mono".equals(session.getChargerType()) ? 1 : 3;
            double voltage = phases == 1 ? 230.0 : 400.0;
            maxPower = voltage * session.getMaxCurrentA();
            maxPower = Math.min(maxPower, vehicle.getMaxChargingPowerAC());
        }

        // Courbe de charge selon SoC
        if (session.getSoc() > 80) {
            maxPower *= 0.5;
        } else if (session.getSoc() > 60) {
            maxPower *= 0.8;
        }

        return maxPower;
    }
}