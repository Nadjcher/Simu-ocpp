/* =========================================================
 * TnrTab.tsx – VERSION CORRIGÉE utilisant votre lib/apiBase.ts
 * ======================================================= */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { RUNNER as API_BASE } from "@/lib/apiBase";

/* ---------------------- Types locaux ---------------------- */
type TnrScenario =
    | string
    | {
    id: string;
    name?: string;
    description?: string;
    folder?: string;
    tags?: string[];
    eventsCount?: number;
    sessionsCount?: number;
    duration?: number;
    config?: { url?: string; [k: string]: any };
};

type TnrMode = "fast" | "realtime" | "identical";

type TnrExecMeta = {
    executionId: string;
    scenarioId: string;
    timestamp: string;
    passed?: boolean;
    metrics?: { differences?: number; totalEvents?: number; serverCalls?: number; durationMs?: number; [k: string]: any };
};

type TnrDiffType = "missing" | "extra" | "different" | "error" | "count";
type TnrDiff = { path: string; type: TnrDiffType; expected?: any; actual?: any };

type TnrEvent = {
    index?: number;
    ts?: string;
    direction?: "in" | "out";
    action?: string;
    payload?: any;
    [k: string]: any;
};

type TnrExecFull = {
    executionId?: string;
    scenarioId: string;
    status: "running" | "success" | "failed" | "error" | string;
    startedAt: string;
    finishedAt?: string;
    metrics?: { differences?: number; totalEvents?: number; serverCalls?: number; durationMs?: number; [k: string]: any };
    differences?: TnrDiff[];
    events?: TnrEvent[];
    logs?: Array<string | { ts?: string; line?: string }>;
    error?: string;
    inputs?: { url?: string; mode?: "fast" | "realtime" | "instant"; speed?: number; [k: string]: any };
};

/* ---------------------- HTTP helpers avec API_BASE ---------------------- */
async function jget<T>(path: string): Promise<T> {
    const url = `${API_BASE}${path}`;
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    } catch (e) {
        console.error(`GET ${url} failed:`, e);
        throw e;
    }
}

async function jpost<T = any>(path: string, body?: any): Promise<T> {
    const url = `${API_BASE}${path}`;
    try {
        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : "{}",
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    } catch (e) {
        console.error(`POST ${url} failed:`, e);
        throw e;
    }
}

/* ---------------------- UI helpers ---------------------- */
const Mono: React.FC<React.PropsWithChildren> = ({ children }) => (
    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{children}</span>
);

function Section(props: React.PropsWithChildren<{ title?: string; right?: React.ReactNode; style?: React.CSSProperties }>) {
    return (
        <section
            style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 12,
                ...(props.style || {}),
            }}
        >
            {(props.title || props.right) && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong>{props.title}</strong>
                    <div>{props.right}</div>
                </div>
            )}
            {props.children}
        </section>
    );
}

function kpiColor(status?: string) {
    if (status === "running") return "#2563eb";
    if (status === "success") return "#10b981";
    if (status === "failed") return "#ef4444";
    if (status === "error") return "#f59e0b";
    return "#6b7280";
}

