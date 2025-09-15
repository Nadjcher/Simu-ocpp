package com.example.evsesimulator.service;

import com.example.evsesimulator.model.OCPPMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

@Slf4j
@Component
public class OCPPWebSocketClient {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, OCPPWebSocketConnection> connections = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<Object>> pendingRequests = new ConcurrentHashMap<>();
    private final Map<String, Integer> transactionIds = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(5);

    private Consumer<OCPPMessage> onMessageReceived;
    private Consumer<SessionUpdate> onSessionUpdate;

    @Data
    public static class SessionUpdate {
        private String sessionId;
        private String state;
        private Double soc;
        private Double meterWh;
        private Double activePower;
    }

    public void setOnMessageReceived(Consumer<OCPPMessage> callback) {
        this.onMessageReceived = callback;
    }

    public void setOnSessionUpdate(Consumer<SessionUpdate> callback) {
        this.onSessionUpdate = callback;
    }

    public CompletableFuture<String> connect(String sessionId, String url, String cpId, String bearerToken) {
        CompletableFuture<String> future = new CompletableFuture<>();

        try {
            String wsUrl = url.endsWith("/") ? url + cpId : url + "/" + cpId;
            URI uri = new URI(wsUrl);

            OCPPWebSocketConnection connection = new OCPPWebSocketConnection(uri, sessionId, cpId, bearerToken);
            connections.put(sessionId, connection);

            connection.setConnectionListener(new ConnectionListener() {
                @Override
                public void onOpen() {
                    log.info("WebSocket connected for session: {}", sessionId);
                    sendBootNotification(sessionId, cpId).thenAccept(result -> {
                        future.complete("Connected successfully");
                        updateSessionState(sessionId, "CONNECTED");
                    }).exceptionally(ex -> {
                        future.completeExceptionally(ex);
                        return null;
                    });
                }

                @Override
                public void onMessage(String message) {
                    handleMessage(sessionId, message);
                }

                @Override
                public void onClose(int code, String reason) {
                    log.info("WebSocket closed for session: {} - {}", sessionId, reason);
                    updateSessionState(sessionId, "DISCONNECTED");
                }

                @Override
                public void onError(Exception ex) {
                    log.error("WebSocket error for session: {}", sessionId, ex);
                    future.completeExceptionally(ex);
                }
            });

            connection.connect();

        } catch (Exception e) {
            log.error("Failed to connect for session: {}", sessionId, e);
            future.completeExceptionally(e);
        }

        return future;
    }

    public void disconnect(String sessionId) {
        OCPPWebSocketConnection connection = connections.remove(sessionId);
        if (connection != null) {
            connection.close();
        }
        transactionIds.remove(sessionId);
    }

