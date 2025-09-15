// frontend/src/components/PerfOCPPPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { perf as runner } from "@/services/api";

/** ---------------- Types pool navigateur ---------------- */
type Status =
    | "queued"
    | "connecting"
    | "connected"
    | "booted"
    | "authorized"
    | "started"
    | "stopped"
    | "closed"
    | "error";

type Row = {
    cpId: string;
    idTag: string;
    status: Status;
    err: string | null;
    ws: WebSocket | null;
    txId: number | null;
    pending: Map<string, string>;
    seq: number;
    boot?: number;
    auth?: number;
    start?: number;
    stop?: number;
};

type PoolCounters = { total: number; active: number; started: number; finished: number; errors: number; msgs: number };

function nowIso() {
    return new Date().toISOString();
}
function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/** ---------------- MiniGraph SVG ---------------- */
function MiniGraph({
                       series,
                       colors,
                       title,
                       height = 140,
                       width = 380,
                       maxPoints = 120,
                   }: {
    series: number[][];
    colors: string[];
    title?: string;
    height?: number;
    width?: number;
    maxPoints?: number;
}) {
    const margin = { t: 10, r: 10, b: 18, l: 28 };
    const w = width - margin.l - margin.r;
    const h = height - margin.t - margin.b;

    // calcul des bornes
    const xMax = maxPoints - 1;
    const yMax = Math.max(1, ...series.flat());

    function linePath(vals: number[]) {
        const pts = vals.slice(-maxPoints);
        const stepX = w / Math.max(1, pts.length - 1);
        return pts
            .map((v, i) => {
                const x = margin.l + i * stepX;
                const y = margin.t + (1 - v / yMax) * h;
                return `${i === 0 ? "M" : "L"}${x},${y}`;
            })
            .join(" ");
    }

    return (
        <svg width={width} height={height} style={{ border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
            <g>
                {/* axes */}
                <line x1={margin.l} y1={margin.t} x2={margin.l} y2={margin.t + h} stroke="#ddd" />
                <line x1={margin.l} y1={margin.t + h} x2={margin.l + w} y2={margin.t + h} stroke="#ddd" />
                {/* graduations Y */}
                {Array.from({ length: 4 }).map((_, i) => {
                    const y = margin.t + (i / 3) * h;
                    const val = Math.round((1 - i / 3) * yMax);
                    return (
                        <g key={i}>
                            <line x1={margin.l - 4} y1={y} x2={margin.l} y2={y} stroke="#ccc" />
                            <text x={4} y={y + 4} fontSize="10" fill="#777">
                                {val}
                            </text>
                        </g>
                    );
                })}
                {/* courbes */}
                {series.map((vals, i) => (
                    <path key={i} d={linePath(vals)} fill="none" stroke={colors[i]} strokeWidth={2} />
                ))}
                <text x={margin.l} y={12} fontSize="12" fill="#444">
                    {title || ""}
                </text>
            </g>
        </svg>
    );
}

/** ---------------- Composant Principal ---------------- */
export default function PerfOCPPPanel() {
    /** ------- pool navigateur ------- */
    const [wsUrl, setWsUrl] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");
    const [maxConc, setMaxConc] = useState(40);
    const [rampMs, setRampMs] = useState(250);
    const [holdSec, setHoldSec] = useState(60);
    const [mvEverySec, setMvEverySec] = useState(0);

    const [csvTxt, setCsvTxt] = useState("");
    const [rows, setRows] = useState<Row[]>([]);
    const [kActive, setKActive] = useState<number[]>([]);
    const [kStarted, setKStarted] = useState<number[]>([]);
    const [kFinished, setKFinished] = useState<number[]>([]);
    const [poolStats, setPoolStats] = useState<PoolCounters>({
        total: 0,
        active: 0,
        started: 0,
        finished: 0,
        errors: 0,
        msgs: 0,
    });
    const [poolLogs, setPoolLogs] = useState<string[]>([]);
    const connectingRef = useRef(0);

    function addLog(line: string) {
        setPoolLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${line}`].slice(-400));
    }

    function pushKpis() {
        const active = rows.filter((r) => ["connecting", "connected", "booted", "authorized", "started"].includes(r.status)).length;
        const started = rows.filter((r) => r.status === "started").length;
        const finished = rows.filter((r) => ["stopped", "closed"].includes(r.status)).length;

        setKActive((a) => [...a, active].slice(-180));
        setKStarted((a) => [...a, started].slice(-180));
        setKFinished((a) => [...a, finished].slice(-180));
    }

    useEffect(() => {
        pushKpis();
        setPoolStats((s) => ({ ...s, total: rows.length }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows]);

    function parseCsv(text: string) {
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        return lines
            .map((l) => l.split(/[,;|\s]+/))
            .filter((a) => a[0])
            .map(([cpId, idTag]) => ({ cpId, idTag: idTag || "TAG", status: "queued" as Status }));
    }

    function loadCsvToList() {
        const items = parseCsv(csvTxt).map<Row>((x) => ({
            cpId: x.cpId,
            idTag: x.idTag,
            status: "queued",
            err: null,
            ws: null,
            txId: null,
            pending: new Map(),
            seq: 1,
        }));
        setRows(items);
        addLog(`CSV chargé : ${items.length} lignes`);
    }

    function endpoint(base: string, cpId: string) {
        return base.endsWith("/") ? base + cpId : `${base}/${cpId}`;
    }
    function nextMsgId(r: Row) {
        return `${Date.now()}-${r.seq++}`;
    }

    function sendCall(r: Row, action: string, payload: any) {
        if (!r.ws || r.ws.readyState !== r.ws.OPEN) return;
        const id = nextMsgId(r);
        r.pending.set(id, action);
        const frame = [2, id, action, payload || {}];
        try {
            r.ws.send(JSON.stringify(frame));
            setPoolStats((s) => ({ ...s, msgs: s.msgs + 1 }));
            addLog(`>> ${r.cpId} ${action}`);
        } catch (e: any) {
            r.err = `send ${action}: ${e?.message || e}`;
            r.status = "error";
            setRows((rs) => [...rs]);
        }
    }

    function handleMessage(r: Row, data: string) {
        let msg: any;
        try {
            msg = JSON.parse(data);
        } catch {
            r.err = "parse error";
            r.status = "error";
            setRows((rs) => [...rs]);
            return;
        }
        const type = msg[0];

        // CALLRESULT
        if (type === 3) {
            const [, id, payload] = msg;
            const action = r.pending.get(id);
            r.pending.delete(id);

            if (action === "BootNotification") {
                if (payload?.status === "Accepted") {
                    r.status = "booted";
                } else {
                    r.status = "error";
                    r.err = "Boot rejected";
                }
                setRows((rs) => [...rs]);
                return;
            }

            if (action === "Authorize") {
                const ok = payload?.idTagInfo?.status === "Accepted";
                if (!ok) {
                    r.status = "error";
                    r.err = "Authorize rejected";
                } else {
                    r.status = "authorized";
                }
                setRows((rs) => [...rs]);
                return;
            }

            if (action === "StartTransaction") {
                const tx = payload?.transactionId;
                if (!tx) {
                    r.status = "error";
                    r.err = "StartTransaction no txId";
                } else {
                    r.txId = tx;
                    r.status = "started";
                }
                setRows((rs) => [...rs]);
                return;
            }

            if (action === "StopTransaction") {
                r.status = "stopped";
                setRows((rs) => [...rs]);
                setPoolStats((s) => ({ ...s, finished: s.finished + 1 }));
                r.ws?.close();
                return;
            }
            return;
        }

        // CALL (CSMS -> EVSE)
        if (type === 2) {
            const [, callId, action, payload] = msg;
            try {
                if (action === "GetConfiguration") {
                    const body = {
                        configurationKey: [
                            { key: "HeartbeatInterval", readonly: false, value: "300" },
                            { key: "MeterValueSampleInterval", readonly: false, value: String(mvEverySec || 0) },
                        ],
                        unknownKey: [],
                    };
                    r.ws?.send(JSON.stringify([3, callId, body]));
                    return;
                }
                // ACK par défaut
                r.ws?.send(JSON.stringify([3, callId, { status: "Accepted" }]));
            } catch {}
            return;
        }

        // CALLERROR
        if (type === 4) {
            const [, , code, desc] = msg;
            r.status = "error";
            r.err = `OCPP ${code}: ${desc}`;
            setRows((rs) => [...rs]);
        }
    }

    async function connectRow(r: Row) {
        const url = endpoint(wsUrl, r.cpId);
        r.status = "connecting";
        setRows((rs) => [...rs]);

        try {
            r.ws = new WebSocket(url, "ocpp1.6");
        } catch (e: any) {
            r.status = "error";
            r.err = e?.message || String(e);
            setRows((rs) => [...rs]);
            return;
        }

        r.ws.onopen = () => {
            r.status = "connected";
            setRows((rs) => [...rs]);
            sendCall(r, "BootNotification", {
                chargePointVendor: "EVSE Simulator",
                chargePointModel: "Browser pool",
                chargePointSerialNumber: r.cpId,
                chargeBoxSerialNumber: r.cpId,
                meterType: "AC",
                firmwareVersion: "ui-1.0",
            });
        };
        r.ws.onmessage = (ev) => handleMessage(r, ev.data.toString());
        r.ws.onerror = () => {
            r.status = "error";
            r.err = "WebSocket error";
            setRows((rs) => [...rs]);
        };
        r.ws.onclose = () => {
            if (r.status !== "stopped") r.status = "closed";
            setRows((rs) => [...rs]);
        };
    }

    async function connectAll() {
        if (!rows.length) {
            addLog("Aucune ligne (CSV) — charge d’abord la liste.");
            return;
        }
        addLog(`Connect: ${rows.length} sessions (max conc=${maxConc}, ramp=${rampMs}ms)`);
        connectingRef.current = 0;
        const queue = rows.filter((r) => r.status === "queued" || r.status === "closed" || r.status === "error");
        let i = 0;

        while (i < queue.length) {
            // respect du concurrent max
            const inFlight = rows.filter((r) => ["connecting", "connected", "booted", "authorized", "started"].includes(r.status)).length;
            if (inFlight >= maxConc) {
                await sleep(rampMs);
                continue;
            }
            const r = queue[i++];
            // eslint-disable-next-line no-await-in-loop
            await connectRow(r);
            // eslint-disable-next-line no-await-in-loop
            await sleep(rampMs);
        }
    }

    function startAll() {
        rows.forEach((r) => {
            if (r.status === "booted" || r.status === "authorized") {
                sendCall(r, "Authorize", { idTag: r.idTag });
                // le Start suit l’Authorize lorsque le CALLRESULT arrive
                // petite sécurité : relance Start si déjà authorized
                if (r.status === "authorized") {
                    sendCall(r, "StartTransaction", { connectorId: 1, idTag: r.idTag, meterStart: 0, timestamp: nowIso() });
                }
                if (holdSec > 0) {
                    setTimeout(() => {
                        if (r.status === "started" && r.txId != null) {
                            sendCall(r, "StopTransaction", { transactionId: r.txId, meterStop: 0, timestamp: nowIso(), reason: "Local" });
                        }
                    }, holdSec * 1000);
                }
            }
        });
    }

    function stopAll() {
        rows.forEach((r) => {
            if (r.status === "started" && r.txId != null) {
                sendCall(r, "StopTransaction", { transactionId: r.txId, meterStop: 0, timestamp: nowIso(), reason: "Local" });
            }
        });
    }

    function disconnectAll() {
        rows.forEach((r) => {
            try {
                r.ws?.close();
            } catch {}
            r.status = "closed";
        });
        setRows((rs) => [...rs]);
    }

    function importCsvFileToList(f: File) {
        const reader = new FileReader();
        reader.onload = () => {
            setCsvTxt(String(reader.result || ""));
            // charge auto
            setTimeout(loadCsvToList, 0);
        };
        reader.readAsText(f);
    }

    /** ------- runner HTTP ------- */
    const [runnerUrlWs, setRunnerUrlWs] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");
    const [runnerCount, setRunnerCount] = useState(100);
    const [runnerConc, setRunnerConc] = useState(20);
    const [runnerRamp, setRunnerRamp] = useState(250);
    const [runnerHold, setRunnerHold] = useState(200);
    const [runnerMv, setRunnerMv] = useState(20);
    const [runnerUseCsv, setRunnerUseCsv] = useState(true);
    const [runnerCsv, setRunnerCsv] = useState("");
    const [runnerLogs, setRunnerLogs] = useState<string[]>([]);
    const runnerTimer = useRef<number | null>(null);

    function rLog(s: string) {
        setRunnerLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${s}`].slice(-500));
    }

    async function runnerImportCsv() {
        if (!runnerCsv.trim()) {
            rLog("CSV vide.");
            return;
        }
        try {
            const out = await runner.importCsv(runnerCsv);
            rLog(`Import CSV runner: ${out.count} lignes.`);
        } catch (e: any) {
            rLog(`Import CSV: ${e?.message || e}`);
        }
    }

    async function runnerStart() {
        try {
            const out = await runner.start({
                url: runnerUrlWs,
                sessions: runnerCount,
                concurrent: runnerConc,
                rampMs: runnerRamp,
                holdSec: runnerHold,
                mvEverySec: runnerMv,
                useCsv: runnerUseCsv,
            });
            rLog(`RUN start ok (runId=${out.runId})`);
            // démarrer polling
            if (runnerTimer.current) window.clearInterval(runnerTimer.current);
            runnerTimer.current = window.setInterval(async () => {
                try {
                    const st = await runner.status();
                    const a = st?.stats || {};
                    rLog(`status: total=${a.total ?? 0} active=${a.active ?? 0} finished=${a.finished ?? 0} errors=${a.errors ?? 0} msgs=${a.msgs ?? 0}`);
                } catch (e: any) {
                    rLog(`status error: ${e?.message || e}`);
                }
            }, 1000);
        } catch (e: any) {
            rLog(`RUN start error: ${e?.message || e}`);
        }
    }

    async function runnerStop() {
        try {
            const out = await runner.stop();
            rLog(`RUN stop: ${out.ok ? "ok" : "ko"}`);
        } catch (e: any) {
            rLog(`RUN stop error: ${e?.message || e}`);
        } finally {
            if (runnerTimer.current) {
                window.clearInterval(runnerTimer.current);
                runnerTimer.current = null;
            }
        }
    }

    /** ---------------- Render ---------------- */
    return (
        <div className="perf-panel" style={{ padding: 16 }}>
            {/* ====== Bloc 1 : Perf OCPP (navigateur) ====== */}
            <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginTop: 0, marginBottom: 10 }}>Perf OCPP (navigateur)</h3>

                <div className="row">
                    <div>
                        <label>OCPP WS URL</label>
                        <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
                    </div>
                    <div>
                        <label>Max concurrents</label>
                        <input type="number" value={maxConc} onChange={(e) => setMaxConc(Number(e.target.value || 0))} />
                    </div>
                    <div>
                        <label>Ramp (ms)</label>
                        <input type="number" value={rampMs} onChange={(e) => setRampMs(Number(e.target.value || 0))} />
                    </div>
                    <div>
                        <label>Hold avant Stop (s)</label>
                        <input type="number" value={holdSec} onChange={(e) => setHoldSec(Number(e.target.value || 0))} />
                    </div>
                </div>

                <div className="row">
                    <div>
                        <label>MV toutes (s) – info</label>
                        <input type="number" value={mvEverySec} onChange={(e) => setMvEverySec(Number(e.target.value || 0))} />
                    </div>
                    <div style={{ gridColumn: "span 3" }}>
                        <label>Utiliser CSV (cpId,idTag)</label>
                        <textarea
                            rows={4}
                            value={csvTxt}
                            onChange={(e) => setCsvTxt(e.target.value)}
                            placeholder={"cp0001,TAG-0001\ncp0002,TAG-0002"}
                        />
                        <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                            <button className="primary" onClick={loadCsvToList}>
                                Charger dans la liste
                            </button>
                            <input
                                type="file"
                                accept=".csv,text/plain"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) importCsvFileToList(f);
                                }}
                            />
                            <button onClick={connectAll}>Connect</button>
                            <button onClick={startAll}>Start All</button>
                            <button onClick={stopAll}>Stop All</button>
                            <button className="danger" onClick={disconnectAll}>
                                Disconnect All
                            </button>
                        </div>
                    </div>
                </div>

                {/* KPIs + Graph */}
                <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 12 }}>
                    <MiniGraph
                        title="Sessions actives / started / terminées"
                        series={[kActive, kStarted, kFinished]}
                        colors={["#2d7ef7", "#2bb673", "#888888"]}
                    />
                    <div className="kpi">
                        <div>
                            <div>Total</div>
                            <div style={{ fontSize: 22, fontWeight: 600 }}>{poolStats.total}</div>
                        </div>
                        <div>
                            <div>Actives</div>
                            <div style={{ fontSize: 22, fontWeight: 600 }}>{rows.filter((r) => r.status === "started").length}</div>
                        </div>
                        <div>
                            <div>Terminées</div>
                            <div style={{ fontSize: 22, fontWeight: 600 }}>{rows.filter((r) => ["stopped", "closed"].includes(r.status)).length}</div>
                        </div>
                        <div>
                            <div>Msgs</div>
                            <div style={{ fontSize: 22, fontWeight: 600 }}>{poolStats.msgs}</div>
                        </div>
                    </div>
                </div>

                {/* Tableau pool */}
                <div style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                    <table>
                        <thead>
                        <tr>
                            <th style={{ width: 240 }}>url</th>
                            <th style={{ width: 120 }}>cpId</th>
                            <th style={{ width: 100 }}>status</th>
                            <th style={{ width: 40 }}>boot</th>
                            <th style={{ width: 40 }}>auth</th>
                            <th style={{ width: 40 }}>start</th>
                            <th style={{ width: 40 }}>stop</th>
                            <th>Erreur</th>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((r) => (
                            <tr key={r.cpId}>
                                <td style={{ color: "#1d4ed8" }}>{endpoint(wsUrl, r.cpId)}</td>
                                <td>{r.cpId}</td>
                                <td>{r.status}</td>
                                <td>{r.boot ?? 0}</td>
                                <td>{r.auth ?? 0}</td>
                                <td>{r.start ?? 0}</td>
                                <td>{r.stop ?? 0}</td>
                                <td style={{ color: "#b91c1c" }}>{r.err || ""}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>

                {/* Logs pool */}
                <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 6, fontWeight: 600 }}>Logs</div>
                    <div className="logs">{poolLogs.join("\n")}</div>
                </div>
            </div>

            {/* ====== Bloc 2 : Runner HTTP (campagnes lourdes) ====== */}
            <div className="card">
                <h3 style={{ marginTop: 0, marginBottom: 10 }}>Runner HTTP (campagnes lourdes)</h3>

                <div className="row">
                    <div style={{ gridColumn: "span 2" }}>
                        <label>OCPP WebSocket URL</label>
                        <input value={runnerUrlWs} onChange={(e) => setRunnerUrlWs(e.target.value)} />
                    </div>
                    <div>
                        <label>Sessions</label>
                        <input type="number" value={runnerCount} onChange={(e) => setRunnerCount(Number(e.target.value || 0))} />
                    </div>
                    <div>
                        <label>Concurrent</label>
                        <input type="number" value={runnerConc} onChange={(e) => setRunnerConc(Number(e.target.value || 0))} />
                    </div>
                </div>

                <div className="row">
                    <div>
                        <label>Ramp (ms)</label>
                        <input type="number" value={runnerRamp} onChange={(e) => setRunnerRamp(Number(e.target.value || 0))} />
                    </div>
                    <div>
                        <label>Hold (s)</label>
                        <input type="number" value={runnerHold} onChange={(e) => setRunnerHold(Number(e.target.value || 0))} />
                    </div>
                    <div>
                        <label>MeterValues (s)</label>
                        <input type="number" value={runnerMv} onChange={(e) => setRunnerMv(Number(e.target.value || 0))} />
                    </div>
                    <div>
                        <label style={{ display: "block" }}>
                            <input type="checkbox" checked={runnerUseCsv} onChange={(e) => setRunnerUseCsv(e.target.checked)} /> Utiliser CSV (cpId,idTag)
                        </label>
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
          <textarea
              rows={4}
              value={runnerCsv}
              onChange={(e) => setRunnerCsv(e.target.value)}
              placeholder={"cp0001,TAG-0001\ncp0002,TAG-0002"}
          />
                    <button onClick={runnerImportCsv}>Importer CSV</button>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="primary" onClick={runnerStart}>
                            START
                        </button>
                        <button className="danger" onClick={runnerStop}>
                            STOP
                        </button>
                    </div>
                </div>

                {/* Logs runner */}
                <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 6, fontWeight: 600 }}>Status runner / Logs</div>
                    <div className="logs">{runnerLogs.join("\n")}</div>
                </div>
            </div>
        </div>
    );
}
