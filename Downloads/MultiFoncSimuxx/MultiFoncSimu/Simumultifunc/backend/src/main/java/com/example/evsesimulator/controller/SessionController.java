package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.PagedSessionsResponse;
import com.example.evsesimulator.model.Session;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/**
 * Listing des sessions EVSE (array rétro-compatible ou pagination).
 * Ne dépend pas de getters particuliers de la classe Session.
 */
@RestController
@RequestMapping(path = "/api/simu", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "simu", description = "Pilotage EVSE Simu / OCPP")
public class SessionController {

    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    @GetMapping
    @Operation(summary = "Lister les sessions EVSE Simu (array ou pagination)")
    public ResponseEntity<?> listSessions(
            @RequestParam(name = "paged", defaultValue = "false") boolean paged,
            @RequestParam(name = "limit", defaultValue = "200") int limit,
            @RequestParam(name = "offset", defaultValue = "0") int offset,
            @RequestParam(name = "includeClosed", defaultValue = "true") boolean includeClosed
    ) {
        List<Session> all = loadAllSessions(includeClosed);

        if (!paged) {
            // Rétro-compat : renvoyer directement un tableau
            return ResponseEntity.ok(all);
        }

        if (limit <= 0) limit = 200;
        if (limit > 500) limit = 500;
        if (offset < 0) offset = 0;

        int total = all.size();
        int end = Math.min(offset + limit, total);
        List<Session> slice = offset >= total ? Collections.emptyList() : all.subList(offset, end);
        boolean hasMore = end < total;
        int nextOffset = end;

        PagedSessionsResponse<Session> resp =
                new PagedSessionsResponse<>(total, limit, offset, hasMore, nextOffset, slice);
        return ResponseEntity.ok(resp);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private List<Session> loadAllSessions(boolean includeClosed) {
        Map<String, Session> byId = new LinkedHashMap<>();

        // 1) backend/data/sessions.json ou data/sessions.json
        Path main = Paths.get("backend", "data", "sessions.json");
        if (!Files.exists(main)) main = Paths.get("data", "sessions.json");
        if (Files.exists(main)) {
            try {
                JsonNode root = mapper.readTree(Files.readAllBytes(main));
                if (root != null) {
                    if (root.isArray()) {
                        addFromArrayNode(byId, root, includeClosed);
                    } else if (root.has("sessions") && root.get("sessions").isArray()) {
                        addFromArrayNode(byId, root.get("sessions"), includeClosed);
                    } else {
                        // Cas d’un objet unique potentiellement
                        addFromNode(byId, root, includeClosed);
                    }
                }
            } catch (IOException ignored) {}
        }

        // 2) backend/data/sessions/*.json ou data/sessions/*.json
        Path dir = Paths.get("backend", "data", "sessions");
        if (!Files.isDirectory(dir)) dir = Paths.get("data", "sessions");
        if (Files.isDirectory(dir)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.json")) {
                for (Path p : stream) {
                    try {
                        JsonNode node = mapper.readTree(Files.readAllBytes(p));
                        if (node != null) {
                            if (node.isArray()) {
                                addFromArrayNode(byId, node, includeClosed);
                            } else {
                                addFromNode(byId, node, includeClosed);
                            }
                        }
                    } catch (IOException ignored) {}
                }
            } catch (IOException ignored) {}
        }

        // Tri simple par id décroissant (on ne suppose pas createdAt)
        List<Session> all = new ArrayList<>(byId.values());
        all.sort(Comparator.comparing(Session::getId,
                Comparator.nullsLast(Comparator.naturalOrder())).reversed());
        return all;
    }

    /** Ajoute une session depuis un objet JSON (filtrage includeClosed via champ "status"). */
    private void addFromNode(Map<String, Session> byId, JsonNode node, boolean includeClosed) {
        if (node == null || node.isNull()) return;

        String id = optText(node, "id");
        if (id == null || id.isBlank()) {
            Session tmp = mapper.convertValue(node, Session.class);
            id = tmp != null ? tmp.getId() : null;
        }
        if (id == null || id.isBlank()) return;

        if (!includeClosed) {
            String status = optText(node, "status");
            if ("closed".equalsIgnoreCase(status)) return;
        }

        Session s = mapper.convertValue(node, Session.class);
        if (s != null) byId.put(id, s);
    }

    /** Ajoute plusieurs sessions depuis un tableau JSON. */
    private void addFromArrayNode(Map<String, Session> byId, JsonNode array, boolean includeClosed) {
        for (JsonNode n : array) addFromNode(byId, n, includeClosed);
    }

    private String optText(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v != null && !v.isNull()) ? v.asText(null) : null;
    }
}
