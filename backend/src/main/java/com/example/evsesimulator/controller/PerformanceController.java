package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.PerformanceMetrics;
import com.example.evsesimulator.service.PerformanceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/performance")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class PerformanceController {

    private final PerformanceService performanceService;

    @PostMapping("/test/start")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> startPerformanceTest(
            @RequestBody Map<String, Object> request) {

        String url = (String) request.getOrDefault("url", "wss://pp.total-ev-charge.com/ocpp/WebSocket");
        Integer initialBatch = (Integer) request.getOrDefault("initialBatch", 10);
        Integer targetSessions = (Integer) request.getOrDefault("targetSessions", 1000);

        return performanceService.startAdaptiveTest(url, initialBatch, targetSessions)
                .thenApply(result -> ResponseEntity.ok(result))
                .exceptionally(ex -> {
                    Map<String, Object> error = new HashMap<>();
                    error.put("success", false);
                    error.put("error", ex.getMessage());
                    return ResponseEntity.badRequest().body(error);
                });
    }

    @PostMapping("/test/stop")
    public ResponseEntity<Map<String, Object>> stopPerformanceTest() {
        performanceService.stopTest();
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "Test stopped");
        return ResponseEntity.ok(response);
    }

    @GetMapping("/metrics")
    public ResponseEntity<PerformanceMetrics> getCurrentMetrics() {
        return ResponseEntity.ok(performanceService.getCurrentMetrics());
    }

    @GetMapping("/results")
    public ResponseEntity<List<PerformanceService.PerfResult>> getResults() {
        return ResponseEntity.ok(performanceService.getResults());
    }

    @PostMapping("/import/csv")
    public ResponseEntity<Map<String, Object>> importCSV(@RequestParam("file") MultipartFile file) {
        try {
            String content = new String(file.getBytes(), StandardCharsets.UTF_8);
            Map<String, Object> result = performanceService.importCSV(content);
            result.put("success", true);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    @PostMapping("/batch/test")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> runBatchTest(
            @RequestBody Map<String, Object> request) {

        String url = (String) request.get("url");
        List<Map<String, String>> sessions = (List<Map<String, String>>) request.get("sessions");

        if (url == null || sessions == null || sessions.isEmpty()) {
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("error", "Invalid request parameters");
            return CompletableFuture.completedFuture(ResponseEntity.badRequest().body(error));
        }

        // Lancer le test pour chaque session du CSV
        List<CompletableFuture<PerformanceService.PerfResult>> futures = new ArrayList<>();

        for (Map<String, String> session : sessions) {
            String cpId = session.get("cpId");
            String tagId = session.get("tagId");

            // Créer un test pour cette session
            // futures.add(performanceService.testSingleSession(url, cpId, tagId));
        }

        return CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                .thenApply(v -> {
                    Map<String, Object> result = new HashMap<>();
                    result.put("success", true);
                    result.put("totalSessions", sessions.size());
                    result.put("results", performanceService.getResults());
                    return ResponseEntity.ok(result);
                });
    }
}