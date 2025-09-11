package com.example.evsesimulator.service;

import com.example.evsesimulator.model.TNRScenario;
import com.example.evsesimulator.model.TNREvent;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service TNR :
 * - recording PERSISTANT (ON jusqu'à /record/stop)
 * - stockage fichiers JSON (scenarios + exécutions)
 * - index d'exécutions, comparaison simple
 * - sidecar .meta.json pour baseline/tags (pas besoin d'ajouter des champs au modèle)
 */
@Service
public class TNRService {

    private final ObjectMapper mapper;
    private final Path baseDir, scenariosDir, execDir;

    private volatile boolean isRecording = false;
    private long recordingStart = 0L;
    private final List<TNREvent> recordingEvents = Collections.synchronizedList(new ArrayList<>());
    private Map<String, Object> recordingMeta = new LinkedHashMap<>();

    /** runs actifs par scenarioId */
    private final Map<String, RunTracker> runs = new ConcurrentHashMap<>();
    /** index des exécutions */
    private final List<ExecutionMeta> executionIndex = Collections.synchronizedList(new ArrayList<>());

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_INSTANT;

    public TNRService(ObjectMapper mapper,
                      @Value("${tnr.dir:./data/tnr}") String tnrDir) throws IOException {
        this.mapper = mapper;
        this.baseDir = Paths.get(tnrDir).toAbsolutePath();
        this.scenariosDir = baseDir.resolve("scenarios");
        this.execDir = baseDir.resolve("executions");
        Files.createDirectories(scenariosDir);
        Files.createDirectories(execDir);
    }

    /* ========== STATUS ========== */

    public Map<String, Object> statusInfo() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("isRecording", isRecording);
        m.put("isReplaying", runs.values().stream().anyMatch(r -> "running".equals(r.status)));
        m.put("recordingEvents", recordingEvents.size());
        m.put("recordingName", recordingMeta.getOrDefault("name", ""));
        m.put("recordingDuration", isRecording ? (System.currentTimeMillis() - recordingStart) : 0);
        return m;
    }

    /* ========== RECORDING ========== */

    public synchronized void startRecording(Map<String, Object> meta) {
        isRecording = true;
        recordingStart = System.currentTimeMillis();
        recordingEvents.clear();
        recordingMeta = meta == null ? new LinkedHashMap<>() : new LinkedHashMap<>(meta);
        if (!recordingMeta.containsKey("startedAt"))
            recordingMeta.put("startedAt", ISO.format(Instant.now()));
    }

    /** alias utilisé par le front EVSE (tap) */
    public void recordEvent(TNREvent ev) {
        if (!isRecording || ev == null) return;
        if (ev.getTimestamp() == null) ev.setTimestamp(System.currentTimeMillis());
        // temps relatif depuis start (facultatif)
        if (!recordingMeta.containsKey("t0")) recordingMeta.put("t0", recordingStart);
        recordingEvents.add(ev);
    }

    public synchronized TNRScenario stopAndSaveRecording(String name,
                                                         String description,
                                                         boolean baseline,
                                                         List<String> tags) throws IOException {
        isRecording = false;
        long duration = System.currentTimeMillis() - recordingStart;

        String scenarioId = genId(name);
        TNRScenario s = new TNRScenario();
        s.setId(scenarioId);
        s.setName((name == null || name.isBlank()) ? scenarioId : name);
        s.setDescription(description);
        s.setCreatedAt(new Date());
        s.setEvents(new ArrayList<>(recordingEvents));

        writeScenario(s);
        writeScenarioSidecar(scenarioId, Map.of(
                "baseline", baseline,
                "tags", tags == null ? List.of() : tags,
                "meta", Map.of(
                        "startedAt", recordingMeta.getOrDefault("startedAt", ISO.format(Instant.now())),
                        "duration", duration
                )
        ));
        return s;
    }

    /* ========== SCENARIOS ========== */

    public List<Map<String, Object>> listScenarios() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(scenariosDir, "*.json")) {
            for (Path p : ds) {
                try {
                    TNRScenario s = mapper.readValue(Files.readString(p), TNRScenario.class);
                    Map<String, Object> side = readScenarioSidecar(stripExt(p.getFileName().toString()));
                    Map<String, Object> meta = new LinkedHashMap<>();
                    meta.put("id", s.getId());
                    meta.put("name", s.getName());
                    meta.put("description", s.getDescription());
                    meta.put("createdAt", s.getCreatedAt() == null ? null : ISO.format(s.getCreatedAt().toInstant()));
                    meta.put("eventsCount", s.getEvents() == null ? 0 : s.getEvents().size());
                    meta.put("tags", side.getOrDefault("tags", List.of()));
                    meta.put("baseline", side.getOrDefault("baseline", false));
                    out.add(meta);
                } catch (Exception ignore) {}
            }
        }
        out.sort(Comparator.comparing(m -> String.valueOf(m.getOrDefault("name", ""))));
        return out;
    }

    public TNRScenario getScenario(String id) throws IOException {
        return mapper.readValue(Files.readString(scenarioPath(id)), TNRScenario.class);
    }

    public void importScenario(TNRScenario s) throws IOException {
        if (s.getId() == null || s.getId().isBlank()) s.setId(genId(s.getName()));
        if (s.getCreatedAt() == null) s.setCreatedAt(new Date());
        writeScenario(s);
    }

    public void deleteScenario(String id) throws IOException {
        Files.deleteIfExists(scenarioPath(id));
        Files.deleteIfExists(scenarioSidecarPath(id));
    }

    /* ========== RUN / EXECUTIONS ========== */

    public RunStatus runScenario(String scenarioId, boolean realtime) throws IOException {
        TNRScenario scenario = getScenario(scenarioId);
        RunTracker tracker = new RunTracker(scenarioId);
        runs.put(scenarioId, tracker);

        new Thread(() -> {
            try {
                tracker.status = "running";
                tracker.startedAt = ISO.format(Instant.now());
                tracker.log("Run started: " + scenario.getName());

                int i = 0;
                List<TNREvent> evs = scenario.getEvents() == null ? List.of() : scenario.getEvents();
                long last = 0;
                for (TNREvent ev : evs) {
                    if (realtime && i > 0 && ev.getTimestamp() != null) {
                        long dt = Math.max(0, ev.getTimestamp() - last);
                        if (dt > 0) try { Thread.sleep(Math.min(dt, 200)); } catch (InterruptedException ignored) {}
                        last = ev.getTimestamp();
                    }
                    tracker.log("#" + i + " " + safe(ev.getType()) + " :: " + safe(ev.getAction()));
                    i++;
                }

                tracker.status = "success";
                tracker.finishedAt = ISO.format(Instant.now());

                saveExecution(tracker, scenario, true, List.of());
                tracker.log("Run finished: OK");
            } catch (Exception e) {
                tracker.status = "failed";
                tracker.finishedAt = ISO.format(Instant.now());
                tracker.log("Run failed: " + e.getMessage());
                try {
                    saveExecution(tracker, scenario, false,
                            List.of(Map.of("type", "error", "path", "/", "expected", null, "actual", e.getMessage())));
                } catch (IOException ignored) {}
            }
        }, "tnr-run-" + scenarioId).start();

        return tracker.toStatus();
    }

    public RunStatus runStatus(String scenarioId) {
        RunTracker t = runs.get(scenarioId);
        return t == null ? null : t.toStatus();
    }

    public List<ExecutionMeta> listExecutions() throws IOException {
        if (executionIndex.isEmpty()) {
            try (DirectoryStream<Path> ds = Files.newDirectoryStream(execDir, "exec_*.json")) {
                for (Path p : ds) {
                    ExecutionDetail d = mapper.readValue(Files.readString(p), ExecutionDetail.class);
                    executionIndex.add(new ExecutionMeta(d.executionId, d.scenarioId, d.timestamp, d.passed, d.metrics));
                }
            }
            executionIndex.sort(Comparator.comparing(ExecutionMeta::timestamp).reversed());
        }
        return new ArrayList<>(executionIndex);
    }

    public ExecutionDetail getExecution(String executionId) throws IOException {
        Path p = execDir.resolve("exec_" + executionId + ".json");
        return mapper.readValue(Files.readString(p), ExecutionDetail.class);
    }

    public Map<String, Object> compareExecutions(String baselineId, String currentId) throws IOException {
        ExecutionDetail a = getExecution(baselineId);
        ExecutionDetail b = getExecution(currentId);
        boolean signatureMatch = Objects.equals(a.signature, b.signature);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("signatureMatch", signatureMatch);
        out.put("diffCount",
                Math.abs((a.differences == null ? 0 : a.differences.size()) -
                        (b.differences == null ? 0 : b.differences.size())));
        out.put("callCountDiff", Map.of("server", 0, "outbound", 0));
        out.put("differences", List.of());
        return out;
    }

    public List<Map<String, Object>> performanceSummary(String scenarioId) throws IOException {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (ExecutionMeta m : listExecutions()) {
            if (scenarioId != null && !scenarioId.isBlank() && !scenarioId.equals(m.scenarioId)) continue;
            rows.add(Map.of(
                    "scenarioId", m.scenarioId,
                    "executionId", m.executionId,
                    "timestamp", m.timestamp,
                    "passed", m.passed,
                    "metrics", m.metrics == null ? Map.of() : m.metrics
            ));
        }
        return rows;
    }

    /* ========== Helpers stockage ========== */

    private Path scenarioPath(String id) { return scenariosDir.resolve(id + ".json"); }
    private Path scenarioSidecarPath(String id) { return scenariosDir.resolve(id + ".meta.json"); }

    private void writeScenario(TNRScenario s) throws IOException {
        Files.writeString(scenarioPath(s.getId()),
                mapper.writerWithDefaultPrettyPrinter().writeValueAsString(s),
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    }

    private void writeScenarioSidecar(String id, Map<String, Object> meta) throws IOException {
        Files.writeString(scenarioSidecarPath(id),
                mapper.writerWithDefaultPrettyPrinter().writeValueAsString(meta),
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    }

    private Map<String, Object> readScenarioSidecar(String id) {
        try {
            Path p = scenarioSidecarPath(id);
            if (!Files.exists(p)) return Map.of();
            return mapper.readValue(Files.readString(p), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) { return Map.of(); }
    }

    private String stripExt(String fn) { int i = fn.lastIndexOf('.'); return i < 0 ? fn : fn.substring(0, i); }

    private String genId(String name) {
        String base = (name == null || name.isBlank()) ? "scenario" :
                name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-");
        return base + "-" + System.currentTimeMillis();
    }

    private static String safe(Object o) { return o == null ? "" : String.valueOf(o); }

    private void saveExecution(RunTracker tracker, TNRScenario scenario, boolean pass,
                               List<Map<String, Object>> diffs) throws IOException {
        ExecutionDetail d = new ExecutionDetail();
        d.scenarioId = tracker.scenarioId;
        d.executionId = tracker.executionId;
        d.timestamp = tracker.startedAt;
        d.passed = pass;
        d.differences = diffs;
        d.events = scenario.getEvents() == null ? List.of() : scenario.getEvents();
        d.metrics = Map.of("totalEvents", d.events.size());
        d.signature = sha1(mapper.writeValueAsBytes(d.events));
        Files.writeString(execDir.resolve("exec_" + d.executionId + ".json"),
                mapper.writerWithDefaultPrettyPrinter().writeValueAsString(d),
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        executionIndex.add(0, new ExecutionMeta(d.executionId, d.scenarioId, d.timestamp, d.passed, d.metrics));
    }

    private static String sha1(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest(data)) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { return ""; }
    }

    /* ========== DTO internes ========== */

    public static class RunStatus {
        public String scenarioId;
        public String startedAt;
        public String finishedAt;
        public String status; // running|success|failed
        public List<Map<String, String>> logs = new ArrayList<>();
    }

    private static class RunTracker {
        final String scenarioId;
        final String executionId = UUID.randomUUID().toString().replace("-", "");
        String status = "running";
        String startedAt = ISO.format(Instant.now());
        String finishedAt = null;
        final List<Map<String, String>> logs = Collections.synchronizedList(new ArrayList<>());
        RunTracker(String scenarioId) { this.scenarioId = scenarioId; }
        void log(String line) {
            logs.add(Map.of("ts", ISO.format(Instant.now()), "line", line));
            if (logs.size() > 1000) logs.remove(0);
        }
        RunStatus toStatus() {
            RunStatus s = new RunStatus();
            s.scenarioId = scenarioId; s.startedAt = startedAt; s.finishedAt = finishedAt; s.status = status;
            s.logs = new ArrayList<>(logs); return s;
        }
    }

    public static class ExecutionMeta {
        public String executionId, scenarioId, timestamp; public boolean passed; public Map<String, Object> metrics;
        public ExecutionMeta() {}
        public ExecutionMeta(String e, String s, String t, boolean p, Map<String, Object> m) { executionId=e; scenarioId=s; timestamp=t; passed=p; metrics=m; }
        public String timestamp() { return timestamp; }
    }
    public static class ExecutionDetail {
        public String scenarioId, executionId, timestamp; public boolean passed;
        public List<Map<String, Object>> differences = List.of(); public List<TNREvent> events = List.of();
        public Map<String, Object> metrics = Map.of(); public String signature;
    }
}
