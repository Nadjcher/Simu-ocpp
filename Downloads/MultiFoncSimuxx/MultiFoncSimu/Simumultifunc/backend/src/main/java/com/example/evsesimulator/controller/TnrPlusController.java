package com.example.evsesimulator.controller;

import com.example.evsesimulator.model.TnrPlusCompareResult;
import com.example.evsesimulator.service.TNRService;
import com.example.evsesimulator.service.TnrPlusDiffService;
import com.example.evsesimulator.service.TnrPlusDiffService.DiffOptions;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tnrplus")
public class TnrPlusController {

    private final TNRService tnr;
    private final TnrPlusDiffService diffs;

    public TnrPlusController(TNRService tnr, TnrPlusDiffService diffs) {
        this.tnr = tnr; this.diffs = diffs;
    }

    /** Liste des exécutions (métadonnées) depuis TNRService. */
    @GetMapping("/executions")
    public List<TNRService.ExecutionMeta> executions() throws Exception {
        return tnr.listExecutions();
    }

    /** Compare deux exécutions. */
    public record CompareReq(String baseline, String current,
                             List<String> ignoreKeys, Boolean strictOrder,
                             Boolean allowExtras, Double numberTolerance) {}
    @PostMapping("/compare")
    public TnrPlusCompareResult compare(@RequestBody CompareReq req) throws Exception {
        DiffOptions opt = new DiffOptions();
        if (req.ignoreKeys() != null && !req.ignoreKeys().isEmpty()) opt.setIgnoreKeys(req.ignoreKeys());
        if (req.strictOrder() != null)  opt.setStrictOrder(req.strictOrder());
        if (req.allowExtras() != null)  opt.setAllowExtras(req.allowExtras());
        if (req.numberTolerance() != null) opt.setNumberTolerance(req.numberTolerance());
        return diffs.compare(req.baseline(), req.current(), opt);
    }

    /** Export CSV des différences (utile pour bug report). */
    @PostMapping(value = "/compare/export", produces = "text/csv")
    public ResponseEntity<byte[]> compareExport(@RequestBody CompareReq req) throws Exception {
        TnrPlusCompareResult r = compare(req);
        StringBuilder sb = new StringBuilder("eventIndex,path,type,expected,actual\n");
        for (var d : r.getDifferences()) {
            sb.append(escape(d.getEventIndex()))
                    .append(',').append(csv(d.getPath()))
                    .append(',').append(csv(d.getType()))
                    .append(',').append(csv(String.valueOf(d.getExpected())))
                    .append(',').append(csv(String.valueOf(d.getActual())))
                    .append('\n');
        }
        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=tnr-diff.csv")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(bytes);
    }

    private String csv(String s) { if (s == null) return ""; return '"' + s.replace("\"","\"\"") + '"'; }
    private String escape(Object o) { return o == null ? "" : String.valueOf(o); }
}
