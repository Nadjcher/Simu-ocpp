package com.example.evsesimulator.service;

import com.example.evsesimulator.model.PerformanceMetrics;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@Slf4j
@Service
public class PerformanceService {

    @Autowired
    private OCPPWebSocketClient ocppClient;

    @Autowired
    private WebSocketBroadcaster broadcaster;

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(10);
    private final ExecutorService executor = Executors.newFixedThreadPool(100);

    private volatile boolean testRunning = false;
    private final AtomicInteger totalSessions = new AtomicInteger(0);
    private final AtomicInteger activeSessions = new AtomicInteger(0);
    private final AtomicInteger successCount = new AtomicInteger(0);
    private final AtomicInteger errorCount = new AtomicInteger(0);
    private final AtomicLong totalLatency = new AtomicLong(0);
    private final AtomicLong maxLatency = new AtomicLong(0);

    private final List<PerfResult> results = Collections.synchronizedList(new ArrayList<>());

    @Data
    public static class PerfResult {
        private String cpId;
        private String tagId;
        private boolean wsOk;
        private long bootMs;
        private long authMs;
        private long startMs;
        private long stopMs;
        private String error;
        private Date timestamp = new Date();
    }

    public CompletableFuture<Map<String, Object>> startAdaptiveTest(
            String url, int initialBatch, int targetSessions) {

        if (testRunning) {
            return CompletableFuture.failedFuture(
                    new IllegalStateException("Test already running")
            );
        }

        testRunning = true;
        resetMetrics();

        return CompletableFuture.supplyAsync(() -> {
            log.info("Starting adaptive performance test - Target: {} sessions", targetSessions);

            int batchSize = initialBatch;
            long startTime = System.currentTimeMillis();

            // Démarrer la collecte de métriques
            ScheduledFuture<?> metricsTask = scheduler.scheduleAtFixedRate(
                    this::broadcastMetrics, 0, 1, TimeUnit.SECONDS
            );

            try {
                while (testRunning && totalSessions.get() < targetSessions) {
                    long batchStart = System.currentTimeMillis();

                    // Créer un batch de sessions
                    List<CompletableFuture<PerfResult>> futures = new ArrayList<>();

                    for (int i = 0; i < batchSize && totalSessions.get() < targetSessions; i++) {
                        int sessionNum = totalSessions.incrementAndGet();
                        String cpId = String.format("PERF-%06d", sessionNum);
                        String tagId = String.format("TAG-%06d", sessionNum);

                        futures.add(testSingleSession(url, cpId, tagId));
                    }

                    // Attendre que le batch se termine
                    try {
                        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                                .get(30, TimeUnit.SECONDS);
                    } catch (TimeoutException e) {
                        log.warn("Batch timeout, continuing...");
                    }

                    // Adapter la taille du batch
                    long batchTime = System.currentTimeMillis() - batchStart;
                    double successRate = totalSessions.get() > 0 ?
                            (double) successCount.get() / totalSessions.get() : 0;

                    if (successRate > 0.95 && batchTime < 5000) {
                        batchSize = Math.min(batchSize * 2, 100);
                    } else if (successRate < 0.8 || batchTime > 10000) {
                        batchSize = Math.max(batchSize / 2, 1);
                    }

                    log.info("Batch complete - Sessions: {}, Success rate: {:.2f}%, Next batch: {}",
                            totalSessions.get(), successRate * 100, batchSize);

                    // Pause entre les batchs
                    Thread.sleep(100);
                }

            } catch (Exception e) {
                log.error("Performance test failed", e);
            } finally {
                metricsTask.cancel(false);
                testRunning = false;
            }

            long totalTime = System.currentTimeMillis() - startTime;

            Map<String, Object> result = new HashMap<>();
            result.put("totalSessions", totalSessions.get());
            result.put("successCount", successCount.get());
            result.put("errorCount", errorCount.get());
            result.put("successRate", totalSessions.get() > 0 ?
                    (double) successCount.get() / totalSessions.get() * 100 : 0);
            result.put("totalTime", totalTime);
            result.put("avgLatency", totalSessions.get() > 0 ?
                    totalLatency.get() / totalSessions.get() : 0);
            result.put("maxLatency", maxLatency.get());

            return result;
        }, executor);
    }