    public CompletableFuture<Object> authorize(String sessionId, String idTag) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("idTag", idTag);
        return sendOCPPMessage(sessionId, "Authorize", payload);
    }

    public CompletableFuture<Object> startTransaction(String sessionId, String idTag) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("connectorId", 1);
        payload.put("idTag", idTag);
        payload.put("meterStart", 0);
        payload.put("timestamp", new Date().toInstant().toString());

        return sendOCPPMessage(sessionId, "StartTransaction", payload)
                .thenApply(result -> {
                    if (result instanceof Map) {
                        Map<String, Object> response = (Map<String, Object>) result;
                        Object txId = response.get("transactionId");
                        if (txId != null) {
                            transactionIds.put(sessionId, Integer.parseInt(txId.toString()));
                            updateSessionState(sessionId, "CHARGING");
                            startMeterValueSimulation(sessionId);
                        }
                    }
                    return result;
                });
    }

    public CompletableFuture<Object> stopTransaction(String sessionId) {
        Integer transactionId = transactionIds.get(sessionId);
        if (transactionId == null) {
            return CompletableFuture.failedFuture(new IllegalStateException("No active transaction"));
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("transactionId", transactionId);
        payload.put("meterStop", (int)(Math.random() * 50000));
        payload.put("timestamp", new Date().toInstant().toString());
        payload.put("reason", "Local");

        return sendOCPPMessage(sessionId, "StopTransaction", payload)
                .thenApply(result -> {
                    transactionIds.remove(sessionId);
                    updateSessionState(sessionId, "CONNECTED");
                    stopMeterValueSimulation(sessionId);
                    return result;
                });
    }

    public CompletableFuture<Object> sendOCPPMessage(String sessionId, String action, Object payload) {
        OCPPWebSocketConnection connection = connections.get(sessionId);
        if (connection == null || !connection.isOpen()) {
            return CompletableFuture.failedFuture(new IllegalStateException("Not connected"));
        }

        String messageId = UUID.randomUUID().toString();
        CompletableFuture<Object> future = new CompletableFuture<>();
        pendingRequests.put(messageId, future);

        try {
            String message = buildOCPPMessage(messageId, action, payload);
            connection.send(message);

            // Log outgoing message
            if (onMessageReceived != null) {
                OCPPMessage ocppMsg = OCPPMessage.builder()
                        .id(messageId)
                        .sessionId(sessionId)
                        .cpId(connection.cpId)
                        .direction("SENT")
                        .action(action)
                        .payload(payload)
                        .raw(message)
                        .timestamp(new Date())
                        .build();
                onMessageReceived.accept(ocppMsg);
            }

            // Timeout after 10 seconds
            scheduler.schedule(() -> {
                if (pendingRequests.remove(messageId) != null) {
                    future.completeExceptionally(new TimeoutException("Request timeout"));
                }
            }, 10, TimeUnit.SECONDS);

        } catch (Exception e) {
            pendingRequests.remove(messageId);
            future.completeExceptionally(e);
        }

        return future;
    }

    private CompletableFuture<Object> sendBootNotification(String sessionId, String cpId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("chargePointModel", "SimulatorModel");
        payload.put("chargePointVendor", "SimulatorVendor");
        payload.put("chargePointSerialNumber", cpId);
        payload.put("firmwareVersion", "1.0.0");

        return sendOCPPMessage(sessionId, "BootNotification", payload);
    }

    private void startMeterValueSimulation(String sessionId) {
        Integer transactionId = transactionIds.get(sessionId);
        if (transactionId == null) return;

        ScheduledFuture<?> task = scheduler.scheduleAtFixedRate(() -> {
            if (!transactionIds.containsKey(sessionId)) return;

            sendMeterValues(sessionId, transactionId);
        }, 0, 60, TimeUnit.SECONDS);

        // Store task for cancellation
        connections.get(sessionId).meterValueTask = task;
    }

    private void stopMeterValueSimulation(String sessionId) {
        OCPPWebSocketConnection connection = connections.get(sessionId);
        if (connection != null && connection.meterValueTask != null) {
            connection.meterValueTask.cancel(false);
            connection.meterValueTask = null;
        }
    }

    private void sendMeterValues(String sessionId, Integer transactionId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("connectorId", 1);
        payload.put("transactionId", transactionId);

        List<Map<String, Object>> meterValues = new ArrayList<>();
        Map<String, Object> meterValue = new HashMap<>();
        meterValue.put("timestamp", new Date().toInstant().toString());

        List<Map<String, Object>> sampledValues = new ArrayList<>();

        // Energy
        Map<String, Object> energyValue = new HashMap<>();
        energyValue.put("value", String.valueOf((int)(Math.random() * 50000)));
        energyValue.put("context", "Sample.Periodic");
        energyValue.put("measurand", "Energy.Active.Import.Register");
        energyValue.put("unit", "Wh");
        sampledValues.add(energyValue);

        // Power
        Map<String, Object> powerValue = new HashMap<>();
        powerValue.put("value", String.valueOf((int)(Math.random() * 22000)));
        powerValue.put("context", "Sample.Periodic");
        powerValue.put("measurand", "Power.Active.Import");
        powerValue.put("unit", "W");
        sampledValues.add(powerValue);

        // SoC
        Map<String, Object> socValue = new HashMap<>();
        socValue.put("value", String.valueOf((int)(Math.random() * 100)));
        socValue.put("context", "Sample.Periodic");
        socValue.put("measurand", "SoC");
        socValue.put("unit", "Percent");
        sampledValues.add(socValue);

        meterValue.put("sampledValue", sampledValues);
        meterValues.add(meterValue);
        payload.put("meterValue", meterValues);

        sendOCPPMessage(sessionId, "MeterValues", payload);
    }

    private void handleMessage(String sessionId, String message) {
        try {
            List<Object> msgArray = objectMapper.readValue(message, List.class);
            int messageType = (int) msgArray.get(0);

            if (messageType == 3) { // CALLRESULT
                String messageId = (String) msgArray.get(1);
                Object payload = msgArray.get(2);

                CompletableFuture<Object> future = pendingRequests.remove(messageId);
                if (future != null) {
                    future.complete(payload);
                }

                // Log incoming message
                if (onMessageReceived != null) {
                    OCPPMessage ocppMsg = OCPPMessage.builder()
                            .id(messageId)
                            .sessionId(sessionId)
                            .direction("RECEIVED")
                            .action("Response")
                            .payload(payload)
                            .raw(message)
                            .timestamp(new Date())
                            .build();
                    onMessageReceived.accept(ocppMsg);
                }

            } else if (messageType == 4) { // CALLERROR
                String messageId = (String) msgArray.get(1);
                String errorCode = (String) msgArray.get(2);
                String errorDescription = (String) msgArray.get(3);

                CompletableFuture<Object> future = pendingRequests.remove(messageId);
                if (future != null) {
                    future.completeExceptionally(new RuntimeException(errorCode + ": " + errorDescription));
                }
            }
        } catch (Exception e) {
            log.error("Failed to handle message: {}", message, e);
        }
    }

    private String buildOCPPMessage(String messageId, String action, Object payload) throws Exception {
        List<Object> message = Arrays.asList(2, messageId, action, payload);
        return objectMapper.writeValueAsString(message);
    }

    private void updateSessionState(String sessionId, String state) {
        if (onSessionUpdate != null) {
            SessionUpdate update = new SessionUpdate();
            update.setSessionId(sessionId);
            update.setState(state);
            onSessionUpdate.accept(update);
        }
    }

    // Inner class for WebSocket connection
    private class OCPPWebSocketConnection extends WebSocketClient {
        private final String sessionId;
        private final String cpId;
        private final String bearerToken;
        private ConnectionListener listener;
        private ScheduledFuture<?> meterValueTask;

        public OCPPWebSocketConnection(URI serverUri, String sessionId, String cpId, String bearerToken) {
            super(serverUri);
            this.sessionId = sessionId;
            this.cpId = cpId;
            this.bearerToken = bearerToken;

            if (bearerToken != null && !bearerToken.isEmpty()) {
                this.addHeader("Authorization", "Bearer " + bearerToken);
            }
            this.addHeader("Sec-WebSocket-Protocol", "ocpp1.6");
        }

        public void setConnectionListener(ConnectionListener listener) {
            this.listener = listener;
        }

        @Override
        public void onOpen(ServerHandshake handshake) {
            if (listener != null) listener.onOpen();
        }

        @Override
        public void onMessage(String message) {
            if (listener != null) listener.onMessage(message);
        }

        @Override
        public void onClose(int code, String reason, boolean remote) {
            if (listener != null) listener.onClose(code, reason);
        }

        @Override
        public void onError(Exception ex) {
            if (listener != null) listener.onError(ex);
        }
    }

    private interface ConnectionListener {
        void onOpen();
        void onMessage(String message);
        void onClose(int code, String reason);
        void onError(Exception ex);
    }
}