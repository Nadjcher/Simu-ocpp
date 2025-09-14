package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.TNRScenario;
import com.example.evsesimulator.model.TNREvent;
import com.example.evsesimulator.service.TNRService;
import com.example.evsesimulator.service.TNRService.ExecutionDetail;
import com.example.evsesimulator.service.TNRService.ExecutionMeta;
import com.example.evsesimulator.service.TNRService.RunStatus;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/** Endpoints TNR unifiés — ResponseEntity<?> partout (pas de conflits de types). */
@RestController
@CrossOrigin(origins = {"http://localhost:3002"}, allowCredentials = "true")
@RequestMapping("/api/tnr")
public class TNRController {

    private final TNRService tnr;
    public TNRController(TNRService tnr) { this.tnr = tnr; }

    /* ---------- Status ---------- */
    @GetMapping("/status")
    public ResponseEntity<?> status() { return ResponseEntity.ok(tnr.statusInfo()); }

    /* ---------- Recording ---------- */
    static class StartReq { public String name; public String description; public Map<String,Object> config; }
    @PostMapping("/record/start")
    public ResponseEntity<?> recordStart(@RequestBody(required = false) StartReq req) {
        try {
            Map<String,Object> meta = new LinkedHashMap<>();
            if (req != null) {
                if (req.name != null) meta.put("name", req.name);
                if (req.description != null) meta.put("description", req.description);
                if (req.config != null) meta.put("config", req.config);
            }
            tnr.startRecording(meta);
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) { return error(e); }
    }

    static class StopReq { public String name; public String description; public Boolean baseline; public List<String> tags; }
    @PostMapping("/record/stop")
    public ResponseEntity<?> recordStop(@RequestBody StopReq req) {
        try {
            TNRScenario s = tnr.stopAndSaveRecording(
                    req == null ? null : req.name,
                    req == null ? null : req.description,
                    req != null && Boolean.TRUE.equals(req.baseline),
                    req == null ? List.of() : (req.tags == null ? List.of() : req.tags)
            );
            return ResponseEntity.ok(s);
        } catch (Exception e) { return error(e); }
    }

    /** Alias compatible avec SimuEvseTab: /tap ET /record/event */
    @PostMapping({"/tap", "/record/event"})
    public ResponseEntity<?> tap(@RequestBody TNREvent ev) { tnr.recordEvent(ev); return ResponseEntity.accepted().build(); }

    /* ---------- Scenarios CRUD ---------- */
    @GetMapping("/list") public ResponseEntity<?> list() {
        try { return ResponseEntity.ok(tnr.listScenarios()); } catch (Exception e) { return error(e); }
    }
    @GetMapping("/{id}") public ResponseEntity<?> get(@PathVariable String id) {
        try { return ResponseEntity.ok(tnr.getScenario(id)); } catch (Exception e) { return error(e); }
    }
    @PostMapping("") public ResponseEntity<?> importScenario(@RequestBody TNRScenario s) {
        try { tnr.importScenario(s); return ResponseEntity.ok(Map.of("id", s.getId())); } catch (Exception e) { return error(e); }
    }
    @DeleteMapping("/{id}") public ResponseEntity<?> delete(@PathVariable String id) {
        try { tnr.deleteScenario(id); return ResponseEntity.ok(Map.of("ok", true)); } catch (Exception e) { return error(e); }
    }

    /* ---------- Run & status ---------- */
    @PostMapping("/run/{scenarioId}")
    public ResponseEntity<?> run(@PathVariable String scenarioId,
                                 @RequestParam(name = "realtime", defaultValue = "false") boolean realtime) {
        try { return ResponseEntity.ok(tnr.runScenario(scenarioId, realtime)); } catch (Exception e) { return error(e); }
    }
    @GetMapping("/run/{scenarioId}/status")
    public ResponseEntity<?> runStatus(@PathVariable String scenarioId) {
        RunStatus s = tnr.runStatus(scenarioId);
        if (s == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "no run"));
        return ResponseEntity.ok(s);
    }

    /* ---------- Executions & comparaison ---------- */
    @GetMapping("/executions") public ResponseEntity<?> executions() {
        try { return ResponseEntity.ok(tnr.listExecutions()); } catch (Exception e) { return error(e); }
    }
    @GetMapping("/executions/{execId}") public ResponseEntity<?> execution(@PathVariable String execId) {
        try { return ResponseEntity.ok(tnr.getExecution(execId)); } catch (Exception e) { return error(e); }
    }
    static class CompareReq { public String baseline; public String current; }
    @PostMapping("/compare")
    public ResponseEntity<?> compare(@RequestBody CompareReq req) {
        try { return ResponseEntity.ok(tnr.compareExecutions(req.baseline, req.current)); } catch (Exception e) { return error(e); }
    }

    /* ---------- Perf ---------- */
    @GetMapping("/perf")
    public ResponseEntity<?> perf(@RequestParam(required = false) String scenarioId) {
        try { return ResponseEntity.ok(tnr.performanceSummary(scenarioId)); } catch (Exception e) { return error(e); }
    }

    /* ---------- util ---------- */
    private ResponseEntity<?> error(Exception e) {
        if (e instanceof java.nio.file.NoSuchFileException)
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
    }
}
