package com.example.evsesimulator.service;

import com.example.evsesimulator.model.TNRDifference;
import com.example.evsesimulator.model.TnrPlusCompareResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.Data;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class TnrPlusDiffService {

    private final TNRService tnr;
    private final ObjectMapper mapper = new ObjectMapper();

    public TnrPlusDiffService(TNRService tnr) {
        this.tnr = tnr;
    }

    /** Options de comparaison (toutes facultatives). */
    @Data
    public static class DiffOptions {
        private List<String> ignoreKeys = List.of("timestamp", "latency", "ts", "id", "uuid");
        private boolean strictOrder = true;   // compare par index
        private boolean allowExtras = true;   // tolère des items en plus
        private double numberTolerance = 0.0; // écarte diffs numériques si |a-b| <= tolérance
    }

    public TnrPlusCompareResult compare(String baselineId, String currentId, DiffOptions opts) throws Exception {
        // Récupère les exécutions via TNRService (API publique existante)
        TNRService.ExecutionDetail a = tnr.getExecution(baselineId);
        TNRService.ExecutionDetail b = tnr.getExecution(currentId);

        List<JsonNode> A = normalizeEvents(a.events, opts);
        List<JsonNode> B = normalizeEvents(b.events, opts);

        List<TNRDifference> diffs = new ArrayList<>();
        int max = Math.max(A.size(), B.size());

        for (int i = 0; i < max; i++) {
            JsonNode ea = i < A.size() ? A.get(i) : null;
            JsonNode eb = i < B.size() ? B.get(i) : null;

            if (ea == null && eb != null) {
                TNRDifference d = new TNRDifference();
                d.setEventIndex(i);
                d.setPath("/");
                d.setType("extra");
                d.setExpected(null);
                d.setActual(mapper.convertValue(eb, Object.class));
                diffs.add(d);
                continue;
            }
            if (ea != null && eb == null) {
                TNRDifference d = new TNRDifference();
                d.setEventIndex(i);
                d.setPath("/");
                d.setType("missing");
                d.setExpected(mapper.convertValue(ea, Object.class));
                d.setActual(null);
                diffs.add(d);
                continue;
            }
            // Diff profond champ par champ
            diffNode(i, "", ea, eb, diffs, opts);
        }

        boolean signaturesEqual = Objects.equals(a.signature, b.signature);

        return TnrPlusCompareResult.builder()
                .baselineId(baselineId)
                .currentId(currentId)
                .signatureMatch(signaturesEqual)
                .totalEventsBaseline(A.size())
                .totalEventsCurrent(B.size())
                .differencesCount(diffs.size())
                .differences(diffs)
                .build();
    }

    /* ------------ Implémentation ------------ */

    private List<JsonNode> normalizeEvents(List<com.example.evsesimulator.model.TNREvent> list, DiffOptions opts) {
        if (list == null) return List.of();
        return list.stream().map(ev -> {
            // Map -> JsonNode puis nettoyage des clés ignorées
            ObjectNode n = mapper.valueToTree(ev);
            removeKeysDeep(n, new HashSet<>(opts.getIgnoreKeys()));
            return n;
        }).collect(Collectors.toList());
    }

    private void removeKeysDeep(ObjectNode obj, Set<String> ignore) {
        Iterator<String> it = obj.fieldNames();
        List<String> toRemove = new ArrayList<>();
        while (it.hasNext()) {
            String k = it.next();
            if (ignore.contains(k)) {
                toRemove.add(k);
            } else {
                JsonNode v = obj.get(k);
                if (v.isObject()) removeKeysDeep((ObjectNode) v, ignore);
                else if (v.isArray()) {
                    for (JsonNode e : v) {
                        if (e.isObject()) removeKeysDeep((ObjectNode) e, ignore);
                    }
                }
            }
        }
        toRemove.forEach(obj::remove);
    }

    private void diffNode(int idx, String path, JsonNode a, JsonNode b,
                          List<TNRDifference> out, DiffOptions opts) {
        if (a == null && b == null) return;

        if (a == null || b == null) {
            TNRDifference d = new TNRDifference();
            d.setEventIndex(idx);
            d.setPath(ptr(path));
            d.setType(a == null ? "extra" : "missing");
            d.setExpected(a == null ? null : mapper.convertValue(a, Object.class));
            d.setActual(b == null ? null : mapper.convertValue(b, Object.class));
            out.add(d);
            return;
        }

        if (a.isNumber() && b.isNumber() && opts.getNumberTolerance() > 0) {
            double da = a.asDouble();
            double db = b.asDouble();
            if (Math.abs(da - db) <= opts.getNumberTolerance()) return; // ignoré
        }

        if (a.getNodeType() != b.getNodeType()) {
            TNRDifference d = new TNRDifference();
            d.setEventIndex(idx);
            d.setPath(ptr(path));
            d.setType("different");
            d.setExpected(mapper.convertValue(a, Object.class));
            d.setActual(mapper.convertValue(b, Object.class));
            out.add(d);
            return;
        }

        switch (a.getNodeType()) {
            case OBJECT -> {
                Set<String> keys = new TreeSet<>();
                a.fieldNames().forEachRemaining(keys::add);
                b.fieldNames().forEachRemaining(keys::add);
                for (String k : keys) {
                    diffNode(idx, path + "/" + escape(k),
                            a.get(k) == null ? JsonNodeFactory.instance.nullNode() : a.get(k),
                            b.get(k) == null ? JsonNodeFactory.instance.nullNode() : b.get(k),
                            out, opts);
                }
            }
            case ARRAY -> {
                int sizeA = a.size(), sizeB = b.size();
                int n = Math.max(sizeA, sizeB);
                for (int i = 0; i < n; i++) {
                    JsonNode ea = i < sizeA ? a.get(i) : null;
                    JsonNode eb = i < sizeB ? b.get(i) : null;
                    if (ea == null || eb == null) {
                        if (!opts.isAllowExtras()) {
                            TNRDifference d = new TNRDifference();
                            d.setEventIndex(idx);
                            d.setPath(ptr(path + "/" + i));
                            d.setType(ea == null ? "extra" : "missing");
                            d.setExpected(ea == null ? null : mapper.convertValue(ea, Object.class));
                            d.setActual(eb == null ? null : mapper.convertValue(eb, Object.class));
                            out.add(d);
                        }
                        continue;
                    }
                    diffNode(idx, path + "/" + i, ea, eb, out, opts);
                }
            }
            default -> {
                if (!a.equals(b)) {
                    TNRDifference d = new TNRDifference();
                    d.setEventIndex(idx);
                    d.setPath(ptr(path));
                    d.setType("different");
                    d.setExpected(mapper.convertValue(a, Object.class));
                    d.setActual(mapper.convertValue(b, Object.class));
                    out.add(d);
                }
            }
        }
    }

    private String ptr(String p) { return p.isEmpty() ? "/" : p; }
    private String escape(String s) { return s.replace("~", "~0").replace("/", "~1"); }
}

