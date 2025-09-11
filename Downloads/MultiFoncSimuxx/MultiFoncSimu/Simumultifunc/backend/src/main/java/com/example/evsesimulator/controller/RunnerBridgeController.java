package com.example.evsesimulator.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.Collections;

@RestController
@RequestMapping("/api/runner")
@Tag(name = "runner-bridge", description = "Proxy vers le runner Node/Express pour sessions / perf / TNR")
public class RunnerBridgeController {

    private final RestTemplate http;
    private final String runnerBaseUrl;

    public RunnerBridgeController(RestTemplate http, @Qualifier("runnerBaseUrl") String runnerBaseUrl) {
        this.http = http;
        this.runnerBaseUrl = runnerBaseUrl;
    }

    // --------- Helpers

    private String toRunnerUrl(HttpServletRequest req) {
        // /api/runner/**  ->  **  sur le runner
        String path = req.getRequestURI().replaceFirst("^/api/runner", "");
        String query = (req.getQueryString() == null || req.getQueryString().isBlank())
                ? "" : "?" + req.getQueryString();
        return runnerBaseUrl + path + query;
    }

    private HttpHeaders copyHeaders(HttpHeaders in) {
        HttpHeaders out = new HttpHeaders();
        out.setAccept(Collections.singletonList(MediaType.ALL));
        out.setContentType(in.getContentType() != null ? in.getContentType() : MediaType.APPLICATION_JSON);
        // (si besoin, recopier d’autres headers)
        return out;
    }

    private ResponseEntity<byte[]> forward(HttpMethod method,
                                           HttpServletRequest req,
                                           @RequestBody(required = false) byte[] body) {
        String target = toRunnerUrl(req);
        HttpHeaders headers = copyHeaders(new HttpHeaders());
        HttpEntity<byte[]> entity = new HttpEntity<>(body, headers);
        return http.exchange(URI.create(target), method, entity, byte[].class);
    }

    // --------- Endpoints génériques : on forward vers le runner

    @Operation(summary = "Proxy GET vers le runner (sessions/perf/tnr…)")
    @RequestMapping(value = "/**", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> proxyGET(HttpServletRequest req) {
        return forward(HttpMethod.GET, req, null);
    }

    @Operation(summary = "Proxy POST vers le runner (sessions/perf/tnr…)")
    @RequestMapping(value = "/**", method = RequestMethod.POST, consumes = MediaType.ALL_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> proxyPOST(HttpServletRequest req, @RequestBody(required = false) byte[] body) {
        return forward(HttpMethod.POST, req, body);
    }

    @Operation(summary = "Proxy PUT vers le runner")
    @RequestMapping(value = "/**", method = RequestMethod.PUT, consumes = MediaType.ALL_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> proxyPUT(HttpServletRequest req, @RequestBody(required = false) byte[] body) {
        return forward(HttpMethod.PUT, req, body);
    }

    @Operation(summary = "Proxy DELETE vers le runner")
    @RequestMapping(value = "/**", method = RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> proxyDELETE(HttpServletRequest req) {
        return forward(HttpMethod.DELETE, req, null);
    }

    @Operation(summary = "Proxy PATCH vers le runner")
    @RequestMapping(value = "/**", method = RequestMethod.PATCH, consumes = MediaType.ALL_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> proxyPATCH(HttpServletRequest req, @RequestBody(required = false) byte[] body) {
        return forward(HttpMethod.PATCH, req, body);
    }
}