function formatDur(ms?: number) {
    if (!ms || ms < 1) return "–";
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)}s`;
    const m = Math.floor(s / 60);
    const r = (s % 60).toFixed(1);
    return `${m}m${r}s`;
}

function truncate(s?: string, n = 180) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ---------------------- Buckets pour le résumé ---------------------- */
type BucketKey =
    | "config"
    | "session"
    | "callsMissing"
    | "callsExtras"
    | "callsPayload"
    | "meterValues"
    | "tx"
    | "results"
    | "other";

const BUCKET_LABEL: Record<BucketKey, string> = {
    config: "Config",
    session: "Session",
    callsMissing: "Appels manquants",
    callsExtras: "Appels en trop",
    callsPayload: "Payload d'appels",
    meterValues: "MeterValues",
    tx: "TX/TXDP",
    results: "Résultats",
    other: "Autre",
};

function bucketOfPath(p?: string): BucketKey {
    const path = (p || "").toLowerCase();
    if (path.includes("/config")) return "config";
    if (path.includes("/session") || path.includes("/auth")) return "session";
    if (path.includes("missing") && (path.includes("/call") || path.includes("/calls"))) return "callsMissing";
    if (path.includes("extra") && (path.includes("/call") || path.includes("/calls"))) return "callsExtras";
    if (path.includes("/call") || path.includes("/payload")) return "callsPayload";
    if (path.includes("/metervalue")) return "meterValues";
    if (path.includes("/tx") || path.includes("/transaction") || path.includes("txp") || path.includes("txdp")) return "tx";
    if (path.includes("/result") || path.includes("/summary")) return "results";
    return "other";
}

/* ---------------------- Parsing "events" depuis les logs ---------------------- */
function parseEventsFromLogs(raw: Array<string | { ts?: string; line?: string }>): TnrEvent[] {
    const lines = raw.map((l) => (typeof l === "string" ? l : l.line || "")).filter(Boolean);
    const events: TnrEvent[] = [];
    let idx = 0;
    for (const line of lines) {
        const m1 = line.match(/→\s*([A-Za-z]+[A-Za-z0-9]*)/);
        if (m1) {
            events.push({ index: idx++, action: m1[1], direction: "out" });
            continue;
        }
        const m2 = line.match(/✅\s*([A-Za-z]+[A-Za-z0-9]*)\s+sent/);
        if (m2) {
            events.push({ index: idx++, action: m2[1], direction: "out" });
            continue;
        }
    }
    return events;
}

/* ---------------------- Backoff util ---------------------- */
function nextBackoff(current: number) {
    return Math.min(Math.round(current * 1.8), 10000);
}

/* =========================================================
 *  Composant principal
 * ======================================================= */
export default function TnrTab() {
    /* Enregistrement (gauche) */
    const [defaultUrl, setDefaultUrl] = useState<string>(() => {
        try { return localStorage.getItem("tnr.defaultUrl") || ""; } catch { return ""; }
    });
    const saveDefaultUrl = (u: string) => {
        setDefaultUrl(u);
        try { localStorage.setItem("tnr.defaultUrl", u); } catch {}
    };

    /* Scénarios & run */
    const [scenarios, setScenarios] = useState<TnrScenario[]>([]);
    const [selScenarioId, setSelScenarioId] = useState<string>("");
    const [mode, setMode] = useState<TnrMode>("fast");
    const [speed, setSpeed] = useState<number>(1);

    /* Exécutions */
    const [execs, setExecs] = useState<TnrExecMeta[]>([]);
    const [execId, setExecId] = useState<string>("");
    const [exec, setExec] = useState<TnrExecFull | null>(null);

    /* Tabs centre */
    const [tab, setTab] = useState<"info" | "logs" | "events" | "diffs" | "server">("logs");
    const logBoxRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    /* Runner status (pour bannière) */
    const [runnerStatus, setRunnerStatus] = useState<"ok" | "reconnecting">("ok");

    /* Filtres diffs */
    const [q, setQ] = useState("");
    const [typeFilter, setTypeFilter] = useState<"" | TnrDiffType>("");
    const [bucketFilter, setBucketFilter] = useState<"" | BucketKey>("");

    /* ---------- Chargements init ---------- */
    useEffect(() => {
        (async () => {
            try {
                const data = await jget<any[]>("/api/tnr/list");
                setScenarios(data.map((x) => (typeof x === "string" ? { id: x } : x)));
            } catch {
                try {
                    const ids = await jget<string[]>("/api/tnr");
                    setScenarios(ids.map((id) => ({ id })));
                } catch (e) {
                    console.error("Failed to load scenarios:", e);
                }
            }
        })();
        (async () => {
            try {
                const list = await jget<TnrExecMeta[]>("/api/tnr/executions");
                setExecs(list);
            } catch (e) {
                console.error("Failed to load executions:", e);
            }
        })();
    }, []);

    /* ---------- Suivi exécution ---------- */
    useEffect(() => {
        if (!execId) return;
        let stopped = false;
        let timer: any = null;
        let delay = 1000;

        const tick = () => {
            jget<TnrExecFull>(`/api/tnr/executions/${encodeURIComponent(execId)}`)
                .then((d) => {
                    if (stopped) return;
                    setExec(d);
                    delay = d.status === "running" ? 1000 : 3000;
                    timer = setTimeout(tick, delay);
                })
                .catch(() => {
                    if (stopped) return;
                    timer = setTimeout(tick, nextBackoff(delay));
                });
        };
        tick();
        return () => { stopped = true; if (timer) clearTimeout(timer); };
    }, [execId]);

    /* ---------- Logs polling ---------- */
    useEffect(() => {
        if (!execId || tab !== "logs") return;
        let stopped = false;
        let timer: any = null;
        let delay = 1000;

        const tick = () => {
            fetch(`${API_BASE}/api/tnr/executions/${encodeURIComponent(execId)}/logs`)
                .then((r) => (r.ok ? r.json() : Promise.reject()))
                .then((logs) => {
                    if (stopped) return;
                    setRunnerStatus("ok");
                    setExec((e) => (e ? { ...e, logs } : e));
                    delay = 1000;
                    timer = setTimeout(tick, delay);
                })
                .catch(() => {
                    if (stopped) return;
                    setRunnerStatus("reconnecting");
                    delay = nextBackoff(delay);
                    timer = setTimeout(tick, delay);
                });
        };
        tick();

        return () => { stopped = true; if (timer) clearTimeout(timer); };
    }, [execId, tab]);

    /* ---------- Auto-scroll logs ---------- */
    useEffect(() => {
        if (!autoScroll || !logBoxRef.current) return;
        logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }, [exec?.logs, autoScroll]);

    /* ---------- Events ---------- */
    const [events, setEvents] = useState<TnrEvent[]>([]);
    useEffect(() => {
        let cancelled = false;
        async function load() {
            if (!execId) return;
            try {
                const ev = await jget<TnrEvent[]>(`/api/tnr/executions/${encodeURIComponent(execId)}/events`);
                if (!cancelled) { setEvents(ev || []); return; }
            } catch {}
            if (exec?.events && exec.events.length) {
                if (!cancelled) setEvents(exec.events);
                return;
            }
            const parsed = parseEventsFromLogs(exec?.logs || []);
            if (!cancelled) setEvents(parsed);
        }
        load();
    }, [execId, exec?.events, (exec?.logs || []).length]);

    /* ---------- Actions ---------- */
    async function startRecording() {
        try {
            await jpost("/api/tnr/recorder/start", { url: defaultUrl });
            alert("Enregistrement démarré");
        } catch (e: any) {
            alert(`Erreur: ${e.message}`);
        }
    }

    async function stopRecording() {
        try {
            await jpost("/api/tnr/recorder/stop", {});
            // Recharger les scénarios après sauvegarde
            try {
                const data = await jget<any[]>("/api/tnr/list");
                setScenarios(data.map((x) => (typeof x === "string" ? { id: x } : x)));
            } catch {
                const ids = await jget<string[]>("/api/tnr");
                setScenarios(ids.map((id) => ({ id })));
            }
            const list = await jget<TnrExecMeta[]>("/api/tnr/executions").catch(() => []);
            setExecs(list || []);
            alert("Enregistrement sauvegardé");
        } catch (e: any) {
            alert(`Erreur: ${e.message}`);
        }
    }

    async function runScenario() {
        if (!selScenarioId) return;
        const requestMode = mode === "identical" ? "instant" : mode;
        const qs = new URLSearchParams();
        if (defaultUrl) qs.set("url", defaultUrl);
        qs.set("mode", requestMode);
        if (requestMode === "realtime") qs.set("speed", String(speed));
        try {
            const r = await jpost<{ executionId?: string }>(`/api/tnr/run/${encodeURIComponent(selScenarioId)}?${qs.toString()}`);
            if (r?.executionId) setExecId(r.executionId);
            setTab("logs");
            const list = await jget<TnrExecMeta[]>("/api/tnr/executions").catch(() => []);
            setExecs(list || []);
        } catch (e: any) {
            alert(`Run error: ${e?.message || e}`);
        }
    }

    /* ---------- KPI ---------- */
    const kpiStatus = exec?.status || "–";
    const kpiEvents = exec?.metrics?.totalEvents ?? events.length ?? "–";
    const kpiDiffs = exec?.metrics?.differences ?? exec?.differences?.length ?? "–";
    const kpiServer = exec?.metrics?.serverCalls ?? "–";
    const kpiDur = exec?.metrics?.durationMs ?? (exec?.finishedAt && exec?.startedAt ? new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime() : undefined);

    /* ---------- Intelligence : éléments comparés ---------- */
    const actionsSeen = useMemo(() => {
        const set = new Set<string>();
        for (const ev of events || []) if (ev?.action) set.add(String(ev.action));
        ["BootNotification","Authorize","StartTransaction","MeterValues","StopTransaction","SetChargingProfile","ClearChargingProfile"].forEach(a=>set.add(a));
        return Array.from(set).sort();
    }, [events]);

    const diffByAction = useMemo(() => {
        const m = new Map<string, number>();
        for (const a of actionsSeen) m.set(a, 0);
        for (const d of exec?.differences || []) {
            const p = (d.path || "").toLowerCase();
            for (const a of actionsSeen) {
                const al = a.toLowerCase();
                if (p.includes(al) || /\/calls\//.test(p)) m.set(a, (m.get(a) || 0) + 1);
            }
        }
        return m;
    }, [actionsSeen, exec?.differences]);

    /* ---------- Diffs filtrés + résumé ---------- */
    const diffs: TnrDiff[] = (exec?.differences || []) as TnrDiff[];
    const bucketCounts = useMemo(() => {
        const m = new Map<BucketKey, number>();
        for (const d of diffs) m.set(bucketOfPath(d.path), (m.get(bucketOfPath(d.path)) || 0) + 1);
        return m;
    }, [diffs]);

    const filteredDiffs = useMemo(() => {
        const qq = q.trim().toLowerCase();
        return diffs.filter((d) => {
            if (typeFilter && d.type !== typeFilter) return false;
            if (bucketFilter && bucketOfPath(d.path) !== bucketFilter) return false;
            if (!qq) return true;
            const blob = ((d.path || "") + " " + JSON.stringify(d.expected ?? "") + " " + JSON.stringify(d.actual ?? "")).toLowerCase();
            return blob.includes(qq);
        });
    }, [diffs, q, typeFilter, bucketFilter]);

    /* ====================== Rendu ====================== */
    return (
        <div style={{ padding: 12 }}>
            <h2 style={{ margin: "0 0 8px" }}>TNR - Tests Non Régressifs</h2>

            {/* Info API */}
            <div style={{
                marginBottom: 12,
                padding: 8,
                background: "#f0f9ff",
                border: "1px solid #0ea5e9",
                borderRadius: 6,
                fontSize: 12
            }}>
                <strong>API Backend:</strong> {API_BASE}
                {" "}
                <button
                    onClick={() => {
                        const newBase = prompt("URL du backend runner-http-api:", API_BASE);
                        if (newBase) {
                            localStorage.setItem("runner_api", newBase);
                            window.location.reload();
                        }
                    }}
                    style={{
                        marginLeft: 8,
                        padding: "2px 8px",
                        fontSize: 11,
                        background: "#0ea5e9",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer"
                    }}
                >
                    Changer
                </button>
            </div>

            {/* Bandeau principal : Enregistrement + Exécutions */}
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "360px 1fr" }}>
                {/* Enregistrement */}
                <Section
                    title="Enregistrement"
                    right={<span style={{ fontSize: 12, color: "#0ea5e9" }}>● prêt</span>}
                >
                    <div style={{ display: "grid", gap: 8 }}>
                        <input
                            value={defaultUrl}
                            onChange={(e) => saveDefaultUrl(e.target.value)}
                            placeholder="ws://…/WebSocket"
                            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px" }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={startRecording} style={{ padding: "6px 12px", borderRadius: 6, background: "#16a34a", color: "#fff", border: "1px solid #16a34a" }}>
                                ● Start recording
                            </button>
                            <button onClick={stopRecording} style={{ padding: "6px 12px", borderRadius: 6, background: "#ef4444", color: "#fff", border: "1px solid #ef4444" }}>
                                ■ Stop & Save
                            </button>
                        </div>
                    </div>
                </Section>

                {/* Exécutions */}
                <Section
                    title="Exécutions"
                    right={
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <select
                                value={selScenarioId}
                                onChange={(e) => setSelScenarioId(e.target.value)}
                                style={{ padding: 6, borderRadius: 6, border: "1px solid #d1d5db" }}
                            >
                                <option value="">– choisir un scénario –</option>
                                {scenarios.map((s) => {
                                    const id = typeof s === "string" ? s : s.id;
                                    const label = typeof s === "string" ? s : s.name || s.id;
                                    return (
                                        <option key={id} value={id}>
                                            {label}
                                        </option>
                                    );
                                })}
                            </select>
                            <select value={mode} onChange={(e) => setMode(e.target.value as TnrMode)} style={{ padding: 6, borderRadius: 6, border: "1px solid #d1d5db" }}>
                                <option value="fast">Fast</option>
                                <option value="realtime">Temps réel</option>
                                <option value="identical">Identique</option>
                            </select>
                            {mode === "realtime" && (
                                <input
                                    type="number"
                                    step={0.1}
                                    min={0.1}
                                    value={speed}
                                    onChange={(e) => setSpeed(Number(e.target.value))}
                                    style={{ width: 90, padding: 6, border: "1px solid #d1d5db", borderRadius: 6 }}
                                    title="speed"
                                />
                            )}
                            <button
                                onClick={runScenario}
                                disabled={!selScenarioId}
                                style={{ padding: "6px 12px", borderRadius: 6, background: "#2563eb", color: "#fff", border: "1px solid #2563eb" }}
                            >
                                ▶ Lancer
                            </button>
                        </div>
                    }
                >
                    {/* KPI */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                        <Kpi label="Statut" value={String(kpiStatus)} color={kpiColor(exec?.status)} />
                        <Kpi label="Events" value={String(kpiEvents)} />
                        <Kpi label="Différences" value={String(kpiDiffs)} />
                        <Kpi label="Server calls" value={String(kpiServer)} />
                        <Kpi label="Durée" value={formatDur(typeof kpiDur === "number" ? kpiDur : undefined)} />
                        <Kpi label="Résultat" value={exec?.status === "success" ? "PASS" : exec?.status === "failed" ? "FAIL" : "–"} />
                    </div>
                </Section>
            </div>

            {/* Colonne scénarios + panneau central */}
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "360px 1fr", marginTop: 12 }}>
                {/* Scénarios */}
                <Section title={`Scénarios (${scenarios.length})`}>
                    <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto" }}>
                        {scenarios.map((s) => {
                            const id = typeof s === "string" ? s : s.id;
                            const name = typeof s === "string" ? s : s.name || s.id;
                            const description = typeof s === "string" ? "" : s.description || "";  // AJOUT
                            const url = typeof s === "string" ? defaultUrl : s.config?.url || defaultUrl;
                            const eventsCount = typeof s === "string" ? "?" : s.eventsCount || 0;  // AJOUT
                            const duration = typeof s === "string" ? "?" : formatDur(s.duration);  // AJOUT

                            return (
                                <div key={id} style={{
                                    border: "1px solid #e5e7eb",
                                    borderRadius: 8,
                                    padding: 8,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{name}</div>
                                        {description && (  // AJOUT: Afficher la description
                                            <div style={{
                                                fontSize: 12,
                                                color: "#6b7280",
                                                marginBottom: 4,
                                                fontStyle: "italic"
                                            }}>
                                                {description}
                                            </div>
                                        )}
                                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                                            URL: <Mono>{url || "—"}</Mono>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>  // AJOUT
                                            {eventsCount} events • Durée: {duration}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setSelScenarioId(id)}
                                        style={{
                                            border: "1px solid #d1d5db",
                                            borderRadius: 6,
                                            padding: "4px 10px"
                                        }}
                                    >
                                        Select
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSelScenarioId(id);
                                            setTimeout(() => runScenario(), 100);
                                        }}
                                        style={{
                                            border: "1px solid #2563eb",
                                            background: "#2563eb",
                                            color: "#fff",
                                            borderRadius: 6,
                                            padding: "4px 10px"
                                        }}
                                    >
                                        ▶ Run
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Section>

                {/* Panneau central */}
                <Section
                    title={`Exécution ${execId || "–"}`}
                    right={
                        <div>
                            <button className={tabBtn(tab === "info")} onClick={() => setTab("info")}>Info</button>{" "}
                            <button className={tabBtn(tab === "logs")} onClick={() => setTab("logs")}>Logs</button>{" "}
                            <button className={tabBtn(tab === "events")} onClick={() => setTab("events")}>Events</button>{" "}
                            <button className={tabBtn(tab === "diffs")} onClick={() => setTab("diffs")}>Différences</button>{" "}
                            <button className={tabBtn(tab === "server")} onClick={() => setTab("server")}>Server</button>
                        </div>
                    }
                >
                    {/* Bannière runner */}
                    {tab === "logs" && runnerStatus === "reconnecting" && (
                        <div style={{ marginBottom: 8, padding: "6px 8px", background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", borderRadius: 6 }}>
                            runner reconnecting… (le backend redémarre, reprise automatique)
                        </div>
                    )}

                    {/* INFO */}
                    {tab === "info" && (
                        <div style={{ display: "grid", gap: 6 }}>
                            <div><strong>Scénario:</strong> <Mono>{exec?.scenarioId || "–"}</Mono></div>
                            <div><strong>Début:</strong> {exec?.startedAt ? new Date(exec.startedAt).toLocaleString() : "–"}</div>
                            <div><strong>Fin:</strong> {exec?.finishedAt ? new Date(exec.finishedAt).toLocaleString() : "–"}</div>
                            <div><strong>URL:</strong> <Mono>{exec?.inputs?.url || defaultUrl || "–"}</Mono></div>
                            <div><strong>Mode:</strong> {exec?.inputs?.mode || "–"} {exec?.inputs?.mode === "realtime" ? `(x${exec?.inputs?.speed || 1})` : ""}</div>
                            {exec?.error && <div style={{ color: "#ef4444" }}><strong>Erreur:</strong> {exec.error}</div>}
                        </div>
                    )}

                    {/* LOGS */}
                    {tab === "logs" && (
                        <>
                            <div style={{ marginBottom: 6 }}>
                                <label style={{ fontSize: 12 }}>
                                    <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> auto-scroll
                                </label>
                            </div>
                            <div
                                ref={logBoxRef}
                                style={{
                                    height: 360,
                                    overflow: "auto",
                                    background: "#0b1020",
                                    color: "#d1d5db",
                                    borderRadius: 8,
                                    padding: 8,
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                    fontSize: 12,
                                    whiteSpace: "pre-wrap",
                                }}
                            >
                                {(exec?.logs || []).map((l, i) => {
                                    const line = typeof l === "string" ? l : l.line || "";
                                    return <div key={i}>{line}</div>;
                                })}
                                {!exec?.logs?.length && <div style={{ opacity: .6 }}>Aucun log pour le moment…</div>}
                            </div>
                        </>
                    )}

                    {/* EVENTS */}
                    {tab === "events" && (
                        <div style={{ overflow: "auto", maxHeight: 420 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                <tr style={{ background: "#f9fafb" }}>
                                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>#</th>
                                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>ts</th>
                                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>dir</th>
                                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>action</th>
                                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>payload</th>
                                </tr>
                                </thead>
                                <tbody>
                                {(events || []).map((ev, i) => (
                                    <tr key={i}>
                                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{ev.index ?? i}</td>
                                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{ev.ts ? new Date(ev.ts).toLocaleTimeString() : ""}</td>
                                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{ev.direction || ""}</td>
                                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontWeight: 600 }}>{ev.action || ""}</td>
                                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}><Mono>{truncate(JSON.stringify(ev.payload))}</Mono></td>
                                    </tr>
                                ))}
                                {!events.length && (
                                    <tr><td colSpan={5} style={{ padding: 12, color: "#6b7280" }}>Aucun event détecté (en attente de logs ou backend).</td></tr>
                                )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* DIFFS */}
                    {tab === "diffs" && (
                        <>
                            {/* Éléments comparés */}
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>Éléments comparés</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {actionsSeen.map((a) => {
                                        const n = diffByAction.get(a) || 0;
                                        const ok = n === 0;
                                        return (
                                            <button
                                                key={a}
                                                onClick={() => setQ(a)}
                                                title={ok ? "Aucune différence" : `${n} différence(s)`}
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    padding: "4px 8px",
                                                    borderRadius: 9999,
                                                    border: `1px solid ${ok ? "#10b981" : "#ef4444"}`,
                                                    background: ok ? "#ecfdf5" : "#fef2f2",
                                                    color: ok ? "#065f46" : "#7f1d1d",
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                {ok ? "✅" : "❌"} {a}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Résumé buckets */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
                                {(Object.keys(BUCKET_LABEL) as BucketKey[]).map((b) => (
                                    <button
                                        key={b}
                                        onClick={() => setBucketFilter(bucketFilter === b ? "" : b)}
                                        title={`Filtrer ${BUCKET_LABEL[b]}`}
                                        style={{
                                            padding: "8px 10px",
                                            borderRadius: 8,
                                            border: bucketFilter === b ? "2px solid #2563eb" : "1px solid #e5e7eb",
                                            background: "#fff",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            cursor: "pointer"
                                        }}
                                    >
                                        <span>{BUCKET_LABEL[b]}</span>
                                        <strong style={{ color: (bucketCounts.get(b) || 0) ? "#ef4444" : "#10b981" }}>{bucketCounts.get(b) || 0}</strong>
                                    </button>
                                ))}
                            </div>

                            {/* Filtres */}
                            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                                <input
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Rechercher (path / expected / actual / action)"
                                    style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6 }}
                                />
                                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={{ padding: 6, borderRadius: 6, border: "1px solid #d1d5db" }}>
                                    <option value="">Type – Tous</option>
                                    <option value="different">different</option>
                                    <option value="missing">missing</option>
                                    <option value="extra">extra</option>
                                    <option value="error">error</option>
                                    <option value="count">count</option>
                                </select>
                                <select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value as any)} style={{ padding: 6, borderRadius: 6, border: "1px solid #d1d5db" }}>
                                    <option value="">Bucket – Tous</option>
                                    {(Object.keys(BUCKET_LABEL) as BucketKey[]).map((b) => (
                                        <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Tableau des différences */}
                            <div style={{ overflow: "auto", maxHeight: 420 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                    <tr style={{ background: "#f9fafb" }}>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Bucket</th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Type</th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Chemin comparé</th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Expected</th>
                                        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Actual</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {filteredDiffs.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} style={{ padding: 12, color: "#6b7280", fontStyle: "italic" }}>
                                                Aucune différence
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredDiffs.map((d, i) => {
                                            const b = bucketOfPath(d.path);
                                            return (
                                                <tr key={i}>
                                                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{BUCKET_LABEL[b]}</td>
                                                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{d.type}</td>
                                                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                                        <Mono>{d.path}</Mono>
                                                    </td>
                                                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                                        <Mono>{truncate(JSON.stringify(d.expected))}</Mono>
                                                    </td>
                                                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                                        <Mono>{truncate(JSON.stringify(d.actual))}</Mono>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* SERVER */}
                    {tab === "server" && (
                        <div style={{ color: "#6b7280" }}>
                            {typeof kpiServer === "number" ? `${kpiServer} appels serveur détectés.` : "Aucune donnée serveur détaillée."}
                        </div>
                    )}
                </Section>
            </div>

            {/* Historique */}
            <Section title="Historique d'exécutions" style={{ marginTop: 12 }}>
                <div style={{ overflow: "auto", maxHeight: 240 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                        <tr style={{ background: "#f9fafb" }}>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Heure</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Scénario</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Statut</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Diffs</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Ouvrir</th>
                        </tr>
                        </thead>
                        <tbody>
                        {execs.map((e) => (
                            <tr key={e.executionId}>
                                <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{new Date(e.timestamp).toLocaleString()}</td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}><Mono>{e.scenarioId}</Mono></td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: e.passed ? "#10b981" : "#ef4444" }}>
                                    {e.passed ? "success" : "failed"}
                                </td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{e.metrics?.differences ?? "–"}</td>
                                <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                                    <button
                                        onClick={() => { setExecId(e.executionId); setTab("logs"); }}
                                        style={{ border: "1px solid #2563eb", background: "#2563eb", color: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                                    >
                                        Voir
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            </Section>
        </div>
    );
}

/* ---------------------- Petits composants ---------------------- */
function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: color || "#111827" }}>{value}</div>
        </div>
    );
}

function tabBtn(active: boolean) {
    return active
        ? "padding: 4px 8px; border: 1px solid #2563eb; color: #2563eb; background: white; border-radius: 4px; cursor: pointer; font-weight: 600;"
        : "padding: 4px 8px; border: 1px solid #d1d5db; color: #6b7280; background: white; border-radius: 4px; cursor: pointer;";
}