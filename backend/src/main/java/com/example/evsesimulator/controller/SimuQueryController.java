package com.example.evsesimulator.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.net.URI;

@RestController
@RequestMapping("/api/simu/query")
@Tag(name = "simu-query", description = "Ancien endpoint de requêtage des sessions (déprécié)")
@Deprecated
public class SimuQueryController {

    @GetMapping
    @Operation(
            summary = "Redirect vers /api/simu (paginé)",
            description = "Endpoint déprécié. Utilisez /api/simu?paged=true"
    )
    public ResponseEntity<Void> list(
            @RequestParam(name = "limit", defaultValue = "200") int limit,
            @RequestParam(name = "offset", defaultValue = "0") int offset,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "includeClosed", defaultValue = "1") int includeClosed
    ) {
        boolean include = includeClosed != 0;

        URI target = ServletUriComponentsBuilder.fromCurrentContextPath()
                .path("/api/simu")
                .queryParam("paged", true)
                .queryParam("limit", limit)
                .queryParam("offset", offset)
                .queryParam("includeClosed", include)
                .build()
                .toUri();

        return ResponseEntity.status(HttpStatus.TEMPORARY_REDIRECT).location(target).build();
    }
}
