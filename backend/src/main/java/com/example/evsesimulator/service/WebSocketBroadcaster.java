package com.example.evsesimulator.service;

import com.example.evsesimulator.model.Session;
import com.example.evsesimulator.model.OCPPMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

@Service
public class WebSocketBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(WebSocketBroadcaster.class);

    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public void addSession(WebSocketSession session) {
        sessions.add(session);
        log.info("WebSocket session added. Total sessions: {}", sessions.size());
    }

    public void removeSession(WebSocketSession session) {
        sessions.remove(session);
        log.info("WebSocket session removed. Total sessions: {}", sessions.size());
    }

    public void broadcastSessionUpdate(Session session) {
        broadcast("SESSION_UPDATE", session);
    }

    public void broadcastSessionDelete(String sessionId) {
        broadcast("SESSION_DELETE", Map.of("sessionId", sessionId));
    }

    public void broadcastOCPPMessage(OCPPMessage message) {
        broadcast("OCPP_MESSAGE", message);
    }

    public void broadcastPerformanceMetrics(Object metrics) {
        broadcast("PERFORMANCE_METRICS", metrics);
    }

    public void broadcastChartUpdate(String sessionId, Object chartData) {
        broadcast("CHART_UPDATE", Map.of(
                "sessionId", sessionId,
                "data", chartData
        ));
    }

    public void broadcastLogEntry(String sessionId, Object logEntry) {
        broadcast("LOG_ENTRY", Map.of(
                "sessionId", sessionId,
                "log", logEntry
        ));
    }

    private void broadcast(String type, Object data) {
        Map<String, Object> message = Map.of(
                "type", type,
                "data", data,
                "timestamp", System.currentTimeMillis()
        );

        String json;
        try {
            json = objectMapper.writeValueAsString(message);
        } catch (Exception e) {
            log.error("Failed to serialize message", e);
            return;
        }

        TextMessage textMessage = new TextMessage(json);

        sessions.forEach(session -> {
            try {
                if (session.isOpen()) {
                    session.sendMessage(textMessage);
                }
            } catch (IOException e) {
                log.error("Failed to send message to session", e);
            }
        });
    }
}