    private CompletableFuture<PerfResult> testSingleSession(String url, String cpId, String tagId) {
        return CompletableFuture.supplyAsync(() -> {
            PerfResult result = new PerfResult();
            result.setCpId(cpId);
            result.setTagId(tagId);

            String sessionId = "perf-" + cpId;

            try {
                long start = System.currentTimeMillis();

                // Connexion
                ocppClient.connect(sessionId, url, cpId, null).get(5, TimeUnit.SECONDS);
                result.setBootMs(System.currentTimeMillis() - start);

                // Authorize
                start = System.currentTimeMillis();
                ocppClient.authorize(sessionId, tagId).get(5, TimeUnit.SECONDS);
                result.setAuthMs(System.currentTimeMillis() - start);

                // Start Transaction
                start = System.currentTimeMillis();
                ocppClient.startTransaction(sessionId, tagId).get(5, TimeUnit.SECONDS);
                result.setStartMs(System.currentTimeMillis() - start);

                // Simuler la charge
                Thread.sleep(1000 + (int)(Math.random() * 2000));

                // Stop Transaction
                start = System.currentTimeMillis();
                ocppClient.stopTransaction(sessionId).get(5, TimeUnit.SECONDS);
                result.setStopMs(System.currentTimeMillis() - start);

                result.setWsOk(true);
                successCount.incrementAndGet();
                activeSessions.incrementAndGet();

                // Mettre à jour les métriques
                long totalTime = result.getBootMs() + result.getAuthMs() +
                        result.getStartMs() + result.getStopMs();
                totalLatency.addAndGet(totalTime);
                maxLatency.updateAndGet(max -> Math.max(max, totalTime));

            } catch (Exception e) {
                result.setWsOk(false);
                result.setError(e.getMessage());
                errorCount.incrementAndGet();
                log.debug("Session {} failed: {}", cpId, e.getMessage());
            } finally {
                // Déconnexion
                ocppClient.disconnect(sessionId);
                activeSessions.decrementAndGet();
            }

            results.add(result);
            return result;
        }, executor);
    }

    public void stopTest() {
        testRunning = false;
        log.info("Performance test stopped");
    }

    public List<PerfResult> getResults() {
        return new ArrayList<>(results);
    }

    public PerformanceMetrics getCurrentMetrics() {
        return PerformanceMetrics.builder()
                .totalSessions(totalSessions.get())
                .activeSessions(activeSessions.get())
                .successCount(successCount.get())
                .errorCount(errorCount.get())
                .successRate(totalSessions.get() > 0 ?
                        (double) successCount.get() / totalSessions.get() * 100 : 0)
                .avgLatency(totalSessions.get() > 0 ?
                        totalLatency.get() / totalSessions.get() : 0)
                .maxLatency(maxLatency.get())
                .cpuUsage(getCpuUsage())
                .memoryUsage(getMemoryUsage())
                .messagesPerSecond(getMessagesPerSecond())
                .timestamp(new Date())
                .build();
    }

    private void broadcastMetrics() {
        try {
            broadcaster.broadcastPerformanceMetrics(getCurrentMetrics());
        } catch (Exception e) {
            log.error("Failed to broadcast metrics", e);
        }
    }

    private void resetMetrics() {
        totalSessions.set(0);
        activeSessions.set(0);
        successCount.set(0);
        errorCount.set(0);
        totalLatency.set(0);
        maxLatency.set(0);
        results.clear();
    }

    public Map<String, Object> importCSV(String csvContent) {
        List<Map<String, String>> sessions = new ArrayList<>();
        String[] lines = csvContent.split("\n");

        // Skip header if present
        int startLine = 0;
        if (lines.length > 0 && lines[0].toLowerCase().contains("cpid")) {
            startLine = 1;
        }

        for (int i = startLine; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty()) continue;

            String[] parts = line.split(",");
            if (parts.length >= 2) {
                Map<String, String> session = new HashMap<>();
                session.put("cpId", parts[0].trim());
                session.put("tagId", parts[1].trim());
                sessions.add(session);
            }
        }

        log.info("Imported {} sessions from CSV", sessions.size());

        Map<String, Object> result = new HashMap<>();
        result.put("sessions", sessions);
        result.put("count", sessions.size());
        return result;
    }

    private double getCpuUsage() {
        try {
            com.sun.management.OperatingSystemMXBean osBean =
                    (com.sun.management.OperatingSystemMXBean)
                            java.lang.management.ManagementFactory.getOperatingSystemMXBean();
            return osBean.getProcessCpuLoad() * 100;
        } catch (Exception e) {
            return 0.0;
        }
    }

    private double getMemoryUsage() {
        Runtime runtime = Runtime.getRuntime();
        long totalMemory = runtime.totalMemory();
        long freeMemory = runtime.freeMemory();
        long usedMemory = totalMemory - freeMemory;
        return (double) usedMemory / totalMemory * 100;
    }

    private int getMessagesPerSecond() {
        // Simplified calculation - you can enhance this
        return activeSessions.get() * 2; // Estimate based on active sessions
    }
}