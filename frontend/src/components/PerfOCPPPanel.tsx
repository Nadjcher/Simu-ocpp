// frontend/src/components/PerfOCPPPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { perf } from "../services/api";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */
type RowStatus =
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
    status: RowStatus;
    err: string | null;
    ws: WebSocket | null;
    txId: number | null;
    pending: Map<string, string>;
    seq: number;
    boot?: number;
    auth?: number;
    start?: number;
    stop?: number;
    // MV
    _mvTimer?: number | null;
    _startedAt?: number; // epoch ms
};

function parseCsv(text: string): Array<{ cpId: string; idTag: string }> {
    return String(text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/[,;|\s]+/))
        .filter((a) => a[0])
        .map(([cpId, idTag]) => ({
            cpId: cpId.trim(),
            idTag: (idTag || "TAG").trim(),
        }));
}

function nowIso() {
    return new Date().toISOString();
}

function ensureCsvHeader(csv: string): string {
    const t = csv.trim();
    if (!t) return "";
    const first = t.split(/\r?\n/, 1)[0].toLowerCase();
    const hasHeader = first.includes("cpid") && first.includes("idtag");
    return hasHeader ? t : `cpId,idTag\n${t}`;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PerfOCPPPanel() {
    /* ========================= Bloc 1 – Pool navigateur ========================= */
    const [wsBase, setWsBase] = useState(
        "wss://evse-test.total-ev-charge.com/ocpp/WebSocket"
    );
    const [maxConc, setMaxConc] = useState(20);
    const [rampMs, setRampMs] = useState(250);
    const [holdSec, setHoldSec] = useState(60);
    const [mvEverySec, setMvEverySec] = useState(0); // 0 = off (envoi réel si > 0)
    const [useCsv, setUseCsv] = useState(true);
    const [csvText, setCsvText] = useState("");
    const [rows, setRows] = useState<Row[]>([]);
    const poolAbort = useRef<{ stopped: boolean }>({ stopped: false });

    // MV réalisme côté navigateur
    const [powerKW, setPowerKW] = useState<number>(7.4);
    const [voltageV, setVoltageV] = useState<number>(230);

    // CSV via fichier
    const [fileCsvText, setFileCsvText] = useState("");
    const onPickCsvFile = async (f: File | null) => {
        if (!f) return;
        const text = await f.text();
        setFileCsvText(text);
    };

    // --- Pagination
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [rows.length, pageSize, totalPages, page]);

    const pageRows = useMemo(() => {
        const start = (page - 1) * pageSize;
        return rows.slice(start, start + pageSize);
    }, [rows, page, pageSize]);

    // métriques & graph
    const poolStats = useMemo(() => {
        const total = rows.length;
        const actives = rows.filter((r) =>
            ["connecting", "connected", "booted", "authorized", "started"].includes(
                r.status
            )
        ).length;
        const started = rows.filter((r) => r.status === "started").length;
        const finished = rows.filter((r) => r.status === "stopped").length;
        const errors = rows.filter((r) => r.status === "error").length;
        return { total, actives, started, finished, errors };
    }, [rows]);

    const avgLatency = useMemo(() => {
        const samples = rows.map((r) => r.start || 0).filter((x) => x > 0);
        if (!samples.length) return 0;
        return Math.round(
            samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length)
        );
    }, [rows]);

    const chartRef = useRef<HTMLCanvasElement | null>(null);
    const chartSeries = useRef<Array<{
        t: number;
        actives: number;
        started: number;
        finished: number;
    }>>([]);
    useEffect(() => {
        const id = window.setInterval(() => {
            chartSeries.current.push({
                t: Date.now(),
                actives: poolStats.actives,
                started: poolStats.started,
                finished: poolStats.finished,
            });

            const canvas = chartRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            const W = canvas.width;
            const H = canvas.height;

            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, W, H);

            ctx.strokeStyle = "#e5e7eb";
            ctx.lineWidth = 1;
            for (let i = 1; i < 4; i++) {
                const y = (H / 4) * i;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
            }

            const data = chartSeries.current;
            const maxY =
                Math.max(
                    1,
                    ...data.map((d) => Math.max(d.actives, d.started, d.finished))
                ) || 1;

            const drawLine = (
                sel: (d: { t: number; actives: number; started: number; finished: number }) => number,
                color: string
            ) => {
                ctx.beginPath();
                data.forEach((d: { t: number; actives: number; started: number; finished: number }, i: number) => {
                    const x = (i / Math.max(1, data.length - 1)) * (W - 6) + 3;
                    const y = H - (sel(d) / maxY) * (H - 6) - 3;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();
            };

            drawLine((d) => d.actives, "#3b82f6");
            drawLine((d) => d.started, "#10b981");
            drawLine((d) => d.finished, "#f59e0b");
        }, 1000);
        return () => window.clearInterval(id);
    }, [poolStats]);

    // CSV -> lignes (priorité fichier s'il existe)
    const loadCsvToList = () => {
        const source = (fileCsvText || csvText).trim();
        const parsed = parseCsv(source);
        const newRows: Row[] = parsed.map((p) => ({
            cpId: p.cpId,
            idTag: p.idTag,
            status: "queued",
            err: null,
            ws: null,
            txId: null,
            pending: new Map(),
            seq: 1,
            _mvTimer: null,
            _startedAt: undefined,
        }));
        setRows(newRows);
        setPage(1);
    };

    const wsEndpoint = (base: string, cpId: string) =>
        base.endsWith("/") ? base + cpId : `${base}/${cpId}`;

    const sendCall = (row: Row, action: string, payload?: any) => {
        if (!row.ws || row.ws.readyState !== WebSocket.OPEN) {
            console.warn(`[${row.cpId}] WebSocket not open for ${action}`);
            return null;
        }
        const id = `${Date.now()}-${row.seq++}`;
        row.pending.set(id, action);
        const frame = [2, id, action, payload || {}];

        try {
            const frameStr = JSON.stringify(frame);
            console.log(`[${row.cpId}] Sending ${action}:`, frameStr);
            row.ws.send(frameStr);
            return id;
        } catch (e: any) {
            console.error(`[${row.cpId}] Send error:`, e);
            row.status = "error";
            row.err = `Send error: ${e?.message || e}`;
            setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
            return null;
        }
    };

    const stopMeterValues = (row: Row) => {
        if (row._mvTimer) {
            window.clearInterval(row._mvTimer);
            row._mvTimer = null;
        }
    };

    const startMeterValues = (row: Row) => {
        stopMeterValues(row);
        const every = Math.max(1, Number(mvEverySec || 0));
        if (every <= 0) return;

        // calculs réalistes
        const powerW = Math.max(0, (powerKW || 0) * 1000);
        const voltage = Math.max(1, voltageV || 230);
        const currentA = Math.round((powerW / voltage) * 10) / 10;

        row._startedAt = Date.now();
        row._mvTimer = window.setInterval(() => {
            if (!row.ws || row.ws.readyState !== row.ws.OPEN || !row.txId) return;
            const elapsedSec = ((Date.now() - (row._startedAt || Date.now())) / 1000) | 0;
            const energyWh = Math.round((powerW * elapsedSec) / 3600);

            sendCall(row, "MeterValues", {
                connectorId: 1,
                transactionId: row.txId,
                meterValue: [
                    {
                        timestamp: new Date().toISOString(),
                        sampledValue: [
                            {
                                value: String(energyWh),
                                measurand: "Energy.Active.Import.Register",
                                unit: "Wh",
                                context: "Sample.Periodic",
                            },
                            {
                                value: String(Math.round(powerW)),
                                measurand: "Power.Active.Import",
                                unit: "W",
                                context: "Sample.Periodic",
                            },
                            {
                                value: String(currentA),
                                measurand: "Current.Import",
                                unit: "A",
                                context: "Sample.Periodic",
                            },
                            {
                                value: String(voltage),
                                measurand: "Voltage",
                                unit: "V",
                                context: "Sample.Periodic",
                            },
                        ],
                    },
                ],
            });
        }, every * 1000);
    };

    const connectOne = (row: Row) =>
        new Promise<void>((resolve) => {
            const url = wsEndpoint(wsBase, row.cpId);
            row.status = "connecting";
            setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));

            let t0Boot = 0;
            let t0Auth = 0;
            let t0Start = 0;
            let t0Stop = 0;

            try {
                console.log(`[${row.cpId}] Connecting to ${url}`);
                const ws = new WebSocket(url, "ocpp1.6");
                row.ws = ws;

                ws.onopen = () => {
                    console.log(`[${row.cpId}] WebSocket opened`);
                    row.status = "connected";
                    setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));

                    // Attendre 100ms avant d'envoyer BootNotification
                    setTimeout(() => {
                        if (row.ws && row.ws.readyState === WebSocket.OPEN) {
                            t0Boot = performance.now();
                            sendCall(row, "BootNotification", {
                                chargePointVendor: "Test",
                                chargePointModel: "Sim",
                                firmwareVersion: "1.0"
                            });
                        }
                    }, 100);
                };

                ws.onmessage = (ev) => {
                    const dataStr = ev.data.toString();
                    console.log(`[${row.cpId}] Received:`, dataStr);

                    let msg: any;
                    try {
                        msg = JSON.parse(dataStr);
                    } catch (e) {
                        console.error(`[${row.cpId}] Parse error:`, e, "Data:", dataStr);
                        row.status = "error";
                        row.err = "parse message";
                        setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
                        return;
                    }

                    const type = msg[0];

                    // CALLRESULT
                    if (type === 3) {
                        const [, id, payload] = msg;
                        const action = row.pending.get(id);
                        row.pending.delete(id);

                        console.log(`[${row.cpId}] Result for ${action}:`, payload);

                        if (action === "BootNotification") {
                            row.boot = Math.round(performance.now() - t0Boot);
                            if (payload?.status === "Accepted") {
                                row.status = "booted";
                                setRows((old) =>
                                    old.map((r) => (r.cpId === row.cpId ? { ...row } : r))
                                );

                                /*// Auto-authorize après boot si nécessaire
                                setTimeout(() => {
                                    if (row.ws && row.ws.readyState === WebSocket.OPEN && row.status === "booted") {
                                        t0Auth = performance.now();
                                        sendCall(row, "Authorize", { idTag: row.idTag || "TAG" });
                                    }
                                }, 500);*/
                            } else {
                                row.status = "error";
                                row.err = `Boot rejected: ${JSON.stringify(payload)}`;
                                setRows((old) =>
                                    old.map((r) => (r.cpId === row.cpId ? { ...row } : r))
                                );
                            }
                            return;
                        }

                        if (action === "Authorize") {
                            row.auth = Math.round(performance.now() - t0Auth);
                            const ok = payload?.idTagInfo?.status === "Accepted";
                            if (!ok) {
                                row.status = "error";
                                row.err = `Auth rejected: ${payload?.idTagInfo?.status}`;
                                setRows((old) =>
                                    old.map((r) => (r.cpId === row.cpId ? { ...row } : r))
                                );
                                return;
                            }
                            row.status = "authorized";
                            setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));

                           /* // Auto-start après auth
                            setTimeout(() => {
                                if (row.ws && row.ws.readyState === WebSocket.OPEN && row.status === "authorized") {
                                    t0Start = performance.now();
                                    row.txId = null;
                                    sendCall(row, "StartTransaction", {
                                        connectorId: 1,
                                        idTag: row.idTag,
                                        meterStart: 0,
                                        timestamp: nowIso(),
                                    });
                                }
                            }, 500);*/
                            return;
                        }

                        if (action === "StartTransaction") {
                            row.start = Math.round(performance.now() - t0Start);
                            const tx = payload?.transactionId;
                            if (!tx && tx !== 0) {
                                row.status = "error";
                                row.err = "StartTransaction: no txId";
                                setRows((old) =>
                                    old.map((r) => (r.cpId === row.cpId ? { ...row } : r))
                                );
                                return;
                            }
                            row.txId = tx;
                            row.status = "started";
                            setRows((old) =>
                                old.map((r) => (r.cpId === row.cpId ? { ...row } : r))
                            );

                            if (mvEverySec > 0) startMeterValues(row);

                            if (holdSec > 0) {
                                setTimeout(() => stopOne(row), holdSec * 1000);
                            }
                            return;
                        }

                        if (action === "StopTransaction") {
                            row.stop = Math.round(performance.now() - t0Stop);
                            row.status = "stopped";
                            stopMeterValues(row);
                            setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
                            try {
                                row.ws?.close();
                            } catch {}
                            return;
                        }
                    }

                    // CALL from server
                    if (type === 2) {
                        const [, callId, action, payload] = msg;
                        console.log(`[${row.cpId}] Server call ${action}:`, payload);
                        try {
                            if (action === "GetConfiguration") {
                                const body = {
                                    configurationKey: [
                                        { key: "HeartbeatInterval", readonly: false, value: "300" },
                                        { key: "MeterValueSampleInterval", readonly: false, value: String(mvEverySec || 0) },
                                    ],
                                    unknownKey: [],
                                };
                                row.ws?.send(JSON.stringify([3, callId, body]));
                                return;
                            }
                            // ACK par défaut
                            row.ws?.send(JSON.stringify([3, callId, { status: "Accepted" }]));
                        } catch {}
                        return;
                    }

                    // CALLERROR
                    if (type === 4) {
                        const [, id, code, desc, details] = msg;
                        console.error(`[${row.cpId}] OCPP Error:`, code, desc, details);
                        row.status = "error";
                        row.err = `OCPP ${code}: ${desc}`;
                        stopMeterValues(row);
                        setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
                    }
                };

                ws.onerror = (evt) => {
                    console.error(`[${row.cpId}] WebSocket error:`, evt);
                    row.status = "error";
                    row.err = "WebSocket error";
                    stopMeterValues(row);
                    setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
                };

                ws.onclose = (evt) => {
                    console.log(`[${row.cpId}] WebSocket closed:`, evt.code, evt.reason);
                    if (row.status !== "error" && row.status !== "stopped") {
                        row.status = "closed";
                        stopMeterValues(row);
                        setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
                    }
                    resolve();
                };
            } catch (e: any) {
                console.error(`[${row.cpId}] Connection error:`, e);
                row.status = "error";
                row.err = e?.message || String(e);
                stopMeterValues(row);
                setRows((old) => old.map((r) => (r.cpId === row.cpId ? { ...row } : r)));
                resolve();
            }
        });

    const connectPool = async () => {
        poolAbort.current.stopped = false;
        let inflight = 0;

        // Ne connecter que les sessions "queued"
        const toConnect = rows.filter(r => r.status === "queued");

        for (let i = 0; i < toConnect.length; i++) {
            if (poolAbort.current.stopped) break;
            while (inflight >= maxConc) await new Promise((r) => setTimeout(r, 10));

            inflight++;
            const row = toConnect[i];
            connectOne(row).finally(() => {
                inflight = Math.max(0, inflight - 1);
            });

            await new Promise((r) => setTimeout(r, rampMs));
        }
    };

    const startAll = () => {
        setRows((old) => {
            old.forEach((row) => {
                if (row.ws && row.ws.readyState === row.ws.OPEN) {
                    if (row.status === "booted") {
                        sendCall(row, "Authorize", { idTag: row.idTag || "TAG" });
                    } else if (row.status === "authorized") {
                        const t0Start = performance.now();
                        (row as any)._t0Start = t0Start;
                        sendCall(row, "StartTransaction", {
                            connectorId: 1,
                            idTag: row.idTag || "TAG",
                            meterStart: 0,
                            timestamp: nowIso(),
                        });
                    }
                }
            });
            return [...old];
        });
    };

    const stopOne = (row: Row) => {
        if (!row.txId || !row.ws || row.ws.readyState !== row.ws.OPEN) return;
        const tx = row.txId;
        const t0Stop = performance.now();
        row.stop = undefined;
        (row as any)._t0Stop = t0Stop;
        sendCall(row, "StopTransaction", {
            transactionId: tx,
            meterStop: 0,
            timestamp: nowIso(),
            reason: "Local",
        });
    };

    const stopAll = () => {
        setRows((old) => {
            old.forEach((row) => stopOne(row));
            return [...old];
        });
    };

    const disconnectAll = () => {
        poolAbort.current.stopped = true;
        setRows((old) => {
            old.forEach((r) => {
                try {
                    stopMeterValues(r);
                    r.ws?.close();
                } catch {}
            });
            return [...old];
        });
    };
    const resetAll = () => {
        // Fermer toutes les connexions existantes
        rows.forEach((r) => {
            try {
                stopMeterValues(r);
                r.ws?.close();
            } catch {}
        });

        // Réinitialiser tous les statuts
        setRows((old) =>
            old.map((r) => ({
                ...r,
                status: "queued",
                ws: null,
                txId: null,
                err: null,
                pending: new Map(),
                seq: 1,
                boot: undefined,
                auth: undefined,
                start: undefined,
                stop: undefined,
                _mvTimer: null,
                _startedAt: undefined,
            }))
        );
    };

    /* ========================= Bloc 2 – Runner HTTP ========================= */
    const [runnerWsUrl, setRunnerWsUrl] = useState(wsBase);
    const [sessions, setSessions] = useState(10);
    const [concurrent, setConcurrent] = useState(20);
    const [runnerRamp, setRunnerRamp] = useState(250);
    const [runnerHold, setRunnerHold] = useState(60);
    const [mvEvery, setMvEvery] = useState(10);
    const [runnerUseCsv, setRunnerUseCsv] = useState(true);
    const [runnerCsv, setRunnerCsv] = useState("");
    const [runnerStatus, setRunnerStatus] = useState("IDLE");
    const [logs, setLogs] = useState<string[]>([]);
    const [rStats, setRStats] = useState({
        total: 0,
        active: 0,
        finished: 0,
        errors: 0,
        avgLatencyMs: 0,
        cpu: 0,
    });
    const pollRef = useRef<number | null>(null);

    // Ajout : paramètres de MV pour le runner
    const [runnerPowerKW, setRunnerPowerKW] = useState<number>(7.4);
    const [runnerVoltageV, setRunnerVoltageV] = useState<number>(230);

    const appendLog = (line: string) => {
        setLogs((l) => {
            const next = [...l, line];
            if (next.length > 1000) next.shift();
            return next;
        });
    };

    const pollStatus = async () => {
        try {
            const s: any = await perf.status();
            const status = s?.run?.status || s?.status || "IDLE";
            setRunnerStatus(status);
            const st = s?.stats || s || {};
            setRStats({
                total: Number(st.total || 0),
                active: Number(st.active || 0),
                finished: Number(st.finished || 0),
                errors: Number(st.errors || 0),
                avgLatencyMs: Number(st.avgLatencyMs || 0),
                cpu: Number(st.cpu || 0),
            });
            appendLog(
                `[${new Date().toTimeString().slice(0, 8)}] status: ${status}, total=${
                    st.total ?? 0
                } active=${st.active ?? 0} finished=${st.finished ?? 0} errors=${
                    st.errors ?? 0
                }`
            );
        } catch (e: any) {
            setRunnerStatus("IDLE");
            appendLog(
                `[${new Date().toTimeString().slice(0, 8)}] status error: ${e?.message || e}`
            );
        }
    };

    const onConnectRunner = async () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
        await pollStatus();
        pollRef.current = window.setInterval(pollStatus, 1000);
    };

    const onImportCsvRunner = async () => {
        try {
            const csv = ensureCsvHeader(runnerCsv);
            if (!csv) {
                appendLog("[runner] CSV vide.");
                return;
            }
            const res = await perf.importCsv(csv);
            appendLog(`[runner] CSV import ok: count=${(res as any)?.count ?? "?"}`);
        } catch (e: any) {
            appendLog(`[runner] CSV import error: ${e?.message || e}`);
        }
    };

    const onStartRunner = async () => {
        try {
            const body: any = {
                url: runnerWsUrl,
                sessions,
                concurrent,
                rampMs: runnerRamp,
                holdSec: runnerHold,
                mvEverySec: mvEvery,
                useCsv: runnerUseCsv,
                powerKW: runnerPowerKW,
                voltageV: runnerVoltageV,
            };
            if (runnerUseCsv && runnerCsv.trim())
                body.csvText = ensureCsvHeader(runnerCsv);
            const res = await perf.start(body);
            appendLog(`[runner] start ok: runId=${(res as any)?.runId || "?"}`);
            await pollStatus();
            if (!pollRef.current) pollRef.current = window.setInterval(pollStatus, 1000);
        } catch (e: any) {
            appendLog(`[runner] start error: ${e?.message || e}`);
        }
    };

    const onStopRunner = async () => {
        try {
            await perf.stop(); // le backend envoie les StopTransaction, puis ferme
            appendLog("[runner] stop ok");
            await pollStatus();
        } catch (e: any) {
            appendLog(`[runner] stop error: ${e?.message || e}`);
        }
    };

    // file input runner
    const onPickRunnerCsvFile = async (f: File | null) => {
        if (!f) return;
        const text = await f.text();
        setRunnerCsv(text);
    };

    useEffect(() => {
        return () => {
            if (pollRef.current) window.clearInterval(pollRef.current);
        };
    }, []);

    /* ------------------------------------------------------------------ */
    /* UI (reste inchangé)                                                */
    /* ------------------------------------------------------------------ */
    return (
        <div className="space-y-8">
            {/* ===================== Bloc 1 – Perf OCPP (navigateur) ===================== */}
            <div className="bg-white text-gray-900 rounded-xl border border-gray-200 shadow-sm">
                <div className="p-4 md:p-5 border-b border-gray-100">
                    <h2 className="text-lg font-semibold">Perf OCPP (navigateur)</h2>
                </div>

                <div className="p-4 md:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-7 space-y-3">
                        <label className="block text-sm font-medium">OCPP WS URL</label>
                        <input
                            className="w-full rounded-md border-gray-300"
                            value={wsBase}
                            onChange={(e) => setWsBase(e.target.value)}
                            placeholder="wss://.../ocpp/WebSocket"
                        />

                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                            <div>
                                <label className="block text-sm">Max concurrents</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={maxConc}
                                    onChange={(e) => setMaxConc(parseInt(e.target.value, 10) || 0)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Ramp (ms)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={rampMs}
                                    onChange={(e) => setRampMs(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Hold avant Stop (s)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={holdSec}
                                    onChange={(e) => setHoldSec(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">MV toutes (s) – 0=off</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={mvEverySec}
                                    onChange={(e) => setMvEverySec(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Puissance (kW)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    className="w-full rounded-md border-gray-300"
                                    value={powerKW}
                                    onChange={(e) => setPowerKW(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Tension (V)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={voltageV}
                                    onChange={(e) => setVoltageV(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <label className="inline-flex items-center gap-2 mt-1">
                            <input
                                type="checkbox"
                                checked={useCsv}
                                onChange={(e) => setUseCsv(e.target.checked)}
                            />
                            <span className="text-sm">Utiliser CSV (cpId,idTag)</span>
                        </label>

                        {/* Fichier + texte */}
                        <div className="flex items-center gap-2">
                            <label className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 border text-sm cursor-pointer">
                                Choisir un fichier
                                <input
                                    type="file"
                                    accept=".csv,text/csv,text/plain"
                                    className="hidden"
                                    onChange={(e) => onPickCsvFile(e.target.files?.[0] || null)}
                                />
                            </label>
                            <span className="text-xs text-gray-500">
                (ou colle ci-dessous et clique « Charger dans la liste »)
              </span>
                        </div>
                        <textarea
                            className="w-full h-28 rounded-md border-gray-300"
                            value={csvText}
                            onChange={(e) => setCsvText(e.target.value)}
                            placeholder={`cp0001, TAG-0001\ncp0002, TAG-0002`}
                        />

                        <div className="flex flex-wrap gap-2">
                            <button
                                className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 border text-sm"
                                onClick={loadCsvToList}
                            >
                                Charger dans la liste
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm"
                                onClick={connectPool}
                            >
                                Connect
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 text-sm"
                                onClick={startAll}
                            >
                                Start All
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 text-sm"
                                onClick={stopAll}
                            >
                                Stop All
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 text-sm"
                                onClick={disconnectAll}
                            >
                                Disconnect All
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 text-sm"
                                onClick={resetAll}
                            >
                                Reset All
                            </button>
                        </div>
                    </div>

                    {/* Métriques + graphe */}
                    <div className="lg:col-span-5 space-y-3">
                        <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-2xl font-semibold">{poolStats.total}</div>
                                <div className="text-xs text-gray-500">Total</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-2xl font-semibold">{poolStats.actives}</div>
                                <div className="text-xs text-gray-500">Actives</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-2xl font-semibold">{poolStats.finished}</div>
                                <div className="text-xs text-gray-500">Terminées</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-2xl font-semibold text-rose-600">
                                    {poolStats.errors}
                                </div>
                                <div className="text-xs text-gray-500">Erreurs</div>
                            </div>
                        </div>
                        <div className="rounded-md border bg-white p-2">
                            <div className="text-xs text-gray-600 mb-1">
                                Latence moy. (start) : <b>{avgLatency} ms</b>
                            </div>
                            <canvas ref={chartRef} width={520} height={160} />
                            <div className="flex gap-3 text-xs text-gray-500 mt-1">
                                <span>• Actives</span>
                                <span>• Started</span>
                                <span>• Terminées</span>
                            </div>
                        </div>
                    </div>

                    {/* Tableau + pagination */}
                    <div className="lg:col-span-12 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-600">
                                Affiche{" "}
                                <select
                                    className="border rounded px-1 py-0.5"
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value));
                                        setPage(1);
                                    }}
                                >
                                    {[10, 25, 50, 100].map((n) => (
                                        <option key={n} value={n}>
                                            {n}
                                        </option>
                                    ))}
                                </select>{" "}
                                lignes par page
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <button
                                    className="px-2 py-1 border rounded disabled:opacity-40"
                                    disabled={page <= 1}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                >
                                    ◀ Précédent
                                </button>
                                <span>
                  {rows.length === 0
                      ? "0–0"
                      : `${(page - 1) * pageSize + 1}–${Math.min(
                          page * pageSize,
                          rows.length
                      )}`}{" "}
                                    sur {rows.length}
                </span>
                                <button
                                    className="px-2 py-1 border rounded disabled:opacity-40"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                >
                                    Suivant ▶
                                </button>
                            </div>
                        </div>

                        <div className="overflow-auto border rounded-md">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left px-3 py-2 border-b">cpId</th>
                                    <th className="text-left px-3 py-2 border-b">idTag</th>
                                    <th className="text-left px-3 py-2 border-b">status</th>
                                    <th className="text-left px-3 py-2 border-b">txId</th>
                                    <th className="text-left px-3 py-2 border-b">err</th>
                                </tr>
                                </thead>
                                <tbody>
                                {pageRows.map((r) => (
                                    <tr key={r.cpId} className="odd:bg-white even:bg-gray-50">
                                        <td className="px-3 py-1 border-b">{r.cpId}</td>
                                        <td className="px-3 py-1 border-b">{r.idTag}</td>
                                        <td className="px-3 py-1 border-b">{r.status}</td>
                                        <td className="px-3 py-1 border-b">{r.txId ?? ""}</td>
                                        <td className="px-3 py-1 border-b text-rose-600">
                                            {r.err ?? ""}
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-3 text-gray-500" colSpan={5}>
                                            (aucune ligne – choisis un fichier CSV ou colle du texte
                                            puis clique « Charger dans la liste »)
                                        </td>
                                    </tr>
                                )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* ===================== Bloc 2 – Runner HTTP (campagnes lourdes) ===================== */}
            <div className="bg-white text-gray-900 rounded-xl border border-gray-200 shadow-sm">
                <div className="p-4 md:p-5 border-b border-gray-100">
                    <h2 className="text-lg font-semibold">Runner HTTP (campagnes lourdes)</h2>
                </div>

                <div className="p-4 md:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-6 space-y-3">
                        <label className="block text-sm font-medium">OCPP WebSocket URL</label>
                        <input
                            className="w-full rounded-md border-gray-300"
                            value={runnerWsUrl}
                            onChange={(e) => setRunnerWsUrl(e.target.value)}
                            placeholder="wss://.../ocpp/WebSocket"
                        />

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-sm">Sessions</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={sessions}
                                    onChange={(e) => setSessions(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Concurrent</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={concurrent}
                                    onChange={(e) => setConcurrent(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Ramp (ms)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={runnerRamp}
                                    onChange={(e) => setRunnerRamp(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Hold (s)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={runnerHold}
                                    onChange={(e) => setRunnerHold(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">MV every (s)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={mvEvery}
                                    onChange={(e) => setMvEvery(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Puissance (kW)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    className="w-full rounded-md border-gray-300"
                                    value={runnerPowerKW}
                                    onChange={(e) => setRunnerPowerKW(Number(e.target.value))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm">Tension (V)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border-gray-300"
                                    value={runnerVoltageV}
                                    onChange={(e) => setRunnerVoltageV(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <label className="inline-flex items-center gap-2 mt-1">
                            <input
                                type="checkbox"
                                checked={runnerUseCsv}
                                onChange={(e) => setRunnerUseCsv(e.target.checked)}
                            />
                            <span className="text-sm">Utiliser CSV (cpId,idTag)</span>
                        </label>

                        <div className="flex items-center gap-2">
                            <label className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 border text-sm cursor-pointer">
                                Choisir un fichier
                                <input
                                    type="file"
                                    accept=".csv,text/csv,text/plain"
                                    className="hidden"
                                    onChange={(e) => onPickRunnerCsvFile(e.target.files?.[0] || null)}
                                />
                            </label>
                            <span className="text-xs text-gray-500">
                (ou colle le CSV ci-dessous)
              </span>
                        </div>
                        <textarea
                            className="w-full h-28 rounded-md border-gray-300"
                            value={runnerCsv}
                            onChange={(e) => setRunnerCsv(e.target.value)}
                            placeholder={`cp0001, TAG-0001\ncp0002, TAG-0002`}
                        />

                        <div className="flex flex-wrap gap-2">
                            <button
                                className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 border text-sm"
                                onClick={onImportCsvRunner}
                            >
                                Importer CSV
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 text-sm"
                                onClick={onConnectRunner}
                            >
                                CONNECT
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 text-sm"
                                onClick={onStartRunner}
                            >
                                START
                            </button>
                            <button
                                className="px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 text-sm"
                                onClick={onStopRunner}
                            >
                                STOP
                            </button>
                        </div>

                        <div className="grid grid-cols-5 gap-2 text-center mt-2">
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-xl font-semibold">{rStats.total}</div>
                                <div className="text-xs text-gray-500">TOTAL</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-xl font-semibold">{rStats.active}</div>
                                <div className="text-xs text-gray-500">ACTIVES</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-xl font-semibold">{rStats.finished}</div>
                                <div className="text-xs text-gray-500">FINISHED</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-xl font-semibold text-rose-600">
                                    {rStats.errors}
                                </div>
                                <div className="text-xs text-gray-500">ERRORS</div>
                            </div>
                            <div className="rounded-md bg-gray-50 border px-2 py-3">
                                <div className="text-xl font-semibold">{rStats.avgLatencyMs} ms</div>
                                <div className="text-xs text-gray-500">AVG LATENCY</div>
                            </div>
                        </div>

                        <div className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">Status runner :</span>{" "}
                            <span>{runnerStatus}</span> – <span>{rStats.cpu}% CPU</span>
                        </div>
                    </div>

                    <div className="lg:col-span-6">
                        <label className="block text-sm font-medium mb-1">Logs</label>
                        <div className="h-56 overflow-auto border rounded-md bg-gray-900 text-green-300 px-3 py-2 text-xs font-mono">
                            {logs.length === 0 ? (
                                <div className="text-gray-400">(aucun log pour le moment)</div>
                            ) : (
                                logs.map((l, i) => (
                                    <div key={i} className="whitespace-pre">
                                        {l}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}