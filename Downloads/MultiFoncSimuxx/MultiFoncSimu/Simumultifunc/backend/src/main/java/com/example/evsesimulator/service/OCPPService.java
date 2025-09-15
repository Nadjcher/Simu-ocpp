package com.example.evsesimulator.service;

import com.example.evsesimulator.model.Session;
import com.example.evsesimulator.model.OCPPMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import jakarta.annotation.PostConstruct;  // ← Changé de javax à jakarta

import java.util.concurrent.CompletableFuture;

@Slf4j
@Service
public class OCPPService {

    @Autowired
    private OCPPWebSocketClient ocppWebSocketClient;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private WebSocketBroadcaster broadcaster;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @PostConstruct
    public void init() {
        // Setup callbacks
        ocppWebSocketClient.setOnMessageReceived(message -> {
            // Ajouter aux logs de la session
            sessionService.addLog(
                    message.getSessionId(),
                    (message.getDirection().equals("SENT") ? "→ " : "← ") + message.getAction(),
                    message.getDirection().toLowerCase(),
                    message.getPayload()
            );

            // Broadcaster le message
            broadcaster.broadcastOCPPMessage(message);
        });

        ocppWebSocketClient.setOnSessionUpdate(update -> {
            if (update.getState() != null) {
                sessionService.updateSessionState(update.getSessionId(), update.getState());
            }
            if (update.getSoc() != null || update.getMeterWh() != null || update.getActivePower() != null) {
                sessionService.updateSessionMetrics(
                        update.getSessionId(),
                        update.getSoc(),
                        update.getMeterWh(),
                        update.getActivePower(),
                        update.getActivePower() != null ? update.getActivePower() * 1.05 : null
                );
            }
        });
    }

    public CompletableFuture<String> connect(String sessionId) {
        Session session = sessionService.getSession(sessionId)
                .orElseThrow(() -> new RuntimeException("Session not found"));

        sessionService.updateSessionState(sessionId, "CONNECTING");

        return ocppWebSocketClient.connect(
                sessionId,
                session.getUrl(),
                session.getCpId(),
                session.getBearerToken()
        );
    }

    public void disconnect(String sessionId) {
        ocppWebSocketClient.disconnect(sessionId);
        sessionService.updateSessionState(sessionId, "DISCONNECTED");
    }

    public CompletableFuture<Object> authorize(String sessionId, String idTag) {
        Session session = sessionService.getSession(sessionId)
                .orElseThrow(() -> new RuntimeException("Session not found"));

        session.setLastIdTag(idTag);
        sessionService.updateSession(sessionId, session);

        return ocppWebSocketClient.authorize(sessionId, idTag);
    }

    public CompletableFuture<Object> startTransaction(String sessionId, String idTag) {
        Session session = sessionService.getSession(sessionId)
                .orElseThrow(() -> new RuntimeException("Session not found"));

        session.setLastIdTag(idTag);
        session.setStartTime(new java.util.Date());
        sessionService.updateSession(sessionId, session);

        return ocppWebSocketClient.startTransaction(sessionId, idTag);
    }

    public CompletableFuture<Object> stopTransaction(String sessionId) {
        return ocppWebSocketClient.stopTransaction(sessionId);
    }

    public CompletableFuture<Object> sendOCPPMessage(String sessionId, String action, Object payload) {
        return ocppWebSocketClient.sendOCPPMessage(sessionId, action, payload);
    }

    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }
}