
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import WebSocket from "ws";
import os from "os";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { performance } from "node:perf_hooks";
import multer from "multer";
import crypto from "crypto";



/* ========================================================================== */
/* ENV & BOOT                                                                 */
/* ========================================================================== */

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"; // DEV uniquement

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT ? Number(process.env.PORT) : 8877;

// Fallback OCPP URL si un scénario n'a pas de config.url
const DEFAULT_OCPP_URL =
    process.env.OCPP_URL ||
    process.env.DEFAULT_OCPP_URL ||
    "";

/* Helpers URL (fallback + persistance) */
function pickOcppUrl(fromReq, fromScenario) {
    return String(
        (fromReq?.body?.url) ||
        (fromReq?.body?.config?.url) ||
        (fromReq?.query?.url) ||
        (fromScenario?.config?.url) ||
        (fromScenario?.metadata?.url) ||
        DEFAULT_OCPP_URL ||
        RUN_STATE.url ||
        ""
    ).trim();
}

async function persistScenarioUrlIfMissing(scenarioId, url) {
    if (!scenarioId || !url) return;
    try {
        const p = path.join(TNR_DIR, `${scenarioId}.json`);
        const j = JSON.parse(await fs.readFile(p, "utf8"));
        if (!j.config) j.config = {};
        if (!j.config.url) {
            j.config.url = url;
            await fs.writeFile(p, JSON.stringify(j, null, 2), "utf8");
            log(`[TNR] Persisted URL for scenario ${scenarioId}: ${url}`);
        }
    } catch { /* ignore */ }
}

/* Helpers TNR pour replay robuste */
function normalizeUiAction(raw) {
    if (!raw) return "";
    const a = String(raw).split(":").pop().trim();
    if (/^authorize$/i.test(a)) return "Authorize";
    if (/^start(transaction)?$/i.test(a) || /^starttransaction$/i.test(a)) return "StartTransaction";
    if (/^stop(transaction)?$/i.test(a)  || /^stoptransaction$/i.test(a))  return "StopTransaction";
    if (/^metervalues?$/i.test(a) || /^meter[:\-]?values$/i.test(a))      return "MeterValues";
    if (/^connect$/i.test(a)) return "CONNECT";
    if (/^park$/i.test(a)) return "PARK";
    if (/^plug$/i.test(a)) return "PLUG";
    if (/^leave$/i.test(a)) return "LEAVE";
    if (/^apply[_\- ]?mv[_\- ]?mask$/i.test(a)) return "APPLY_MV_MASK";
    return a;
}

function pickClientForEvent(ev, clients, sessions) {
    if (ev?.cpId && clients.has(ev.cpId)) return clients.get(ev.cpId);
    if (ev?.payload?.cpId && clients.has(ev.payload.cpId)) return clients.get(ev.payload.cpId);
    if (clients.size === 1) return [...clients.values()][0];
    if (Array.isArray(sessions) && sessions.length && clients.has(sessions[0].cpId)) {
        return clients.get(sessions[0].cpId);
    }
    return null;
}

/* ========================================================================== */
/* MODES DE REPLAY INTELLIGENTS                                              */
/* ========================================================================== */

const REPLAY_MODES = {
    INSTANT: 'instant',      // 0ms entre events
    FAST: 'fast',           // Max 10ms
    SMART: 'smart',         // Adaptatif selon le type
    REALTIME: 'realtime',   // Temps réel
    STRESS: 'stress'        // Test de charge
};

function computeSmartDelay(prevT, nextT, event, cfg) {
    const gap = Math.max(0, (nextT || 0) - (prevT || 0));
    const mode = cfg.mode || (cfg.realtime ? REPLAY_MODES.REALTIME : REPLAY_MODES.FAST);

    switch(mode) {
        case REPLAY_MODES.INSTANT:
            return 0;

        case REPLAY_MODES.FAST:
            return Math.min(10, gap);

        case REPLAY_MODES.SMART:
            // Adaptatif selon le type d'action
            if (['MeterValues', 'StatusNotification'].includes(event?.action)) {
                return Math.min(100, gap); // Telemetry peut aller vite
            }
            if (['StartTransaction', 'StopTransaction'].includes(event?.action)) {
                return Math.min(500, gap); // Transactions ont besoin d'un peu de temps
            }
            return Math.min(50, gap); // Autres

        case REPLAY_MODES.STRESS:
            // Mode stress test - rafales
            return Math.random() < 0.3 ? 0 : Math.random() * 100;

        case REPLAY_MODES.REALTIME:
        default:
            const speed = Math.max(0.001, Number(cfg.speed ?? 1));
            return Math.round(gap / speed);
    }
}

/* ========================================================================== */
/* TAXONOMIE OCPP                                                            */
/* ========================================================================== */

const OCPP_DOMAINS = {
    AUTH: {
        name: 'Authentication',
        actions: ['Authorize'],
        color: '#8b5cf6'
    },
    CHARGING: {
        name: 'Charging Session',
        actions: ['StartTransaction', 'StopTransaction'],
        color: '#3b82f6'
    },
    TELEMETRY: {
        name: 'Telemetry',
        actions: ['MeterValues', 'StatusNotification'],
        color: '#10b981'
    },
    MANAGEMENT: {
        name: 'Management',
        actions: ['Reset', 'ChangeConfiguration', 'GetConfiguration', 'ClearCache'],
        color: '#f59e0b'
    },
    DIAGNOSTICS: {
        name: 'Diagnostics',
        actions: ['GetDiagnostics', 'UpdateFirmware', 'TriggerMessage'],
        color: '#ef4444'
    },
    RESERVATION: {
        name: 'Reservation',
        actions: ['ReserveNow', 'CancelReservation'],
        color: '#06b6d4'
    }
};

function classifyEvent(event) {
    const action = event.action || '';
    for (const [key, domain] of Object.entries(OCPP_DOMAINS)) {
        if (domain.actions.includes(action)) {
            return key;
        }
    }
    return 'OTHER';
}

function analyzeScenario(scenario) {
    const domainStats = {};
    const timeline = [];

    for (const domain of Object.keys(OCPP_DOMAINS)) {
        domainStats[domain] = {
            count: 0,
            avgTime: 0,
            errors: 0
        };
    }

    let lastT = 0;
    for (const event of (scenario.events || [])) {
        const domain = classifyEvent(event);
        if (domainStats[domain]) {
            domainStats[domain].count++;

            const duration = (event.t || 0) - lastT;
            domainStats[domain].avgTime =
                (domainStats[domain].avgTime * (domainStats[domain].count - 1) + duration) /
                domainStats[domain].count;
        }

        timeline.push({
            t: event.t,
            domain,
            action: event.action,
            duration: (event.t || 0) - lastT
        });

        lastT = event.t || 0;
    }

    return { domainStats, timeline };
}
// Configuration API Prix

let PRICE_API_CONFIG = {
    token: process.env.PRICE_API_TOKEN || "",
    url: process.env.PRICE_API_URL || "https://evplatform.evcharge-pp.totalenergies.com/evportal/api/tx"
};



    /* ========================================================================== */
    /* LOGGING                                                                    */
    /* ========================================================================== */

    const LOG_MAX = 500;
    const LOGS = [];

    function log(line) {
    const ts = new Date().toTimeString().slice(0, 8);
    const l = `[${ts}] ${line}`;
    LOGS.push(l);
    if (LOGS.length > LOG_MAX) LOGS.splice(0, LOGS.length - LOG_MAX);
    console.log(l);
}

/* ========================================================================== */
/* ÉTAT PERF + METRICS                                                        */
/* ========================================================================== */

let IMPORTED_CSV = "";

let POOL = [];
let RUN_STATE = {
    running: false,
    runId: null,
    url: "",
    sessionsPlanned: 0,
    concurrent: 1,
    rampMs: 250,
    holdSec: 20,
    mvEverySec: 0,
    powerKW: 7.4,
    voltageV: 230,
    noAuth: false,
    noStart: false,
    noStop: false,
    useCsv: false,
    csvPairs: [],
};

const STATS = {
    total: 0,
    active: 0,
    finished: 0,
    errors: 0,
    msgs: 0,
    avgLatencyMs: 0,
    cpu: 0,
    mem: 0,
};

let _latencyWindow = [];
let _cpuTimer = null;

function resetStats() {
    STATS.total = 0;
    STATS.active = 0;
    STATS.finished = 0;
    STATS.errors = 0;
    STATS.msgs = 0;
    STATS.avgLatencyMs = 0;
    _latencyWindow = [];
}

function pushLatencySample(ms) {
    _latencyWindow.push(ms);
    if (_latencyWindow.length > 2000) _latencyWindow.shift();
    const avg =
        _latencyWindow.reduce((a, b) => a + b, 0) /
        Math.max(1, _latencyWindow.length);
    STATS.avgLatencyMs = Math.round(avg);
}

/* ========================================================================== */
/* SESSIONS                                                                   */
/* ========================================================================== */

const SESSIONS_MAP = new Map();
const FRONT_SESSIONS = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [cpId, r] of FRONT_SESSIONS)
        if (now - (r.ts || 0) > 30000) FRONT_SESSIONS.delete(cpId);
}, 10000);

/* ========================================================================== */
/* UTILS                                                                      */
/* ========================================================================== */

const toBool = (v) =>
    typeof v === "boolean"
        ? v
        : typeof v === "string"
            ? /^(1|true|yes|on)$/i.test(v)
            : false;
const toInt = (v, d = 0) =>
    Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCsv(text) {
    const rows = String(text || "")
        .replace(/^\uFEFF/, "")  // Remove BOM
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter(Boolean);

    // Détection automatique du header
    let start = 0;
    if (rows[0]) {
        const firstLine = rows[0].toLowerCase();
        // Si la première ligne contient "cpid" ou "idtag", c'est un header
        if (firstLine.includes('cpid') || firstLine.includes('idtag') ||
            firstLine === 'cpid,idtag' || firstLine === 'cpid,tagid') {
            start = 1;  // Skip header
        }
    }

    const pairs = [];
    for (let i = start; i < rows.length; i++) {
        const parts = rows[i].split(/[,;|\s\t]+/);
        const cpId = parts[0]?.trim();
        const idTag = parts[1]?.trim();

        if (!cpId || !idTag) continue;
        if (cpId.toLowerCase() === 'cpid') continue;
        if (cpId.length === 0 || idTag.length === 0) continue;

        pairs.push({
            cpId: cpId,
            idTag: idTag
        });
    }
    return pairs;
}

const isValidCsv = (txt) => parseCsv(String(txt || "")).length > 0;

function finalUrl(base, cpId) {
    if (base.endsWith("/" + cpId)) return base;
    return base.endsWith("/") ? base + cpId : `${base}/${cpId}`;
}

/* ========================================================================== */
/* TNR: RECORDER                                                              */
/* ========================================================================== */

const RECORDER = {
    on: false,
    t0: 0,
    meta: {},
    events: [],
    sessions: new Map(),

    start(meta = {}) {
        this.on = true;
        this.t0 = Date.now();
        this.events = [];
        this.sessions.clear();
        this.meta = {
            ...meta,
            startedAt: new Date().toISOString(),
            url: meta.config?.url || RUN_STATE.url || "",
        };
        log(`[TNR REC] Started: ${meta?.name || "unnamed"}`);
    },

    stop() {
        const duration = Date.now() - this.t0;
        this.on = false;
        this.meta.endedAt = new Date().toISOString();
        this.meta.durationMs = duration;

        const sessions = [];
        for (const [cpId, info] of this.sessions) {
            sessions.push({
                id: `session_${cpId}_${Date.now()}`,
                cpId,
                idTag: info.idTag || "TAG-001",
                steps: this.buildStepsForSession(cpId),
                // Ajout des métadonnées importantes
                metadata: {
                    firstEventTime: info.firstEvent,
                    lastEventTime: info.lastEvent,
                    totalEvents: info.eventCount || 0
                }
            });
        }

        log(`[TNR REC] Stopped: ${this.events.length} events, ${sessions.length} sessions`);
        return {
            events: [...this.events],
            sessions,
            metadata: { ...this.meta },
            durationMs: duration,
        };
    },

    tap(dir, cpId, action, payload) {
        if (!this.on) return;

        const event = {
            t: Date.now() - this.t0,
            cpId,
            dir,
            action,
            payload: payload || {},
            timestamp: Date.now(),
        };

        this.events.push(event);

        // Capturer l'idTag depuis le payload
        let idTag = payload?.idTag;

        // Pour Authorize et StartTransaction, capturer l'idTag
        if ((action === "Authorize" || action === "StartTransaction") && payload?.idTag) {
            idTag = payload.idTag;
        }

        if (!this.sessions.has(cpId)) {
            this.sessions.set(cpId, {
                cpId,
                idTag: idTag || "TAG-001",
                firstEvent: event.t,
                lastEvent: event.t,
                eventCount: 1
            });
        } else {
            const session = this.sessions.get(cpId);
            session.lastEvent = event.t;
            session.eventCount = (session.eventCount || 0) + 1;
            // Mettre à jour l'idTag si on en trouve un
            if (idTag && idTag !== "TAG-001") {
                session.idTag = idTag;
            }
        }
    },

    buildStepsForSession(cpId) {
        const steps = [];
        const sessionEvents = this.events.filter((e) => e.cpId === cpId);

        for (const event of sessionEvents) {
            if (event.dir === "cp->cs" || event.dir === "ui") {
                steps.push({
                    at: event.t,
                    type: event.dir === "ui" ? "ui" : "send",
                    action: event.action,
                    payload: event.payload,
                });
            }
        }

        return steps;
    },
};
/* ========================================================================== */
/* TNR: Persistence & état                                                    */
/* ========================================================================== */

const TNR_DIR = path.join(process.cwd(), "tnr");
const EXECUTIONS_DIR = path.join(TNR_DIR, "executions");

try {
    if (!fsSync.existsSync(TNR_DIR)) fsSync.mkdirSync(TNR_DIR, { recursive: true });
    if (!fsSync.existsSync(EXECUTIONS_DIR))
        fsSync.mkdirSync(EXECUTIONS_DIR, { recursive: true });
} catch (e) {
    log(`WARN: impossible de créer les dossiers TNR: ${e?.message || e}`);
}

const TNR_SCENARIOS = new Map();
const TNR_EXECUTIONS = new Map();
const TNR_RUNNING = new Map();

/* Helper: dernière exécution pour un scénario */
async function findLatestExecForScenario(scenarioId) {
    let latest = null;

    for (const exec of TNR_EXECUTIONS.values()) {
        if (exec.scenarioId === scenarioId) {
            if (!latest || new Date(exec.startedAt) > new Date(latest.startedAt)) latest = exec;
        }
    }
    for (const exec of TNR_RUNNING.values()) {
        if (exec.scenarioId === scenarioId) {
            if (!latest || new Date(exec.startedAt) > new Date(latest.startedAt)) latest = exec;
        }
    }
    try {
        const files = await fs.readdir(EXECUTIONS_DIR);
        for (const f of files) {
            if (!f.endsWith(".json")) continue;
            try {
                const data = JSON.parse(await fs.readFile(path.join(EXECUTIONS_DIR, f), "utf8"));
                if (data.scenarioId === scenarioId) {
                    if (!latest || new Date(data.startedAt) > new Date(latest.startedAt)) latest = data;
                }
            } catch {}
        }
    } catch {}

    return latest;
}

/* ========================================================================== */
/* TNR: Comparaison                                                           */
/* ========================================================================== */

function normalizeForComparison(obj) {
    const IGNORE_FIELDS = new Set([
        "timestamp",
        "currentTime",
        "transactionId",
        "messageId",
        "meterStart",
        "meterStop",
        "bootTime",
        "authTime",
        "startTime",
        "stopTime",
        "firmwareVersion",
        "t",
        "replayedAt",
    ]);

    function walk(v) {
        if (Array.isArray(v)) return v.map((item) => walk(item));
        if (v && typeof v === "object") {
            const result = {};
            for (const key of Object.keys(v).sort()) {
                if (IGNORE_FIELDS.has(key)) continue;
                if (key === "sampledValue" && Array.isArray(v[key])) {
                    result[key] = v[key].map((sv) => ({
                        measurand: sv.measurand,
                        value: sv.value,
                        unit: sv.unit,
                    }));
                } else {
                    result[key] = walk(v[key]);
                }
            }
            return result;
        }
        return v;
    }
    return walk(obj);
}

function signature(obj) {
    const normalized = normalizeForComparison(obj);
    const json = JSON.stringify(normalized);
    return crypto.createHash("sha256").update(json).digest("hex");
}

function extractMeterValues(payload) {
    const result = {};
    if (payload?.meterValue) {
        for (const mv of payload.meterValue) {
            if (mv?.sampledValue) {
                for (const sv of mv.sampledValue) {
                    const measurand = sv.measurand || "Energy.Active.Import.Register";
                    const value = parseFloat(sv.value);
                    if (!isNaN(value)) result[measurand] = value;
                }
            }
        }
    }
    if (payload?.powerActiveKw !== undefined) result["Power.Active"] = payload.powerActiveKw;
    if (payload?.powerOfferedKw !== undefined) result["Power.Offered"] = payload.powerOfferedKw;
    if (payload?.socPercent !== undefined) result["SoC"] = payload.socPercent;
    return result;
}

function compareEvents(expected, actual) {
    const differences = [];

    const expNorm = expected.map((e) => ({
        action: e.action,
        cpId: e.cpId,
        dir: e.dir,
        payload: normalizeForComparison(e.payload),
    }));
    const actNorm = actual.map((e) => ({
        action: e.action,
        cpId: e.cpId,
        dir: e.dir,
        payload: normalizeForComparison(e.payload),
    }));

    if (expNorm.length !== actNorm.length) {
        differences.push({ type: "count", path: "/events", expected: expNorm.length, actual: actNorm.length });
    }

    const minLen = Math.min(expNorm.length, actNorm.length);
    for (let i = 0; i < minLen; i++) {
        const exp = expNorm[i];
        const act = actNorm[i];

        if (exp.action !== act.action) {
            differences.push({
                type: "different",
                eventIndex: i,
                path: `/events/${i}/action`,
                expected: exp.action,
                actual: act.action,
            });
        }

        if (exp.action === "MeterValues" || exp.action?.toLowerCase().includes("meter")) {
            const expMV = extractMeterValues(exp.payload);
            const actMV = extractMeterValues(act.payload);
            for (const key of Object.keys(expMV)) {
                if (expMV[key] !== actMV[key] && Math.abs(expMV[key] - actMV[key]) > 0.1) {
                    differences.push({
                        type: "different",
                        eventIndex: i,
                        path: `/events/${i}/MeterValues/${key}`,
                        expected: expMV[key],
                        actual: actMV[key],
                    });
                }
            }
        } else {
            const expStr = JSON.stringify(exp.payload);
            const actStr = JSON.stringify(act.payload);
            if (expStr !== actStr) {
                differences.push({
                    type: "different",
                    eventIndex: i,
                    path: `/events/${i}/payload`,
                    expected: exp.payload,
                    actual: act.payload,
                });
            }
        }
    }

    return differences;
}

/* ========================================================================== */
/* TNR: Client de replay                                                      */
/* ========================================================================== */

class ReplayClient {
    constructor(cpId, idTag, url, executionId) {
        this.cpId = cpId;
        this.idTag = idTag;
        this.url = finalUrl(url, cpId);
        this.executionId = executionId;
        this.ws = null;
        this.txId = null;
        this.pending = new Map();
        this.seq = 1;
        this.serverCalls = [];
        this.metrics = {
            bytesSent: 0,
            messageCount: 0
        };
        this._pending = new Map(); // Ajout
    }

    nextMsgId() {
        return `${Date.now()}-${this.seq++}`;
    }

    addLog(msg) {
        console.log(`[ReplayClient ${this.cpId}] ${msg}`);
    }

    fail(message) {
        console.error(`[ReplayClient ${this.cpId}] ERROR: ${message}`);
        this.close();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url, "ocpp1.6");

                this.ws.on("open", () => {
                    this.sendCall("BootNotification", {
                        chargePointModel: "Simulator",
                        chargePointVendor: "Test",
                        firmwareVersion: "1.0"
                    });
                    resolve();
                });

                this.ws.on("message", (data) => {
                    const msg = JSON.parse(data.toString());
                    const type = msg[0];

                    if (type === 2) {
                        const [, msgId, action, payload] = msg;
                        this.serverCalls.push({ timestamp: Date.now(), action, payload });
                        this.ws.send(JSON.stringify([3, msgId, { status: "Accepted" }]));
                    } else if (type === 3) {
                        const [, msgId, payload] = msg;
                        const resolver = this.pending.get(msgId);
                        if (resolver) {
                            resolver(payload);
                            this.pending.delete(msgId);
                        }
                        if (payload?.transactionId != null) this.txId = payload.transactionId;
                    }
                });

                this.ws.on("error", reject);
                this.ws.on("close", () => {
                    for (const [, rej] of this.pending) rej(new Error("Connection closed"));
                    this.pending.clear();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    sendCall(action, payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            const msgId = this.nextMsgId();
            this._pending.set(msgId, action);
            const frame = [2, msgId, action, payload];
            const data = JSON.stringify(frame);
            this.metrics.bytesSent += data.length;
            this.metrics.messageCount++;

            // Capturer pour TNR si enregistrement actif
            if (RECORDER.on) {
                RECORDER.tap("cp->cs", this.cpId, action, payload);
                console.log(`[TNR] Event captured: ${action} for ${this.cpId}`);
            }

            this.ws.send(data);
            STATS.msgs++;
            this.addLog(`>> Sent ${action}(msgId=${msgId})`);
            return msgId;
        } catch (e) {
            this.fail(`Send ${action} error: ${e?.message || e}`);
        }
    }

    close() {
        try {
            this.ws?.close();
        } catch {}
    }
}

/* ---------- Replay helpers: retime payloads + filter plan (cp->cs only, dedupe non-MV) ---------- */
function retimePayload(action, payload, replayStartMs, deltaFromStartMs) {
    if (!payload || typeof payload !== "object") return payload;
    const toIso = (ms) => new Date(ms).toISOString();
    const parseIso = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
    const setTopLevelTs = () => { if (payload.timestamp) payload.timestamp = toIso(replayStartMs + deltaFromStartMs); };
    switch (action) {
        case "StartTransaction":
        case "StopTransaction":
        case "StatusNotification":
        case "BootNotification":
            setTopLevelTs();
            break;
        case "MeterValues": {
            const base = replayStartMs + deltaFromStartMs;
            const frames = Array.isArray(payload.meterValue) ? payload.meterValue : [];
            let firstOrig = null;
            for (const f of frames) { const t = parseIso(f?.timestamp); if (t != null) { firstOrig = t; break; } }
            for (const f of frames) {
                let dt = 0; const t = parseIso(f?.timestamp);
                if (firstOrig != null && t != null) dt = t - firstOrig;
                f.timestamp = toIso(base + dt);
            }
            break;
        }
        default: break;
    }
    return payload;
}

/** construit le plan de lecture: uniquement cp->cs; supprime doublons non-MeterValues rapprochés */
function makePlayPlan(events) {
    const sorted = (events || []).slice().sort((a,b)=>(a.t||0)-(b.t||0));
    const cpOnly = sorted.filter(e => e?.dir === "cp->cs");
    const plan = [];
    let last = null;
    for (const ev of cpOnly) {
        const isMV = /MeterValues/i.test(ev.action || "");
        if (!isMV && last && last.action === ev.action) {
            const dt = Math.abs((ev.t||0) - (last.t||0));
            const samePayload = JSON.stringify(ev.payload||{}) === JSON.stringify(last.payload||{});
            if (dt <= 1500 && samePayload) continue; // drop duplicate
        }
        plan.push(ev);
        last = ev;
    }
    return plan;
}

/* ========================================================================== */
/* TNR: Replay                                                                */
/* ========================================================================== */

async function replayScenario(scenario, config = {}, existingExec = null) {
    // Normaliser la config (supporter l'ancien format boolean)
    const replayConfig = typeof config === 'boolean'
        ? { realtime: config, mode: config ? 'realtime' : 'fast' }
        : {
            realtime: config.realtime !== false,
            mode: config.mode || (config.realtime !== false ? 'realtime' : 'fast'),
            speed: config.speed || 1,
            capMs: config.capMs
        };

    const execution = existingExec || {
        executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        scenarioId: scenario.id,
        startedAt: new Date().toISOString(),
        status: "running",
        events: [],
        serverCalls: [],
        differences: [],
        logs: [],
        replayCfg: replayConfig,
        performanceAnalysis: {}
    };

    const executionId = execution.executionId;

    if (!TNR_RUNNING.has(executionId)) TNR_RUNNING.set(executionId, execution);
    if (!TNR_EXECUTIONS.has(executionId)) TNR_EXECUTIONS.set(executionId, execution);

    const addLog = (msg) => {
        const entry = { ts: new Date().toTimeString().slice(0, 8), line: msg };
        execution.logs.push(entry);
        if (execution.logs.length > 1000) execution.logs.shift();
        log(`[TNR] ${msg}`);
    };

    addLog(`▶ Starting replay of scenario: ${scenario.name || scenario.id}`);
    addLog(`  Mode: ${replayConfig.mode}, Speed: ${replayConfig.speed}x`);

    const timingMetrics = {
        originalDuration: scenario.metadata?.durationMs || 0,
        replayStartTime: Date.now(),
        eventTimings: []
    };

    try {
        const clients = new Map();
        const url = scenario.config?.url || scenario.metadata?.url || DEFAULT_OCPP_URL || RUN_STATE.url || "";

        if (!url) throw new Error("No URL in scenario config");
        addLog(` Using OCPP URL: ${url}`);

        // Créer une map pour stocker les idTags par cpId depuis les événements
        const cpIdTagMap = new Map();

        // Parcourir les événements pour collecter tous les idTags
        for (const event of scenario.events || []) {
            if (event.cpId && event.payload?.idTag) {
                if (!cpIdTagMap.has(event.cpId)) {
                    cpIdTagMap.set(event.cpId, event.payload.idTag);
                }
            }
        }

        // Utiliser les sessions enregistrées avec leurs idTags corrects
        let sessions = Array.isArray(scenario.sessions) ? [...scenario.sessions] : [];

        if (!sessions.length && Array.isArray(scenario.events)) {
            // Créer des sessions depuis les événements avec les bons idTags
            const sessionMap = new Map();
            for (const event of scenario.events) {
                if (!event.cpId) continue;
                if (!sessionMap.has(event.cpId)) {
                    const idTag = cpIdTagMap.get(event.cpId) || "TAG-TNR";
                    sessionMap.set(event.cpId, {
                        cpId: event.cpId,
                        idTag: idTag
                    });
                }
            }
            sessions = Array.from(sessionMap.values());
            addLog(`ℹ Sessions reconstructed from events: ${sessions.map(s => `${s.cpId}(${s.idTag})`).join(", ")}`);
        } else {
            // Mettre à jour les idTags des sessions existantes si on a trouvé mieux dans les événements
            sessions = sessions.map(session => {
                const betterIdTag = cpIdTagMap.get(session.cpId);
                if (betterIdTag && betterIdTag !== "TAG-001" && betterIdTag !== "TAG-TNR") {
                    return { ...session, idTag: betterIdTag };
                }
                return session;
            });
        }

        addLog(` Connecting ${sessions.length} sessions...`);

        // Connecter tous les clients
        for (const session of sessions) {
            const client = new ReplayClient(
                session.cpId,
                session.idTag || cpIdTagMap.get(session.cpId) || "TAG-TNR",
                url,
                executionId
            );
            clients.set(session.cpId, client);
            await client.connect();
            addLog(` Connected: ${session.cpId} with idTag: ${session.idTag || cpIdTagMap.get(session.cpId) || "TAG-TNR"}`);
        }

        // Préparer le plan de replay
        addLog(`▶ Replaying ${(scenario.events||[]).length} events...`);
        const startReplayMs = Date.now();
        const plan = makePlayPlan(scenario.events || []);
        const t0 = plan.reduce((m,e)=>Math.min(m, e?.t ?? 0), Number.POSITIVE_INFINITY);
        const baseT0 = Number.isFinite(t0) ? t0 : 0;
        let lastTime = baseT0;

        addLog(`ℹ Replay plan: ${plan.length} events to replay`);

        // Replay des événements
        for (const event of plan) {
            const evT = event?.t ?? baseT0;
            const delay = computeSmartDelay(lastTime, evT, event, replayConfig);

            if (delay > 0) {
                const actualDelay = replayConfig.mode === 'realtime'
                    ? delay
                    : Math.min(delay, 100);
                await sleep(actualDelay);
            }
            lastTime = evT;

            const client = pickClientForEvent(event, clients, sessions);
            if (!client) {
                addLog(`⚠ No client for event (cpId=${event.cpId})`);
                continue;
            }

            // Copier le payload original
            const originalPayload = JSON.parse(JSON.stringify(event.payload || {}));

            // Appliquer le re-timing sur une copie
            const deltaFromStart = Math.max(0, evT - baseT0);
            const patchedPayload = retimePayload(
                event.action,
                originalPayload,
                startReplayMs,
                deltaFromStart
            );

            // Préserver l'idTag original s'il existe
            if (originalPayload.idTag) {
                patchedPayload.idTag = originalPayload.idTag;
            } else if ((event.action === "Authorize" || event.action === "StartTransaction") && !patchedPayload.idTag) {
                patchedPayload.idTag = client.idTag;
            }

            // Préserver le transactionId pour MeterValues et StopTransaction
            if (client.txId && (event.action === "MeterValues" || event.action === "StopTransaction")) {
                patchedPayload.transactionId = client.txId;
            }

            addLog(`▶ ${client.cpId} → ${event.action} (idTag: ${patchedPayload.idTag || 'N/A'})`);

            try {
                const result = await client.sendCall(event.action, patchedPayload);

                execution.events.push({
                    ...event,
                    payload: patchedPayload,
                    replayedAt: Date.now(),
                    result: result
                });

                if (result?.error) {
                    addLog(` ⚠ ${event.action} error: ${result.error}`);
                } else if (result?.timeout) {
                    addLog(` ⚠ ${event.action} timeout`);
                } else {
                    addLog(` ✓ ${event.action} sent successfully`);
                }

            } catch (err) {
                addLog(` ✗ Failed ${event.action}: ${err.message}`);
                execution.differences.push({
                    type: "error",
                    path: `/events/${plan.indexOf(event)}/action`,
                    expected: "success",
                    actual: err.message
                });
            }
        }

        // Attendre un peu pour les dernières réponses
        await sleep(2000);

        // Agrège les appels serveur
        execution.serverCalls = [];
        for (const [cpId, client] of clients.entries()) {
            for (const sc of client.serverCalls) {
                execution.serverCalls.push({ cpId, ...sc });
            }
            client.close();
            addLog(` Closed ${cpId}`);
        }
        addLog(` Server calls captured: ${execution.serverCalls.length}`);

        // Analyser les écarts de performance
        execution.performanceAnalysis = {
            originalDuration: timingMetrics.originalDuration,
            replayDuration: Date.now() - timingMetrics.replayStartTime,
            overhead: (Date.now() - timingMetrics.replayStartTime) - timingMetrics.originalDuration,
            mode: replayConfig.mode,
            speed: replayConfig.speed
        };

        // Comparaison
        addLog(`🔍 Comparing...`);
        if (scenario.expected?.events) {
            execution.differences = compareEvents(scenario.expected.events, execution.events);
            addLog(` ${execution.differences.length} differences`);
        } else {
            execution.differences = [];
            addLog(`ℹ No baseline`);
        }

        execution.passed = execution.differences.length === 0;
        execution.status = execution.passed ? "success" : "failed";
        addLog(`${execution.passed ? "✅" : "❌"} Replay ${execution.passed ? "PASSED" : "FAILED"}`);

    } catch (error) {
        execution.status = "error";
        execution.error = error.message;
        execution.passed = false;
        addLog(` ❌ Replay error: ${error.message}`);
    }

    execution.finishedAt = new Date().toISOString();
    execution.metrics = {
        totalEvents: execution.events.length,
        differences: execution.differences.length,
        serverCalls: execution.serverCalls?.length || 0,
        duration: new Date(execution.finishedAt) - new Date(execution.startedAt),
    };

    TNR_EXECUTIONS.set(executionId, execution);
    TNR_RUNNING.delete(executionId);

    try {
        const p = path.join(EXECUTIONS_DIR, `${executionId}.json`);
        await fs.writeFile(p, JSON.stringify(execution, null, 2));
        addLog(` 💾 Saved execution: ${executionId}.json`);
    } catch (e) {
        log(`Failed to save execution: ${e.message}`);
    }

    return execution;
}

/* ========================================================================== */
/* CLIENT OCPP (Perf & Simu)                                                  */
/* ========================================================================== */

class Client {
    constructor(row, opts) {
        this.cpId = row.cpId;
        this.idTag = row.idTag;
        this.url = finalUrl(opts.url, this.cpId);

        this.ws = null;
        this.status = "queued";
        this.lastError = undefined;
        this.txId = undefined;
        this._pending = new Map();
        this._seq = 1;
        this._mvTimer = null;
        this._startedAt = 0;

        this.opts = { ...opts };
        this.mvConfig = null;

        this.metrics = {
            bootTime: 0, authTime: 0, startTime: 0, stopTime: 0,
            messageCount: 0, bytesReceived: 0, bytesSent: 0,
            stationKwMax: undefined, backendKwMax: undefined,
            txpKw: undefined, txdpKw: undefined, voltage: undefined, phases: undefined,
        };
        this._t0Boot = 0; this._t0Auth = 0; this._t0Start = 0; this._t0Stop = 0;

        this.sessionLogs = [];
    }

    addLog(line) {
        const ts = new Date().toTimeString().slice(0, 8);
        this.sessionLogs.push({ ts, line });
        if (this.sessionLogs.length > LOG_MAX)
            this.sessionLogs.splice(0, this.sessionLogs.length - LOG_MAX);
    }

    nextMsgId() { return `${Date.now()}-${this._seq++}`; }

    sendCall(action, payload) {
        if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
        try {
            const msgId = this.nextMsgId();
            this._pending.set(msgId, action);
            const frame = [2, msgId, action, payload];
            const data = JSON.stringify(frame);
            this.metrics.bytesSent += data.length;
            this.metrics.messageCount++;
            RECORDER.tap("cp->cs", this.cpId, action, payload);
            this.ws.send(data);
            STATS.msgs++;
            this.addLog(`>> Sent ${action}(msgId=${msgId})`);
            return msgId;
        } catch (e) {
            this.fail(`Send ${action} error: ${e?.message || e}`);
        }
    }

    connect() {
        if (this.ws) return;
        this.status = "connecting";
        this.addLog(` Connexion en cours...`);
        this.addLog(` Tentative: ${this.url}`);
        log(`WS connect → ${this.cpId} (${this.url})`);
        try {
            this.ws = new WebSocket(this.url, "ocpp1.6");
        } catch (e) {
            this.fail(`WS create error: ${e?.message || e}`); return;
        }

        this.ws.on("open", () => {
            this.status = "connected";
            this.addLog(`✓ WS connecté sur ${this.url}`);
            this._t0Boot = performance.now();
            this.sendCall("BootNotification", {
                chargePointVendor: "EVSE Simulator",
                chargePointModel: "PerfClient",
            });
        });

        this.ws.on("message", (buf) => {
            const s = buf.toString("utf8");
            this.metrics.bytesReceived += s.length;
            let msg; try { msg = JSON.parse(s); } catch { return; }
            const type = msg[0];

            if (type === 3) {
                // Réponse (RESULT)
                const [, msgId, payload] = msg;
                const action = this._pending.get(msgId);
                this._pending.delete(msgId);
                if (action) {
                    this.addLog(`<< RESULT ${action}: ${JSON.stringify(payload)}`);
                    RECORDER.tap("cs->cp", this.cpId, `${action}Result`, payload);
                    this.handleResult(action, payload);
                }
            } else if (type === 2) {
                // Appel du serveur (CALL)
                const [, msgId, action, payload] = msg;
                this.addLog(`<< CALL ${action}: ${JSON.stringify(payload)}`);
                RECORDER.tap("cs->cp", this.cpId, action, payload);

                try {
                    let response;
                    if (action === "GetConfiguration") {
                        // Réponse spécifique pour GetConfiguration
                        response = {
                            configurationKey: [
                                { key: "HeartbeatInterval", readonly: false, value: "300" },
                                { key: "MeterValueSampleInterval", readonly: false, value: String(this.opts.mvEverySec || 60) },
                                { key: "MeterValuesSampledData", readonly: false, value: "Energy.Active.Import.Register,Power.Active.Import" }
                            ],
                            unknownKey: []
                        };
                    } else {
                        // Réponse par défaut pour les autres actions
                        response = { status: "Accepted" };
                    }

                    this.ws.send(JSON.stringify([3, msgId, response]));
                    this.addLog(`>> Response sent [${msgId}]`);
                } catch {}
            } else if (type === 4) {
                // Erreur
                const [, , code, desc] = msg;
                this.fail(`OCPP Error: ${code} ${desc}`);
            }
        });

        this.ws.on("close", () => {
            if (this.status !== "error" && this.status !== "stopped") this.status = "closed";
            this.addLog(` WebSocket fermé`);
            this.cleanup();
        });
        this.ws.on("error", (err) => this.fail(`WebSocket error: ${err?.message || err}`));
    }

    handleResult(action, payload) {
        // Capturer la réponse pour TNR si enregistrement actif
        if (RECORDER.on) {
            RECORDER.tap("cs->cp", this.cpId, `${action}Result`, payload);
        }

        if (action === "BootNotification") {
            const dt = Math.round(performance.now() - this._t0Boot);
            this.metrics.bootTime = dt;
            if (payload?.status === "Accepted") {
                this.status = "booted";
                this.addLog(`BootNotification accepté`);
                if (!this.opts.noAuth) {
                    this._t0Auth = performance.now();
                    const authPayload = { idTag: this.idTag };
                    this.sendCall("Authorize", authPayload);
                } else {
                    this.handleAuthorized();
                }
            } else {
                this.fail(`Boot denied: ${JSON.stringify(payload)}`);
            }
        } else if (action === "Authorize") {
            const dt = Math.round(performance.now() - this._t0Auth);
            this.metrics.authTime = dt;
            if (payload?.idTagInfo?.status === "Accepted") {
                this.status = "authorized";
                this.addLog(` Autorisation acceptée`);
                this.handleAuthorized();
            } else this.fail(`Authorize denied: ${JSON.stringify(payload)}`);
        } else if (action === "StartTransaction") {
            const dt = Math.round(performance.now() - this._t0Start);
            this.metrics.startTime = dt;
            if (payload?.transactionId != null) {
                this.txId = payload.transactionId;
                this.status = "started";
                this.addLog(` Transaction démarrée: ${this.txId}`);
                if (this.opts.mvEverySec > 0) { this.addLog(`⏱ MeterValues démarré (${this.opts.mvEverySec}s)`); this.startMeterValues(); }
                if (!this.opts.noStop && this.opts.holdSec > 0) setTimeout(() => this.stopTx(), this.opts.holdSec * 1000);
            } else this.fail(`StartTx refused: ${JSON.stringify(payload)}`);
        } else if (action === "StopTransaction") {
            const dt = Math.round(performance.now() - this._t0Stop);
            this.metrics.stopTime = dt;
            this.status = "stopped";
            this.addLog(` Transaction arrêtée`);
            this.close();
        }
    }

    handleAuthorized() {
        if (this.opts.noStart) {
            if (!this.opts.noStop && this.opts.holdSec > 0) setTimeout(() => this.close(), this.opts.holdSec * 1000);
            return;
        }
        this._t0Start = performance.now();
        this._startedAt = Date.now();
        this.sendCall("StartTransaction", {
            connectorId: 1,
            idTag: this.idTag,
            meterStart: 0,
            timestamp: new Date().toISOString(),
        });
    }

    startMeterValues() {
        this.stopMeterValues();
        const every = Math.max(1, this.opts.mvEverySec);
        const powerW = Math.max(0, (this.opts.powerKW ?? 7.4) * 1000);
        const voltage = Math.max(1, this.opts.voltageV ?? 230);
        const currentA = Math.round((powerW / voltage) * 10) / 10;

        const mvConfig = this.mvConfig || {
            mask: { powerActive: true, energy: true, soc: false, powerOffered: true },
            socStart: 20, socTarget: 80, evseType: "ac-mono", maxA: 32,
        };

        this._mvTimer = setInterval(() => {
            if (!this.txId || !this.ws || this.ws.readyState !== this.ws.OPEN) return;

            const elapsedSec = (Date.now() - this._startedAt) / 1000;
            const energyWh = Math.round((powerW * elapsedSec) / 3600);

            let soc = mvConfig.socStart;
            if (mvConfig.mask.soc) {
                const capacityWh = 60000;
                const socIncrement = (energyWh / capacityWh) * 100;
                soc = Math.min(mvConfig.socTarget, mvConfig.socStart + socIncrement);
            }

            const actualPowerW = Math.round(powerW * (0.95 + Math.random() * 0.1));

            const sampledValue = [];
            if (mvConfig.mask.energy) {
                sampledValue.push({ value: String(energyWh), measurand: "Energy.Active.Import.Register", unit: "Wh", context: "Sample.Periodic" });
            }
            if (mvConfig.mask.powerActive) {
                sampledValue.push({ value: String(actualPowerW), measurand: "Power.Active.Import", unit: "W", context: "Sample.Periodic" });
            }
            if (mvConfig.mask.soc) {
                sampledValue.push({ value: String(Math.round(soc * 10) / 10), measurand: "SoC", unit: "Percent", context: "Sample.Periodic" });
            }
            if (mvConfig.mask.powerOffered) {
                const offeredW = mvConfig.maxA * voltage;
                sampledValue.push({ value: String(Math.round(offeredW)), measurand: "Power.Offered", unit: "W", context: "Sample.Periodic" });
            }
            sampledValue.push(
                { value: String(currentA), measurand: "Current.Import", unit: "A", context: "Sample.Periodic" },
                { value: String(voltage), measurand: "Voltage", unit: "V", context: "Sample.Periodic" }
            );

            const meterValue = { timestamp: new Date().toISOString(), sampledValue };
            this.sendCall("MeterValues", { connectorId: 1, transactionId: this.txId, meterValue: [meterValue] });

            const powerKW = (actualPowerW / 1000).toFixed(1);
            const socStr = mvConfig.mask.soc ? `, SoC=${Math.round(soc * 10) / 10}%` : "";
            this.addLog(` MeterValues: ${powerKW}kW${socStr}`);
        }, every * 1000);
    }

    stopMeterValues() {
        if (this._mvTimer) { clearInterval(this._mvTimer); this._mvTimer = null; this.addLog(`⏱ MeterValues arrêté`); }
    }

    stopTx() {
        if (!this.txId || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
        this._t0Stop = performance.now();
        this.sendCall("StopTransaction", {
            transactionId: this.txId, meterStop: 0, timestamp: new Date().toISOString(), reason: "Local",
        });
        this.stopMeterValues();
    }

    close() { try { this.ws?.close(); } catch {} this.cleanup(); }
    cleanup() { this.stopMeterValues(); this.ws = null; }
    fail(message) {
        this.status = "error"; this.lastError = message; STATS.errors++;
        log(`Erreur ${this.cpId}: ${message}`); this.addLog(` ${message}`); this.close();
    }
}
/* ========================================================================== */
/* APP / UPLOAD / CORS                                                        */
/* ========================================================================== */

const app = express();
app.use(cors({
    origin: function(origin, callback) {
        // Permet toutes les origines en dev
        callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: '*',
    exposedHeaders: '*',
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use((req, res, next) => { if (req.path.startsWith('/api/tnr/executions')) { console.log(`[DEBUG] ${req.method} ${req.path} - Handler chain reached`); } next(); });


let routeCounter = 0;

// Intercepteur avant chaque middleware
const originalUse = app.use;
app.use = function(...args) {
    const index = routeCounter++;
    const [path, ...handlers] = args;

    // Wrap chaque handler pour tracer
    if (typeof path === 'function') {
        const wrapped = function(req, res, next) {
            if (req.path.startsWith('/api/tnr/executions')) {
                console.log(`[MW ${index}] Processing ${req.path}`);
            }
            return path.call(this, req, res, next);
        };
        return originalUse.call(this, wrapped);
    }

    return originalUse.call(this, ...args);
};

// Parse bodies
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use(bodyParser.text({ type: ["text/*", "application/csv"], limit: "20mb" }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
});
app.get("/api/tnr/executions", async (_req, res) => {
    try {
        const list = [];

        // Ajouter les exécutions en mémoire
        for (const [id, exec] of TNR_EXECUTIONS) {
            list.push({
                executionId: id,
                scenarioId: exec.scenarioId,
                timestamp: exec.startedAt,
                passed: exec.passed,
                metrics: exec.metrics || {}
            });
        }

        // Vérifier et créer le dossier si nécessaire
        if (!fsSync.existsSync(EXECUTIONS_DIR)) {
            console.log(`Creating executions directory at: ${EXECUTIONS_DIR}`);
            try {
                fsSync.mkdirSync(EXECUTIONS_DIR, { recursive: true });
            } catch (mkdirError) {
                console.log(`Could not create directory: ${mkdirError.message}`);
                // Continue anyway - return what we have in memory
                return res.json(list);
            }
        }
        // Lire les fichiers du dossier
        try {
            const files = await fs.readdir(EXECUTIONS_DIR);
            console.log(`Found ${files.length} execution files in ${EXECUTIONS_DIR}`);

            for (const file of files) {
                if (!file.endsWith(".json")) continue;
                const id = file.replace(".json", "");
                if (TNR_EXECUTIONS.has(id)) continue;

                try {
                    const fullPath = path.join(EXECUTIONS_DIR, file);
                    const data = JSON.parse(await fs.readFile(fullPath, "utf8"));
                    list.push({
                        executionId: data.executionId || id,
                        scenarioId: data.scenarioId || "unknown",
                        timestamp: data.startedAt || new Date().toISOString(),
                        passed: data.passed || false,
                        metrics: data.metrics || {}
                    });
                } catch (fileError) {
                    console.log(`Error reading execution file ${file}:`, fileError.message);
                }
            }
        } catch (readError) {
            console.log(`Error reading executions directory: ${readError.message}`);
            // Return what we have in memory even if we can't read the directory
        }

        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        res.json(list);

    } catch (error) {
        console.error(`Error in /api/tnr/executions:`, error);
        // Always return a valid response
        res.json([]);
    }
});
// Détail exécution
app.get("/api/tnr/executions/:id", async (req, res) => {
    const id = req.params.id;
    if (id.startsWith("exec_")) {
        if (TNR_EXECUTIONS.has(id)) return res.json(TNR_EXECUTIONS.get(id));
        if (TNR_RUNNING.has(id))    return res.json(TNR_RUNNING.get(id));
        try {
            const data = JSON.parse(await fs.readFile(path.join(EXECUTIONS_DIR, `${id}.json`), "utf8"));
            if (!data.logs) data.logs = [];
            return res.json(data);
        } catch { return res.status(404).json({ error: "Execution not found" }); }
    }
    const latest = await findLatestExecForScenario(id);
    if (latest) return res.json(latest);
    return res.status(404).json({ error: "Execution not found" });
});

// Logs exécution
app.get("/api/tnr/executions/:id/logs", async (req, res) => {
    const id = req.params.id;

    if (id.startsWith("exec_")) {
        if (TNR_EXECUTIONS.has(id)) return res.json(TNR_EXECUTIONS.get(id).logs || []);
        if (TNR_RUNNING.has(id))    return res.json(TNR_RUNNING.get(id).logs || []);
        try { const data = JSON.parse(await fs.readFile(path.join(EXECUTIONS_DIR, `${id}.json`), "utf8")); return res.json(data.logs || []); }
        catch { return res.json([]); }
    }

    const latest = await findLatestExecForScenario(id);
    return res.json(latest?.logs || []);
});

app.get("/api/tnr/executions/:id/events", async (req, res) => {
    const id = req.params.id;

    // Chercher dans les exécutions en cours
    if (TNR_RUNNING.has(id)) {
        return res.json(TNR_RUNNING.get(id).events || []);
    }

    // Chercher dans les exécutions en mémoire
    if (TNR_EXECUTIONS.has(id)) {
        return res.json(TNR_EXECUTIONS.get(id).events || []);
    }

    // Chercher dans les fichiers
    try {
        const data = JSON.parse(
            await fs.readFile(path.join(EXECUTIONS_DIR, `${id}.json`), "utf8")
        );
        return res.json(data.events || []);
    } catch {
        return res.json([]);
    }
});
/* ========================================================================== */
/* SIMU (sessions unitaires)                                                  */
/* ========================================================================== */

class SimSession extends Client {
    constructor(apiSessionId, params) {
        super(
            { cpId: params.cpId, idTag: params.idTag },
            {
                url: params.url,
                mvEverySec: params.mvEverySec ?? 0,
                holdSec: params.holdSec ?? 0,
                noAuth: !params.auto,
                noStart: !params.auto,
                noStop: !params.auto,
                powerKW: 7.4,
                voltageV: 230,
            }
        );
        this.apiSessionId = apiSessionId;
        this.urlBase = params.url;
        this.auto = !!params.auto;
        this.vehicleInfo = null;
    }
}


// TEST DIRECT - À mettre TOUT EN HAUT après les app.use() initiaux
app.get("/api/tnr/executions", (req, res) => {
    console.log(">>> ROUTE HIT: /api/tnr/executions");
    res.json([{ test: "WORKING", timestamp: new Date().toISOString() }]);
});
/* ========================================================================== */
/* API ROUTES - System                                                        */
/* ========================================================================== */

app.get("/health", (_req, res) =>
    res.json({ status: RUN_STATE.running ? "RUNNING" : "IDLE", runId: RUN_STATE.runId })
);

app.get("/stats", (_req, res) =>
    res.json({ ...STATS, running: RUN_STATE.running, runId: RUN_STATE.runId })
);

/* ========================================================================== */
/* API ROUTES - Simulation EVSE                                               */
/* ========================================================================== */

app.get("/api/simu", (_req, res) => {
    const list = [...SESSIONS_MAP.values()].map((c) => ({
        id: c.apiSessionId,
        cpId: c.cpId,
        url: c.urlBase,
        status: c.status,
        txId: c.txId,
        lastError: c.lastError,
        metrics: c.metrics,
        source: "node",
    }));
    res.json(list);
});

app.post("/api/simu/session", async (req, res) => {
    try {
        const { url, cpId, idTag = "TAG-001", auto = false, holdSec = 0, mvEverySec = 0 } = req.body || {};
        if (!url || !cpId) return res.status(400).json({ error: "url & cpId required" });

        const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const s = new SimSession(id, { url, cpId, idTag, auto, holdSec, mvEverySec });
        SESSIONS_MAP.set(id, s);
        s.connect();
        if (auto) { s.opts.noAuth = false; s.opts.noStart = false; s.opts.noStop = false; }
        res.json({ ok: true, id, auto });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

app.delete("/api/simu/:id", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.json({ ok: true });
    try { s.close(); } catch {}
    SESSIONS_MAP.delete(req.params.id);
    res.json({ ok: true });
});

app.post("/api/simu/:id/authorize", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    const idTag = (req.body?.idTag ?? s.idTag ?? "TAG").toString();
    s.idTag = idTag; // <— on met à jour la session avec l’idTag saisi
    s.addLog(`Authorize: ${idTag}`);
    s._t0Auth = performance.now();
    s.sendCall("Authorize", { idTag });
    res.json({ ok: true, idTag });
});

app.post("/api/simu/:id/startTx", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    const connectorId = Number(req.body?.connectorId ?? 1);
    s._t0Start = performance.now();
    s._startedAt = Date.now();
    // on utilise l’idTag de la session (vient potentiellement du front /authorize)
    s.sendCall("StartTransaction", { connectorId, idTag: s.idTag || "TAG", meterStart: 0, timestamp: new Date().toISOString() });
    res.json({ ok: true });
});

app.post("/api/simu/:id/stopTx", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    s.stopTx();
    res.json({ ok: true });
});

app.post("/api/simu/:id/mv/start", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    const sec = toInt(req.body?.periodSec, 10);
    s.opts.mvEverySec = Math.max(1, sec);
    s.addLog(`MeterValues démarré (${s.opts.mvEverySec}s)`);
    s.startMeterValues();
    res.json({ ok: true });
});

app.post("/api/simu/:id/mv/stop", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    s.stopMeterValues();
    res.json({ ok: true });
});

app.post("/api/simu/:id/mv/restart", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    const sec = toInt(req.body?.periodSec, s.opts.mvEverySec);
    s.opts.mvEverySec = Math.max(1, sec);
    s.stopMeterValues();
    s.startMeterValues();
    res.json({ ok: true });
});

app.post("/api/simu/:id/ocpp", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "not found" });
    const { action, payload } = req.body || {};
    if (!action) return res.status(400).json({ error: "action required" });
    s.sendCall(action, payload || {});
    res.json({ ok: true });
});

app.get("/api/simu/:id/logs", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    res.json(s.sessionLogs || []);
});

/* ---- MV profile (masque + paramètres) ---- */
app.post("/api/simu/:id/status/mv-mask", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });

    const { mvMask, mvEverySec, socStart, socTarget, evseType, maxA } = req.body || {};
    if (mvEverySec !== undefined) s.opts.mvEverySec = mvEverySec;
    s.mvConfig = {
        mask: mvMask || { powerActive: true, energy: true, soc: false, powerOffered: true },
        socStart: socStart || 20,
        socTarget: socTarget || 80,
        evseType: evseType || "ac-mono",
        maxA: maxA || 32,
    };
    if (s.status === "started" && s.txId) {
        s.stopMeterValues();
        if (s.opts.mvEverySec > 0) {
            s.addLog(`Configuration MV mise à jour`);
            s.startMeterValues();
        }
    }
    res.json({ ok: true, config: s.mvConfig });
});
app.post("/api/simu/:id/mv-mask", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const { mvMask, mvEverySec, socStart, socTarget, evseType, maxA } = req.body || {};
    if (mvEverySec !== undefined) s.opts.mvEverySec = mvEverySec;
    s.mvConfig = {
        mask: mvMask || { powerActive: true, energy: true, soc: false, powerOffered: true },
        socStart: socStart || 20, socTarget: socTarget || 80, evseType: evseType || "ac-mono", maxA: maxA || 32,
    };
    if (s.status === "started" && s.txId) {
        s.stopMeterValues();
        if (s.opts.mvEverySec > 0) { s.addLog(`Configuration MV mise à jour`); s.startMeterValues(); }
    }
    res.json({ ok: true, config: s.mvConfig });
});
// Configuration endpoints for price API
app.get("/api/config/price-token", (_req, res) => {
    res.json({
        hasToken: !!PRICE_API_CONFIG.token,
        url: PRICE_API_CONFIG.url
    });
});

app.post("/api/config/price-token", (req, res) => {
    const { token, url } = req.body || {};

    if (token !== undefined) {
        PRICE_API_CONFIG.token = token;
    }
    if (url !== undefined) {
        PRICE_API_CONFIG.url = url;
    }

    res.json({
        ok: true,
        hasToken: !!PRICE_API_CONFIG.token,
        url: PRICE_API_CONFIG.url
    });
});
/* ---- Statuts véhicule / câble : envoient StatusNotification ---- */
app.post("/api/simu/:id/park", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const { vehicle = "Generic EV", socStart = 20 } = req.body || {};
    s.vehicleInfo = { vehicle, socStart };
    s.sendCall("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError", timestamp: new Date().toISOString() });
    s.addLog(`Vehicule garé: ${vehicle}, SoC=${socStart}%`);
    res.json({ ok: true, status: "parked" });
});

app.post("/api/simu/:id/plug", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    s.sendCall("StatusNotification", { connectorId: 1, status: "Preparing", errorCode: "NoError", timestamp: new Date().toISOString() });
    s.addLog(`Cable branché`);
    res.json({ ok: true, status: "plugged" });
});

app.post("/api/simu/:id/unplug", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    s.sendCall("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError", timestamp: new Date().toISOString() });
    s.addLog(`Cable débranché`);
    res.json({ ok: true, status: "unplugged" });
});

app.post("/api/simu/:id/leave", (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    s.vehicleInfo = null;
    s.sendCall("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError", timestamp: new Date().toISOString() });
    s.addLog(`Vehicule parti`);
    res.json({ ok: true, status: "left" });
});

/* ---- Alias “status/…” depuis le front ---- */
app.post("/api/simu/:id/status/park", (req, res) => { req.url = `/api/simu/${req.params.id}/park`; app._router.handle(req, res); });
app.post("/api/simu/:id/status/plug", (req, res) => { req.url = `/api/simu/${req.params.id}/plug`; app._router.handle(req, res); });
app.post("/api/simu/:id/status/unplug", (req, res) => { req.url = `/api/simu/${req.params.id}/unplug`; app._router.handle(req, res); });
app.post("/api/simu/:id/status/unpark", (req, res) => { req.url = `/api/simu/${req.params.id}/leave`; app._router.handle(req, res); });
/* ========================================================================== */
/* API ROUTES - TNR                                                           */
/* ========================================================================== */

// Helper: déduit le dossier d'un scénario
/* ========================================================================== */
/* TNR: capture d'événements envoyés par un front (UI)                        */
/* ========================================================================== */

// Helper: déduit le dossier d'un scénario (si pas déjà défini plus haut)
function inferFolder(j) {
    if (j.folder) return String(j.folder);
    const t = j.tags || [];
    const fv = t.find(x => /^folder:/i.test(x))?.split(":")[1];
    if (fv) return fv.trim();
    const dv = t.find(x => /^domain:/i.test(x))?.split(":")[1];
    if (dv) return dv.trim();
    return "default";
}

// Enregistre un événement transmis par le front pendant un enregistrement TNR
function recordEventFromFront(body = {}) {
    if (!RECORDER.on) return { ok: false, reason: "not_recording" };

    const { timestamp, type, action, sessionId, cpId, payload } = body;
    // t relatif au début d'enregistrement si timestamp (ms) fourni par le front
    const t = Number.isFinite(Number(timestamp))
        ? Math.max(0, Number(timestamp) - (RECORDER.t0 || Date.now()))
        : Date.now() - (RECORDER.t0 || Date.now());

    // normaliser l'action si c'est un clic UI ou une action métier
    const normAction = normalizeUiAction(action || type || "");

    // choisir un cpId : priorité au paramètre, sinon sessionId → events existants, sinon "CP-UI"
    let pickedCpId = String(cpId || "");
    if (!pickedCpId && sessionId && RECORDER.sessions.has(sessionId)) {
        pickedCpId = RECORDER.sessions.get(sessionId)?.cpId || "";
    }
    if (!pickedCpId) pickedCpId = "CP-UI";

    // construir l'événement et pousser dans le recorder
    const ev = {
        t,
        cpId: pickedCpId,
        dir: "ui",
        action: normAction || "UI",
        payload: payload || {},
        timestamp: Date.now(),
    };
    RECORDER.events.push(ev);

    // maintenir la map de sessions
    if (!RECORDER.sessions.has(pickedCpId)) {
        RECORDER.sessions.set(pickedCpId, {
            cpId: pickedCpId,
            idTag: payload?.idTag || "TAG-UI",
            firstEvent: ev.t,
            lastEvent: ev.t,
        });
    } else {
        const s = RECORDER.sessions.get(pickedCpId);
        s.lastEvent = ev.t;
    }

    return { ok: true };
}

// Endpoint: enregistrer un événement UI (pendant /api/tnr/recorder/start .. stop)
app.post("/api/tnr/record/event", (req, res) => {
    try {
        const r = recordEventFromFront(req.body || {});
        if (!r.ok) return res.status(400).json(r);
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Alias simple si le front envoie sur /api/ui/event
app.post("/api/ui/event", (req, res) => {
    req.url = "/api/tnr/record/event";
    app._router.handle(req, res);
});


// Status global TNR
app.get("/api/tnr/status", async (_req, res) => {
    let totalScenarios = 0;
    try {
        const files = await fs.readdir(TNR_DIR);
        totalScenarios = files.filter((f) => f.endsWith(".json") && !f.startsWith("exec_")).length;
    } catch {}
    res.json({
        isRecording: RECORDER.on,
        isReplaying: TNR_RUNNING.size > 0,
        recordingName: RECORDER.meta?.name || null,
        recordingEvents: Array.isArray(RECORDER.events) ? RECORDER.events.length : 0,
        recordingDuration: RECORDER.on ? Date.now() - (RECORDER.t0 || Date.now()) : 0,
        totalScenarios,
    });
});

// Liste simple des scénarios
app.get("/api/tnr", async (_req, res) => {
    try {
        const files = await fs.readdir(TNR_DIR);
        const list = files
            .filter((f) => f.endsWith(".json") && !f.startsWith("exec_"))
            .map((f) => f.replace(/\.json$/, ""));
        res.json(list);
    } catch { res.json([]); }
});

// Liste enrichie
app.get("/api/tnr/list", async (_req, res) => {
    try {
        const files = await fs.readdir(TNR_DIR);
        const out = [];
        for (const f of files) {
            if (!f.endsWith(".json") || f.startsWith("exec_")) continue;
            try {
                const full = path.join(TNR_DIR, f);
                const j = JSON.parse(fsSync.readFileSync(full, "utf8"));
                const st = fsSync.statSync(full);
                out.push({
                    id: j.id || f.replace(/\.json$/, ""),
                    name: j.name || f.replace(/\.json$/, ""),
                    description: j.description || "",  // IMPORTANT: inclure la description
                    tags: j.tags || [],
                    folder: inferFolder(j),
                    baseline: j.tags?.includes("baseline") || !!j.expected?.events,
                    createdAt: j.createdAt || new Date(st.mtimeMs).toISOString(),
                    eventsCount: Array.isArray(j.events) ? j.events.length : 0,
                    sessionsCount: Array.isArray(j.sessions) ? j.sessions.length : 0,
                    duration: j.metadata?.durationMs || 0,
                    config: j.config || {},
                });
            } catch {}
        }
        out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        res.json(out);
    } catch {
        res.json([]);
    }
});

// Détail scénario
app.get("/api/tnr/:id", async (req, res) => {
    try {
        const p = path.join(TNR_DIR, `${req.params.id}.json`);
        const raw = await fs.readFile(p, "utf8");
        res.json(JSON.parse(raw));
    } catch { res.status(404).json({ error: "not found" }); }
});

// Créer/sauvegarder un scénario
app.post("/api/tnr", async (req, res) => {
    try {
        const scenario = req.body || {};
        const id = scenario.id || `tnr_${Date.now()}`;
        scenario.id = id;
        const p = path.join(TNR_DIR, `${id}.json`);
        await fs.writeFile(p, JSON.stringify(scenario, null, 2), "utf8");
        res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e?.message || String(e) }); }
});

// Supprimer un scénario
app.delete("/api/tnr/:id", async (req, res) => {
    try { await fs.unlink(path.join(TNR_DIR, `${req.params.id}.json`)); res.json({ ok: true }); }
    catch { res.json({ ok: true }); }
});

// Enregistrement start
app.post("/api/tnr/recorder/start", (req, res) => {
    if (RECORDER.on) return res.status(409).json({ error: "already recording" });

    const { name = `record-${Date.now()}`, description = "", tags = [], folder, config = {} } = req.body || {};
    const ocppUrl = pickOcppUrl(req, { config });

    RECORDER.start({
        name, description, tags, folder,
        config: { ...config, url: ocppUrl },
        startedAt: new Date().toISOString(),
    });

    res.json({ ok: true, name, startedAt: new Date().toISOString(), url: ocppUrl });
});

// Alias
app.post("/api/tnr/record/start", (req, res) => { req.url = "/api/tnr/recorder/start"; app._router.handle(req, res); });

// Enregistrement stop
app.post("/api/tnr/recorder/stop", async (req, res) => {
    if (!RECORDER.on) {
        console.log("[TNR] Stop called but recorder not on");
        return res.status(400).json({ error: "not recording" });
    }

    const data = RECORDER.stop();
    console.log(`[TNR] Stopping - captured ${data.events.length} events`);

    const id = req.body?.id || `tnr_${Date.now()}`;
    const ocppUrl = pickOcppUrl(req, { metadata: RECORDER.meta });

    const scenario = {
        id,
        name: req.body?.name || RECORDER.meta?.name || id,
        description: req.body?.description || RECORDER.meta?.description || "",  // IMPORTANT
        tags: req.body?.tags || [],
        folder: req.body?.folder || RECORDER.meta?.folder,
        createdAt: new Date().toISOString(),
        config: { url: ocppUrl, ...(RECORDER.meta?.config || {}) },
        sessions: data.sessions,
        events: data.events,
        metadata: data.metadata,
        expected: req.body?.baseline ? { events: data.events, signature: signature(data.events) } : {},
    };

    console.log(`[TNR] Saving scenario with description: "${scenario.description}"`);  // Debug

    TNR_SCENARIOS.set(id, scenario);
    const p = path.join(TNR_DIR, `${id}.json`);

    try {
        await fs.writeFile(p, JSON.stringify(scenario, null, 2));
        console.log(`[TNR] Scenario saved to ${p}`);
    } catch (err) {
        console.error(`[TNR] Failed to save: ${err.message}`);
    }

    res.json({ ok: true, id, url: ocppUrl, ...data });
});

// Alias
app.post("/api/tnr/record/stop", (req, res) => { req.url = "/api/tnr/recorder/stop"; app._router.handle(req, res); });

// TAP (enregistrement d'événement UI)
app.post("/api/tnr/tap", (req, res) => {
    const { type, action, sessionId, payload } = req.body || {};
    const cpId = sessionId || payload?.cpId || "CP_DEFAULT";

    RECORDER.tap("ui", cpId, action, payload);

    res.json({ ok: true, recorded: RECORDER.on });
});

// Alias
app.post("/api/tnr/record/event", (req, res) => { req.url = "/api/tnr/tap"; app._router.handle(req, res); });

// Rejouer un scénario
app.post("/api/tnr/run/:id", async (req, res) => {
    try {
        const scenarioId = req.params.id;

        let scenario;
        if (TNR_SCENARIOS.has(scenarioId)) scenario = TNR_SCENARIOS.get(scenarioId);
        else {
            const p = path.join(TNR_DIR, `${scenarioId}.json`);
            scenario = JSON.parse(await fs.readFile(p, "utf8"));
        }

        const chosenUrl = pickOcppUrl(req, scenario);
        if (!scenario.config) scenario.config = {};
        if (!chosenUrl) return res.status(400).json({ error: "No URL in scenario config (pass ?url=… or set OCPP_URL)" });

        scenario.config.url = chosenUrl;
        persistScenarioUrlIfMissing(scenario.id, chosenUrl).catch(() => {});

        const execution = {
            executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            scenarioId: scenario.id,
            startedAt: new Date().toISOString(),
            status: "running",
            events: [],
            serverCalls: [],
            differences: [],
            logs: [],
            replayCfg: {
                realtime : req.query.realtime === "false" ? false : true,
                speed    : req.query.speed ? Number(req.query.speed) : 1,
                mode     : req.query.mode || 'fast',
                capMs    : req.query.capMs ? Number(req.query.capMs) : undefined
            },
            inputs: {
                url: chosenUrl,
                sessions: req.body?.replaySessions || scenario.sessions || [],
                compare: req.body?.compare || {},
                baseline: scenario.expected ? {
                    hasEvents: !!scenario.expected.events,
                    hasServerCalls: !!scenario.expected.serverCalls,
                    signature: scenario.expected.signature
                } : undefined
            }
        };
        TNR_RUNNING.set(execution.executionId, execution);
        TNR_EXECUTIONS.set(execution.executionId, execution);

        (async () => {
            try { await replayScenario(scenario, execution.replayCfg.realtime, execution); }
            catch (e) { log(`Replay failed: ${e?.message || e}`); }
        })();

        res.json({
            status: "running",
            scenarioId: scenario.id,
            executionId: execution.executionId,
            startedAt: execution.startedAt,
            logs: execution.logs,
            url: chosenUrl,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Statut d'exécution
app.get("/api/tnr/run/:id/status", async (req, res) => {
    const scenarioId = req.params.id;

    for (const exec of TNR_RUNNING.values()) {
        if (exec.scenarioId === scenarioId) {
            return res.json({
                scenarioId,
                status: exec.status || "running",
                startedAt: exec.startedAt,
                finishedAt: exec.finishedAt,
                logs: exec.logs || [],
                summary: exec.metrics ? {
                    totalEvents: exec.metrics.totalEvents || 0,
                    diffs: exec.metrics.differences || 0,
                    passed: exec.passed || false
                } : undefined
            });
        }
    }

    const lastExec = await findLatestExecForScenario(scenarioId);
    if (lastExec) {
        return res.json({
            scenarioId,
            status: lastExec.status || "completed",
            startedAt: lastExec.startedAt,
            finishedAt: lastExec.finishedAt,
            logs: lastExec.logs || [],
            summary: {
                totalEvents: lastExec.metrics?.totalEvents || 0,
                diffs: lastExec.metrics?.differences || 0,
                passed: lastExec.passed || false
            }
        });
    }

    return res.status(404).json({ error: "No execution found" });
});

// Réparation d'URL manquantes
app.post("/api/tnr/urls/repair", async (req, res) => {
    const url = pickOcppUrl(req, null);
    if (!url) return res.status(400).json({ error: "url required (body.url ou ?url=…)" });
    let fixed = 0, total = 0;
    try {
        const files = await fs.readdir(TNR_DIR);
        for (const f of files) {
            if (!f.endsWith(".json") || f.startsWith("exec_")) continue;
            total++;
            const full = path.join(TNR_DIR, f);
            try {
                const j = JSON.parse(await fs.readFile(full, "utf8"));
                if (!j.config) j.config = {};
                if (!j.config.url) { j.config.url = url; fixed++; await fs.writeFile(full, JSON.stringify(j, null, 2), "utf8"); }
            } catch {}
        }
    } catch (e) { return res.status(500).json({ error: e?.message || String(e) }); }
    res.json({ ok: true, url, fixed, total });
});

// Alias (Swagger /replay)
app.post("/api/tnr/replay/:id", (req, res) => {
    const qs = [];
    if (req.query.realtime) qs.push(`realtime=${req.query.realtime}`);
    if (req.query.speed) qs.push(`speed=${req.query.speed}`);
    if (req.query.mode) qs.push(`mode=${req.query.mode}`);
    if (req.query.capMs) qs.push(`capMs=${req.query.capMs}`);
    const tail = qs.length ? `?${qs.join("&")}` : "";
    req.url = `/api/tnr/run/${req.params.id}${tail}`;
    app._router.handle(req, res);
});

app.get("/api/tnr/replay/:id/status", (req, res) => {
    req.url = `/api/tnr/run/${req.params.id}/status`;
    app._router.handle(req, res);
});


/* ========================================================================== */
/* API ROUTES - TNR Executions                                                */
/* ========================================================================== */

// Liste & méta d'exécutions




/* ========================================================================== */
/* API ROUTES - TNR Folders                                                   */
/* ========================================================================== */

// Folders (groupes)
app.get("/api/tnr/folders", async (_req, res) => {
    const out = new Map();
    try {
        const files = await fs.readdir(TNR_DIR);
        for (const f of files) {
            if (!f.endsWith(".json") || f.startsWith("exec_")) continue;
            try {
                const j = JSON.parse(await fs.readFile(path.join(TNR_DIR, f), "utf8"));
                const folder = inferFolder(j);
                out.set(folder, (out.get(folder) || 0) + 1);
            } catch {}
        }
    } catch {}
    res.json([...out.entries()].map(([name, count], i) => ({ id: String(i + 1), name, count })));
});

// Scénarios d'un dossier
app.get("/api/tnr/folders/:name/list", async (req, res) => {
    const name = String(req.params.name || "default");
    const list = [];
    try {
        const files = await fs.readdir(TNR_DIR);
        for (const f of files) {
            if (!f.endsWith(".json") || f.startsWith("exec_")) continue;
            try {
                const j = JSON.parse(await fs.readFile(path.join(TNR_DIR, f), "utf8"));
                if (inferFolder(j) === name) {
                    list.push({
                        id: j.id || f.replace(/\.json$/, ""),
                        name: j.name || j.id || f.replace(/\.json$/, ""),
                        description: j.description || "",
                        tags: j.tags || [],
                        events: (j.events||[]).length,
                        config: j.config || {},
                    });
                }
            } catch {}
        }
    } catch {}
    res.json(list);
});

// Lancer tous les scénarios d'un dossier
app.post("/api/tnr/folder/:name/run", async (req, res) => {
    try {
        const folderName = req.params.name;
        const url = req.query.url || req.body?.url || DEFAULT_OCPP_URL;

        const files = await fs.readdir(TNR_DIR);
        let count = 0;

        for (const f of files) {
            if (!f.endsWith(".json") || f.startsWith("exec_")) continue;
            try {
                const j = JSON.parse(await fs.readFile(path.join(TNR_DIR, f), "utf8"));
                if (inferFolder(j) === folderName) {
                    // Lance le scénario avec les mêmes paramètres que run/:id
                    const execution = {
                        executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        scenarioId: j.id,
                        startedAt: new Date().toISOString(),
                        status: "running",
                        events: [],
                        serverCalls: [],
                        differences: [],
                        logs: [],
                        replayCfg: {
                            realtime: req.query.realtime === "false" ? false : true,
                            speed: req.query.speed ? Number(req.query.speed) : 1,
                            mode: req.query.mode || 'fast'
                        }
                    };

                    TNR_RUNNING.set(execution.executionId, execution);
                    TNR_EXECUTIONS.set(execution.executionId, execution);

                    // Lance en arrière-plan
                    (async () => {
                        try {
                            j.config = j.config || {};
                            j.config.url = url;
                            await replayScenario(j, execution.replayCfg.realtime, execution);
                        } catch (e) {
                            log(`Replay failed: ${e?.message || e}`);
                        }
                    })();

                    count++;
                }
            } catch {}
        }

        res.json({ ok: true, count, folder: folderName, url });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

/* ========================================================================== */
/* API ROUTES - TNR Analysis                                                  */
/* ========================================================================== */

// Route d'analyse par domaine
app.get("/api/tnr/analysis/domains", async (req, res) => {
    const analysis = {};

    for (const [key, domain] of Object.entries(OCPP_DOMAINS)) {
        analysis[key] = {
            ...domain,
            scenarios: 0,
            totalEvents: 0,
            avgDuration: 0,
            passRate: 0,
            executions: []
        };
    }

    try {
        const files = await fs.readdir(TNR_DIR);

        for (const file of files) {
            if (!file.endsWith(".json") || file.startsWith("exec_")) continue;

            const scenario = JSON.parse(
                await fs.readFile(path.join(TNR_DIR, file), "utf8")
            );

            const { domainStats } = analyzeScenario(scenario);

            for (const [domain, stats] of Object.entries(domainStats)) {
                if (stats.count > 0 && analysis[domain]) {
                    analysis[domain].scenarios++;
                    analysis[domain].totalEvents += stats.count;
                    analysis[domain].avgDuration += stats.avgTime;
                }
            }
        }

        // Calculer les taux de réussite depuis les exécutions
        const execFiles = await fs.readdir(EXECUTIONS_DIR);
        for (const file of execFiles) {
            if (!file.endsWith(".json")) continue;

            const exec = JSON.parse(
                await fs.readFile(path.join(EXECUTIONS_DIR, file), "utf8")
            );

            for (const event of (exec.events || [])) {
                const domain = classifyEvent(event);
                if (analysis[domain]) {
                    analysis[domain].executions.push({
                        passed: exec.passed,
                        duration: exec.metrics?.duration
                    });
                }
            }
        }

        // Calculer les moyennes finales
        for (const domain of Object.values(analysis)) {
            if (domain.scenarios > 0) {
                domain.avgDuration = Math.round(domain.avgDuration / domain.scenarios);
            }
            if (domain.executions.length > 0) {
                const passed = domain.executions.filter(e => e.passed).length;
                domain.passRate = Math.round((passed / domain.executions.length) * 100);
            }
        }

    } catch (e) {
        log(`Analysis error: ${e.message}`);
    }

    res.json(analysis);
});

// Route de comparaison de performance
app.get("/api/tnr/analysis/performance/:id", async (req, res) => {
    const scenarioId = req.params.id;

    try {
        const scenario = JSON.parse(
            await fs.readFile(path.join(TNR_DIR, `${scenarioId}.json`), "utf8")
        );

        // Récupérer toutes les exécutions de ce scénario
        const executions = [];
        const files = await fs.readdir(EXECUTIONS_DIR);

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const exec = JSON.parse(
                await fs.readFile(path.join(EXECUTIONS_DIR, file), "utf8")
            );
            if (exec.scenarioId === scenarioId) {
                executions.push(exec);
            }
        }

        // Analyser les métriques
        const analysis = {
            scenario: {
                id: scenarioId,
                name: scenario.name,
                originalDuration: scenario.metadata?.durationMs || 0,
                eventsCount: (scenario.events || []).length
            },
            executions: executions.map(exec => ({
                id: exec.executionId,
                timestamp: exec.startedAt,
                duration: exec.metrics?.duration || 0,
                overhead: (exec.metrics?.duration || 0) - (scenario.metadata?.durationMs || 0),
                passed: exec.passed,
                differences: exec.metrics?.differences || 0
            })),
            metrics: {
                avgReplayDuration: 0,
                avgOverhead: 0,
                minDuration: Number.MAX_VALUE,
                maxDuration: 0,
                passRate: 0,
                performanceTrend: []
            }
        };

        if (executions.length > 0) {
            const durations = executions.map(e => e.metrics?.duration || 0);
            analysis.metrics.avgReplayDuration = Math.round(
                durations.reduce((a, b) => a + b, 0) / durations.length
            );
            analysis.metrics.avgOverhead =
                analysis.metrics.avgReplayDuration - analysis.scenario.originalDuration;
            analysis.metrics.minDuration = Math.min(...durations);
            analysis.metrics.maxDuration = Math.max(...durations);
            analysis.metrics.passRate = Math.round(
                (executions.filter(e => e.passed).length / executions.length) * 100
            );

            // Tendance de performance (dernières 10 exécutions)
            const recent = executions
                .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
                .slice(0, 10);

            analysis.metrics.performanceTrend = recent.map(e => ({
                timestamp: e.startedAt,
                duration: e.metrics?.duration || 0,
                passed: e.passed
            }));
        }

        res.json(analysis);

    } catch (e) {
        res.status(404).json({ error: e.message });
    }
});

/* ========================================================================== */
/* API ROUTES - Performance Testing                                           */
/* ========================================================================== */

async function startRun(body) {
    if (RUN_STATE.running) {
        const err = new Error("Runner already running");
        err.code = 409;
        throw err;
    }

    const url = String(body.url || "").trim();
    if (!url) throw new Error("Missing 'url' (OCPP WebSocket URL)");

    const useCsv = !!body.useCsv;
    const sessionsCap = Math.max(0, Number(body.sessions ?? body.session) || 0);

    let rows = [];
    if (useCsv) {
        const candidate = String(body.csvText ?? "").trim();
        const csvSource = isValidCsv(candidate) ? candidate : IMPORTED_CSV || "";

        if (!csvSource) throw new Error("CSV requis (import / multipart / csvText)");
        if (sessionsCap <= 0) throw new Error("Le paramètre 'sessions' est requis quand useCsv=true");

        rows = buildPoolRowsFromCsv(csvSource, sessionsCap);

        if (rows.length === 0) {
            throw new Error("CSV invalide ou vide après parsing");
        }

        // Log pour debug
        log(`CSV rows loaded: ${rows.length} (first: ${rows[0]?.cpId || 'none'})`);
    } else {
        // Génération automatique
        rows = Array.from({ length: sessionsCap }).map((_, i) => ({
            cpId: `perf_${String(i + 1).padStart(5, "0")}`,
            idTag: `TAG_${String(i + 1).padStart(5, "0")}`,
        }));
    }

    if (!rows.length) throw new Error("Aucune session à lancer");


    RUN_STATE = {
        ...RUN_STATE,
        running: true,
        runId: `run-${Date.now()}`,
        url,
        sessionsPlanned: rows.length,
        concurrent: Math.max(1, Number(body.concurrent) || 1),
        rampMs: Math.max(50, Number(body.rampMs) || 250),
        holdSec: Math.max(0, Number(body.holdSec) || 0),
        mvEverySec: Math.max(0, Number(body.mvEverySec) || 0),
        powerKW: Math.max(0, Number(body.powerKW) || 7.4),
        voltageV: Math.max(1, Number(body.voltageV) || 230),
        noAuth: !!body.noAuth,
        noStart: !!body.noStart,
        noStop: !!body.noStop,
        useCsv,
        csvPairs: rows,
    };

    resetStats();
    log(`START runId=${RUN_STATE.runId}, sessions=${rows.length}, conc=${RUN_STATE.concurrent}`);

    POOL = [];
    let idx = 0;

    const spawn = async () => {
        if (!RUN_STATE.running) return;

        const inflight = POOL.filter((p) =>
            ["connecting", "connected", "booted", "authorized", "started"].includes(p.status)
        ).length;

        if (idx < rows.length && inflight < RUN_STATE.concurrent) {
            const row = rows[idx++];
            const c = new Client(row, {
                url: RUN_STATE.url,
                mvEverySec: RUN_STATE.mvEverySec,
                holdSec: RUN_STATE.holdSec,
                noAuth: RUN_STATE.noAuth,
                noStart: RUN_STATE.noStart,
                noStop: RUN_STATE.noStop,
                powerKW: RUN_STATE.powerKW,
                voltageV: RUN_STATE.voltageV,
            });
            POOL.push(c);
            STATS.total++;
            STATS.active++;
            log(`Spawn #${idx}/${rows.length} → ${row.cpId}`);
            c.connect();
        }

        STATS.finished = POOL.filter((p) => ["stopped", "closed"].includes(p.status)).length;
        STATS.active = POOL.filter((p) =>
            ["connecting", "connected", "booted", "authorized", "started"].includes(p.status)
        ).length;

        if (idx >= rows.length && STATS.active === 0) {
            RUN_STATE.running = false;
            log("Run finished.");
            return;
        }
        setTimeout(spawn, RUN_STATE.rampMs);
    };

    setTimeout(spawn, 0);
    return { ok: true, runId: RUN_STATE.runId };
}

function buildPoolRowsFromCsv(csvText, limit) {
    let pairs = parseCsv(csvText);
    // Log pour debug
    if (pairs.length > 0) {
        log(`CSV parsed: ${pairs.length} valid pairs found`);
        log(`First pair: cpId="${pairs[0].cpId}", idTag="${pairs[0].idTag}"`);
    } else {
        log(`CSV parse failed: no valid pairs found from input`);
    }
    if (limit && limit > 0) {
        pairs = pairs.slice(0, limit);
    }
    return pairs;
}

async function stopRun() {
    const clients = [...POOL];
    RUN_STATE.running = false;
    if (!clients.length) return { ok: true };

    for (const c of clients) {
        try { if (c.status === "started" && c.txId && c.ws && c.ws.readyState === c.ws.OPEN) c.stopTx(); } catch {}
    }
    await sleep(800);
    for (const c of clients) { try { c.close(); } catch {} }

    POOL = []; STATS.active = 0;
    return { ok: true };
}

app.post("/api/perf/start", upload.any(), async (req, res) => {
    try {
        const body = typeof req.body === "object" ? req.body : {};

        const cfg = {
            url: body.url,
            sessions: toInt(body.sessions ?? body.session, 0),
            concurrent: toInt(body.concurrent, 1),
            rampMs: toInt(body.rampMs, 250),
            holdSec: toInt(body.holdSec, 0),
            mvEverySec: toInt(body.mvEverySec, 0),
            powerKW: Number(body.powerKW ?? 7.4),
            voltageV: toInt(body.voltageV, 230),
            useCsv: toBool(body.useCsv),
            noAuth: toBool(body.noAuth),
            noStart: toBool(body.noStart),
            noStop: toBool(body.noStop),
            csvText: body.csvText,
        };

        // Traitement du fichier CSV uploadé
        if (Array.isArray(req.files) && req.files.length) {
            cfg.csvText = req.files[0].buffer.toString("utf8");
            cfg.useCsv = true;
        }

        const r = await startRun(cfg);
        res.json(r);
    } catch (e) {
        const code = e?.code === 409 ? 409 : 400;
        log(`Erreur START: ${e?.message || e}`);
        res.status(code).json({ error: e?.message || String(e) });
    }
});

app.post("/api/perf/stop", async (_req, res) => res.json(await stopRun()));

app.get("/api/perf/status", (_req, res) =>
    res.json({
        run: { status: RUN_STATE.running ? "RUNNING" : "IDLE", runId: RUN_STATE.runId },
        stats: { ...STATS },
        pool: POOL.map((c) => ({ cpId: c.cpId, idTag: c.idTag, status: c.status, txId: c.txId, lastError: c.lastError })),
    })
);
// Ajoutez cette route CSV template d'abord
app.get("/api/perf/csv-template", (_req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send("cpId,idTag\ncp0001,TAG-0001\ncp0002,TAG-0002");
});

// Puis la route import
app.post("/api/perf/import", upload.single("file"), async (req, res) => {
    try {
        let csvData = "";
        let pairs = [];

        if (req.file) {
            // Fichier uploadé
            csvData = req.file.buffer.toString("utf8");
        } else if (req.body.csv) {
            // CSV en texte
            csvData = req.body.csv;
        } else {
            return res.status(400).json({ error: "No CSV data provided" });
        }

        // Parser le CSV
        pairs = parseCsv(csvData);
        IMPORTED_CSV = csvData; // Stocker pour usage futur

        res.json({
            ok: true,
            count: pairs.length,
            source: req.file ? "file" : "json"
        });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.get("/api/export", (_req, res) => {
    res.json({
        runId: RUN_STATE.runId,
        config: {
            url: RUN_STATE.url,
            sessions: RUN_STATE.sessionsPlanned,
            concurrent: RUN_STATE.concurrent,
            holdSec: RUN_STATE.holdSec,
            rampMs: RUN_STATE.rampMs,
            mvEverySec: RUN_STATE.mvEverySec,
            powerKW: RUN_STATE.powerKW,
            voltageV: RUN_STATE.voltageV,
            noAuth: RUN_STATE.noAuth,
            noStart: RUN_STATE.noStart,
            noStop: RUN_STATE.noStop,
            useCsv: RUN_STATE.useCsv,
        },
        results: {
            total: STATS.total,
            finished: STATS.finished,
            errors: STATS.errors,
            avgLatencyMs: STATS.avgLatencyMs,
            totalMessages: STATS.msgs,
            cpu: STATS.cpu,
            memMB: STATS.mem,
        },
        timestamp: new Date().toISOString(),
    });
});

app.get("/api/metrics", (_req, res) => {
    const m = POOL.map((x) => x.metrics);
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    res.json({
        avgBootTime: Math.round(avg(m.map((x) => x.bootTime))),
        avgAuthTime: Math.round(avg(m.map((x) => x.authTime))),
        avgStartTime: Math.round(avg(m.map((x) => x.startTime))),
        avgStopTime: Math.round(avg(m.map((x) => x.stopTime))),
        totalBytes: sum(m.map((x) => x.bytesReceived + x.bytesSent)),
        totalMessages: sum(m.map((x) => x.messageCount)),
    });
});

app.get("/last-errors", (_req, res) => {
    const errs = POOL.filter((c) => c.status === "error").map((c) => ({
        cpId: c.cpId,
        error: c.lastError,
    }));
    res.json(errs.slice(-200));
});
// Route pour récupérer le prix d'une session avec appel API externe
app.get("/api/simu/:id/price", async (req, res) => {
    const s = SESSIONS_MAP.get(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });

    try {
        // Récupérer le token depuis le header ou la config
        const token = req.headers['x-price-token'] ||
            req.query.token ||
            PRICE_API_CONFIG.token;

        // Si pas de token configuré, utiliser un prix local
        if (!token) {
            const energyKWh = s.metrics?.energyKWh || 0;
            return res.json({
                pricePerKWh: 0.40,
                energyKWh,
                totalPrice: energyKWh * 0.40,
                currency: "EUR",
                source: "local",
                message: "No API token configured, using local pricing"
            });
        }

        app.get("/api/config/price-token", (_req, res) => {
            res.json({
                hasToken: !!PRICE_API_CONFIG.token,
                url: PRICE_API_CONFIG.url
            });
        });

        app.post("/api/config/price-token", (req, res) => {
            const { token, url } = req.body || {};

            if (token !== undefined) {
                PRICE_API_CONFIG.token = token;
            }
            if (url !== undefined) {
                PRICE_API_CONFIG.url = url;
            }

            res.json({
                ok: true,
                hasToken: !!PRICE_API_CONFIG.token,
                url: PRICE_API_CONFIG.url
            });
        });
        // Appeler l'API externe TotalEnergies
        log(`Calling price API for cpId=${s.cpId}, txId=${s.txId}`);

        const response = await fetch(PRICE_API_CONFIG.url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            log(`Price API error: ${response.status} ${response.statusText}`);
            const energyKWh = s.metrics?.energyKWh || 0;
            return res.json({
                pricePerKWh: 0.40,
                energyKWh,
                totalPrice: energyKWh * 0.40,
                currency: "EUR",
                source: "api_error",
                error: `API returned ${response.status}`
            });
        }

        const data = await response.json();
        log(`API response received with ${data.items?.length || 0} transactions`);

        // Chercher LA transaction de cette session
        let transaction = null;

        if (data.items && Array.isArray(data.items)) {
            // D'ABORD: chercher par transactionId OCPP exact si on l'a
            if (s.txId) {
                transaction = data.items.find(item =>
                    item.ocppTransactionId === s.txId ||
                    item.transactionId === s.txId ||
                    item.id === s.txId
                );

                if (transaction) {
                    log(`Found exact transaction match by ID: ${s.txId}`);
                }
            }

            // SINON: chercher par cpId ET statut récent
            if (!transaction && s.cpId) {
                // Filtrer par cpId
                const cpTransactions = data.items.filter(item =>
                    item.chargePointId === s.cpId ||
                    item.ocppChargePointIdentity === s.cpId ||
                    item.evseId?.includes(s.cpId) ||
                    item.connectorId?.includes(s.cpId)
                );

                log(`Found ${cpTransactions.length} transactions for cpId: ${s.cpId}`);

                // Si on a des transactions pour ce CP
                if (cpTransactions.length > 0) {
                    // Prendre la plus récente qui est terminée
                    const completedTx = cpTransactions
                        .filter(tx =>
                            tx.status === "TransactionStopReceived" ||
                            tx.status === "Completed" ||
                            tx.stopDate != null
                        )
                        .sort((a, b) => {
                            const dateA = new Date(b.stopDate || b.lastUpdateDate || 0);
                            const dateB = new Date(a.stopDate || a.lastUpdateDate || 0);
                            return dateA - dateB;
                        });

                    if (completedTx.length > 0) {
                        transaction = completedTx[0];
                        log(`Using most recent completed transaction for cpId: ${s.cpId}`);
                    } else {
                        // Si pas de transaction terminée, prendre la plus récente en cours
                        transaction = cpTransactions.sort((a, b) => {
                            const dateA = new Date(b.startDate || b.lastUpdateDate || 0);
                            const dateB = new Date(a.startDate || a.lastUpdateDate || 0);
                            return dateA - dateB;
                        })[0];
                        log(`Using most recent ongoing transaction for cpId: ${s.cpId}`);
                    }
                }
            }

            // EN DERNIER RECOURS: prendre la plus récente terminée peu importe le CP
            if (!transaction) {
                const anyCompleted = data.items
                    .filter(item =>
                        item.status === "TransactionStopReceived" &&
                        item.valorization != null
                    )
                    .sort((a, b) => {
                        const dateA = new Date(b.stopDate || b.lastUpdateDate || 0);
                        const dateB = new Date(a.stopDate || a.lastUpdateDate || 0);
                        return dateA - dateB;
                    });

                if (anyCompleted.length > 0) {
                    transaction = anyCompleted[0];
                    log(`Fallback: using most recent completed transaction from any CP`);
                }
            }
        }

        // Si on a trouvé une transaction avec valorisation
        if (transaction && transaction.valorization) {
            // Calculer l'énergie consommée
            const meterStart = parseFloat(transaction.meterStart || 0);
            const meterStop = parseFloat(transaction.meterStop || transaction.lastMeterIndex || 0);
            const energyWh = Math.max(0, meterStop - meterStart);
            const energyKWh = energyWh / 1000;

            // Récupérer les prix depuis la valorisation
            let totalPrice = 0;
            let pricePerKWh = 0.40; // Valeur par défaut

            // Prix TTC si disponible, sinon prix HT + TVA
            if (transaction.valorization.taxedPrice !== undefined) {
                totalPrice = parseFloat(transaction.valorization.taxedPrice);
            } else if (transaction.valorization.nonTaxedPrice !== undefined) {
                const ht = parseFloat(transaction.valorization.nonTaxedPrice);
                const taxRate = parseFloat(transaction.valorization.taxRate || 0.20);
                totalPrice = ht * (1 + taxRate);
            } else if (transaction.valorization.totalPrice !== undefined) {
                totalPrice = parseFloat(transaction.valorization.totalPrice);
            }

            // Calculer le prix au kWh
            if (energyKWh > 0 && totalPrice > 0) {
                pricePerKWh = totalPrice / energyKWh;
            } else if (transaction.valorization.pricePerKWh !== undefined) {
                pricePerKWh = parseFloat(transaction.valorization.pricePerKWh);
                if (energyKWh > 0) {
                    totalPrice = pricePerKWh * energyKWh;
                }
            }

            log(`Transaction found: ID=${transaction.ocppTransactionId}, Energy=${energyKWh}kWh, Total=${totalPrice}EUR`);

            return res.json({
                pricePerKWh,
                energyKWh,
                totalPrice,
                currency: transaction.valorization.currency || "EUR",
                source: "api",
                transactionId: transaction.ocppTransactionId || transaction.id,
                chargePointId: transaction.chargePointId,
                connectorId: transaction.connectorId,
                status: transaction.status,
                startTime: transaction.startDate,
                stopTime: transaction.stopDate,
                meterStart: meterStart,
                meterStop: meterStop,
                details: {
                    taxedPrice: transaction.valorization.taxedPrice,
                    nonTaxedPrice: transaction.valorization.nonTaxedPrice,
                    taxRate: transaction.valorization.taxRate,
                    billingStatus: transaction.valorization.billingStatus,
                    pricingPlanId: transaction.valorization.pricingPlanId
                },
                rawTransaction: {
                    id: transaction.id,
                    ocppTransactionId: transaction.ocppTransactionId,
                    userId: transaction.userId,
                    rfidTag: transaction.rfidTag
                }
            });
        }

        // Si aucune transaction trouvée mais qu'on a des données
        if (data.items && data.items.length > 0) {
            log(`API has ${data.items.length} transactions but none match our session (cpId=${s.cpId}, txId=${s.txId})`);

            // Retourner quand même des infos utiles
            const energyKWh = s.metrics?.energyKWh || 0;
            return res.json({
                pricePerKWh: 0.40,
                energyKWh,
                totalPrice: energyKWh * 0.40,
                currency: "EUR",
                source: "local_fallback",
                message: `Transaction not found in API (looking for cpId=${s.cpId}, txId=${s.txId})`,
                apiTransactionCount: data.items.length,
                searchCriteria: {
                    cpId: s.cpId,
                    txId: s.txId
                }
            });
        }

        // Fallback complet si pas de données
        log(`No transactions in API response`);
        const energyKWh = s.metrics?.energyKWh || 0;
        res.json({
            pricePerKWh: 0.40,
            energyKWh,
            totalPrice: energyKWh * 0.40,
            currency: "EUR",
            source: "local_fallback",
            message: "No transactions found in API response"
        });

    } catch (error) {
        log(`Error fetching price: ${error.message}`);
        const energyKWh = s.metrics?.energyKWh || 0;
        res.json({
            pricePerKWh: 0.40,
            energyKWh,
            totalPrice: energyKWh * 0.40,
            currency: "EUR",
            source: "local_error",
            error: error.message
        });
    }
});
app.get("/logs", (_req, res) => {
    res.type("text/plain");
    res.send(LOGS.join("\n"));
});
app.get("/api/debug/paths", (_req, res) => {
    res.json({
        __dirname: __dirname,
        TNR_DIR: TNR_DIR,
        EXECUTIONS_DIR: EXECUTIONS_DIR,
        exists_TNR: fsSync.existsSync(TNR_DIR),
        exists_EXEC: fsSync.existsSync(EXECUTIONS_DIR),
        cwd: process.cwd()
    });
});


app.get("/__debug/routes", (req, res) => {
    const routes = [];
    app._router.stack.forEach((m) => {
        if (m.route && m.route.path) {
            const methods = Object.keys(m.route.methods).join(",").toUpperCase();
            routes.push(`${methods} ${m.route.path}`);
        } else if (m.name === "router" && m.handle?.stack) {
            m.handle.stack.forEach((h) => {
                if (h.route) {
                    const methods = Object.keys(h.route.methods).join(",").toUpperCase();
                    routes.push(`${methods} ${h.route.path}`);
                }
            });
        }
    });
    res.json(routes.sort());
});

/* ========================================================================== */
/* API Documentation (Swagger)                                                */
/* ========================================================================== */

app.get("/api/docs", (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <title>GPM Simulator API</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
        SwaggerUIBundle({
            url: '/api/swagger.json',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [SwaggerUIBundle.presets.apis],
            layout: "BaseLayout"
        });
    </script>
</body>
</html>
    `);
});


app.get("/api/swagger.json", (_req, res) => {
    res.json({
        "openapi": "3.0.0",
        "info": {
            "title": "GPM Simulator API",
            "version": "1.0.0",
            "description": "API complète pour simulation OCPP, TNR (Test & Replay) et tests de performance"
        },
        "servers": [{ "url": "http://localhost:8877" }],
        "tags": [
            { "name": "System", "description": "Endpoints système" },
            { "name": "Simulation", "description": "Simulation EVSE unitaire" },
            { "name": "TNR", "description": "Test and Replay - Enregistrement et rejeu" },
            { "name": "TNR Executions", "description": "Gestion des exécutions TNR" },
            { "name": "TNR Analysis", "description": "Analyse et métriques TNR" },
            { "name": "Performance", "description": "Tests de charge et performance" }
        ],
        "paths": {
            "/health": {
                "get": {
                    "tags": ["System"],
                    "summary": "Health check",
                    "responses": {
                        "200": {
                            "description": "État du système",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "status": { "type": "string", "enum": ["IDLE", "RUNNING"] },
                                            "runId": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/stats": {
                "get": {
                    "tags": ["System"],
                    "summary": "Statistiques système",
                    "responses": {
                        "200": {
                            "description": "Métriques système",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "total": { "type": "integer" },
                                            "active": { "type": "integer" },
                                            "finished": { "type": "integer" },
                                            "errors": { "type": "integer" },
                                            "msgs": { "type": "integer" },
                                            "avgLatencyMs": { "type": "integer" },
                                            "cpu": { "type": "integer" },
                                            "mem": { "type": "number" },
                                            "running": { "type": "boolean" },
                                            "runId": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/logs": {
                "get": {
                    "tags": ["System"],
                    "summary": "Logs système (text brut)",
                    "responses": {
                        "200": {
                            "description": "Logs en texte",
                            "content": {
                                "text/plain": {
                                    "schema": {
                                        "type": "string"
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/simu": {
                "get": {
                    "tags": ["Simulation"],
                    "summary": "Liste des sessions de simulation",
                    "responses": {
                        "200": {
                            "description": "Liste des sessions actives",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string" },
                                                "cpId": { "type": "string" },
                                                "url": { "type": "string" },
                                                "status": { "type": "string" },
                                                "txId": { "type": "integer" },
                                                "lastError": { "type": "string" },
                                                "metrics": { "type": "object" },
                                                "source": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/simu/session": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Créer une nouvelle session de simulation",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["url", "cpId"],
                                    "properties": {
                                        "url": { "type": "string", "description": "URL OCPP WebSocket" },
                                        "cpId": { "type": "string", "description": "Identifiant ChargePoint" },
                                        "idTag": { "type": "string", "default": "TAG", "description": "Tag RFID" },
                                        "auto": { "type": "boolean", "default": false, "description": "Mode automatique" },
                                        "holdSec": { "type": "integer", "default": 0, "description": "Durée de charge (sec)" },
                                        "mvEverySec": { "type": "integer", "default": 0, "description": "Période MeterValues (sec)" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Session créée" },
                        "400": { "description": "Paramètres invalides" }
                    }
                }
            },
            "/api/simu/{id}": {
                "delete": {
                    "tags": ["Simulation"],
                    "summary": "Supprimer une session",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Session supprimée" }
                    }
                }
            },
            "/api/simu/{id}/authorize": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Envoyer Authorize",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "idTag": { "type": "string", "description": "Tag RFID" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Authorize envoyé" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/startTx": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Démarrer une transaction",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "connectorId": { "type": "integer", "default": 1 }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Transaction démarrée" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/stopTx": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Arrêter la transaction",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Transaction arrêtée" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/mv/start": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Démarrer MeterValues",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "periodSec": { "type": "integer", "minimum": 1 }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "MeterValues démarré" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/mv/stop": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Arrêter MeterValues",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "MeterValues arrêté" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/ocpp": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Envoyer un message OCPP personnalisé",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["action"],
                                    "properties": {
                                        "action": { "type": "string", "description": "Action OCPP" },
                                        "payload": { "type": "object", "description": "Payload OCPP" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Message envoyé" },
                        "400": { "description": "Action manquante" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/logs": {
                "get": {
                    "tags": ["Simulation"],
                    "summary": "Récupérer les logs d'une session",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": {
                            "description": "Logs de la session",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "ts": { "type": "string" },
                                                "line": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/simu/{id}/mv-mask": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Configurer le masque MeterValues",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "mvMask": {
                                            "type": "object",
                                            "properties": {
                                                "powerActive": { "type": "boolean" },
                                                "energy": { "type": "boolean" },
                                                "soc": { "type": "boolean" },
                                                "powerOffered": { "type": "boolean" }
                                            }
                                        },
                                        "mvEverySec": { "type": "integer" },
                                        "socStart": { "type": "integer" },
                                        "socTarget": { "type": "integer" },
                                        "evseType": { "type": "string" },
                                        "maxA": { "type": "integer" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Configuration mise à jour" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/park": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Simuler l'arrivée d'un véhicule",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "vehicle": { "type": "string", "default": "Generic EV" },
                                        "socStart": { "type": "integer", "default": 20 }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Véhicule garé" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/simu/{id}/plug": {
                "post": {
                    "tags": ["Simulation"],
                    "summary": "Brancher le câble",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Câble branché" },
                        "404": { "description": "Session non trouvée" }
                    }
                }
            },
            "/api/tnr/status": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "État global TNR",
                    "responses": {
                        "200": {
                            "description": "État TNR",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "isRecording": { "type": "boolean" },
                                            "isReplaying": { "type": "boolean" },
                                            "recordingName": { "type": "string" },
                                            "recordingEvents": { "type": "integer" },
                                            "recordingDuration": { "type": "integer" },
                                            "totalScenarios": { "type": "integer" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "Liste des scénarios (IDs seulement)",
                    "responses": {
                        "200": {
                            "description": "Liste des IDs de scénarios",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    }
                                }
                            }
                        }
                    }
                },
                "post": {
                    "tags": ["TNR"],
                    "summary": "Créer/sauvegarder un scénario",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "id": { "type": "string" },
                                        "name": { "type": "string" },
                                        "description": { "type": "string" },
                                        "tags": { "type": "array", "items": { "type": "string" } },
                                        "folder": { "type": "string" },
                                        "events": { "type": "array" },
                                        "sessions": { "type": "array" },
                                        "config": { "type": "object" },
                                        "expected": { "type": "object" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Scénario sauvegardé" },
                        "500": { "description": "Erreur de sauvegarde" }
                    }
                }
            },
            "/api/tnr/list": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "Liste détaillée des scénarios",
                    "responses": {
                        "200": {
                            "description": "Liste enrichie des scénarios",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string" },
                                                "name": { "type": "string" },
                                                "description": { "type": "string" },
                                                "tags": { "type": "array", "items": { "type": "string" } },
                                                "folder": { "type": "string" },
                                                "baseline": { "type": "boolean" },
                                                "createdAt": { "type": "string", "format": "date-time" },
                                                "eventsCount": { "type": "integer" },
                                                "sessionsCount": { "type": "integer" },
                                                "duration": { "type": "integer" },
                                                "config": { "type": "object" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr/{id}": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "Détail d'un scénario",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Détail du scénario" },
                        "404": { "description": "Scénario non trouvé" }
                    }
                },
                "delete": {
                    "tags": ["TNR"],
                    "summary": "Supprimer un scénario",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Scénario supprimé" }
                    }
                }
            },
            "/api/tnr/recorder/start": {
                "post": {
                    "tags": ["TNR"],
                    "summary": "Démarrer l'enregistrement",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "name": { "type": "string" },
                                        "description": { "type": "string" },
                                        "tags": { "type": "array", "items": { "type": "string" } },
                                        "folder": { "type": "string" },
                                        "config": {
                                            "type": "object",
                                            "properties": {
                                                "url": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Enregistrement démarré" },
                        "409": { "description": "Enregistrement déjà en cours" }
                    }
                }
            },
            "/api/tnr/recorder/stop": {
                "post": {
                    "tags": ["TNR"],
                    "summary": "Arrêter l'enregistrement",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "id": { "type": "string" },
                                        "name": { "type": "string" },
                                        "description": { "type": "string" },
                                        "tags": { "type": "array", "items": { "type": "string" } },
                                        "folder": { "type": "string" },
                                        "baseline": { "type": "boolean" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Enregistrement arrêté et sauvegardé" },
                        "400": { "description": "Pas d'enregistrement en cours" }
                    }
                }
            },
            "/api/tnr/tap": {
                "post": {
                    "tags": ["TNR"],
                    "summary": "Enregistrer un événement UI",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "type": { "type": "string" },
                                        "action": { "type": "string" },
                                        "sessionId": { "type": "string" },
                                        "payload": { "type": "object" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Événement enregistré" }
                    }
                }
            },
            "/api/tnr/run/{id}": {
                "post": {
                    "tags": ["TNR"],
                    "summary": "Rejouer un scénario",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "url": { "type": "string", "description": "URL OCPP (override)" },
                                        "replaySessions": { "type": "array" },
                                        "compare": { "type": "object" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Replay démarré" },
                        "400": { "description": "Configuration invalide" },
                        "500": { "description": "Erreur de replay" }
                    }
                }
            },
            "/api/tnr/run/{id}/status": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "Statut d'exécution d'un scénario",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Statut de l'exécution" },
                        "404": { "description": "Exécution non trouvée" }
                    }
                }
            },
            "/api/tnr/urls/repair": {
                "post": {
                    "tags": ["TNR"],
                    "summary": "Réparer les URLs manquantes dans les scénarios",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["url"],
                                    "properties": {
                                        "url": { "type": "string", "description": "URL OCPP à appliquer" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "URLs réparées",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": { "type": "boolean" },
                                            "url": { "type": "string" },
                                            "fixed": { "type": "integer" },
                                            "total": { "type": "integer" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr/executions": {
                "get": {
                    "tags": ["TNR Executions"],
                    "summary": "Liste des exécutions",
                    "responses": {
                        "200": {
                            "description": "Liste des exécutions",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "executionId": { "type": "string" },
                                                "scenarioId": { "type": "string" },
                                                "timestamp": { "type": "string", "format": "date-time" },
                                                "passed": { "type": "boolean" },
                                                "metrics": { "type": "object" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr/executions/{id}": {
                "get": {
                    "tags": ["TNR Executions"],
                    "summary": "Détail d'une exécution",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Détail de l'exécution" },
                        "404": { "description": "Exécution non trouvée" }
                    }
                }
            },
            "/api/tnr/executions/{id}/logs": {
                "get": {
                    "tags": ["TNR Executions"],
                    "summary": "Logs d'une exécution",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": {
                            "description": "Logs de l'exécution",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "ts": { "type": "string" },
                                                "line": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr/folders": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "Liste des dossiers de scénarios",
                    "responses": {
                        "200": {
                            "description": "Liste des dossiers",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string" },
                                                "name": { "type": "string" },
                                                "count": { "type": "integer" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr/folders/{name}/list": {
                "get": {
                    "tags": ["TNR"],
                    "summary": "Scénarios d'un dossier",
                    "parameters": [
                        { "name": "name", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": { "description": "Liste des scénarios du dossier" }
                    }
                }
            },
            "/api/tnr/folder/{name}/run": {
                "post": {
                    "tags": ["TNR"],
                    "summary": "Lancer tous les scénarios d'un dossier",
                    "parameters": [
                        { "name": "name", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "url": { "type": "string" }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": { "description": "Scénarios lancés" },
                        "500": { "description": "Erreur de lancement" }
                    }
                }
            },
            "/api/tnr/analysis/domains": {
                "get": {
                    "tags": ["TNR Analysis"],
                    "summary": "Analyse par domaine OCPP",
                    "responses": {
                        "200": {
                            "description": "Statistiques par domaine",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "additionalProperties": {
                                            "type": "object",
                                            "properties": {
                                                "name": { "type": "string" },
                                                "actions": { "type": "array", "items": { "type": "string" } },
                                                "color": { "type": "string" },
                                                "scenarios": { "type": "integer" },
                                                "totalEvents": { "type": "integer" },
                                                "avgDuration": { "type": "integer" },
                                                "passRate": { "type": "integer" },
                                                "executions": { "type": "array" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/tnr/analysis/performance/{id}": {
                "get": {
                    "tags": ["TNR Analysis"],
                    "summary": "Analyse de performance d'un scénario",
                    "parameters": [
                        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                    ],
                    "responses": {
                        "200": {
                            "description": "Métriques de performance",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "scenario": {
                                                "type": "object",
                                                "properties": {
                                                    "id": { "type": "string" },
                                                    "name": { "type": "string" },
                                                    "originalDuration": { "type": "integer" },
                                                    "eventsCount": { "type": "integer" }
                                                }
                                            },
                                            "executions": { "type": "array" },
                                            "metrics": {
                                                "type": "object",
                                                "properties": {
                                                    "avgReplayDuration": { "type": "integer" },
                                                    "avgOverhead": { "type": "integer" },
                                                    "minDuration": { "type": "integer" },
                                                    "maxDuration": { "type": "integer" },
                                                    "passRate": { "type": "integer" },
                                                    "performanceTrend": { "type": "array" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "404": { "description": "Scénario non trouvé" }
                    }
                }
            },
            "/api/perf/csv-template": {
                "get": {
                    "tags": ["Performance"],
                    "summary": "Obtenir un template CSV d'exemple",
                    "responses": {
                        "200": {
                            "description": "Template CSV",
                            "content": {
                                "text/plain": {
                                    "schema": {
                                        "type": "string",
                                        "example": "cpId,idTag\ncp0001,TAG-0001\ncp0002,TAG-0002"
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/perf/import": {
                "post": {
                    "tags": ["Performance"],
                    "summary": "Importer un fichier CSV de paires cpId/idTag",
                    "requestBody": {
                        "content": {
                            "multipart/form-data": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "file": {
                                            "type": "string",
                                            "format": "binary",
                                            "description": "Fichier CSV avec colonnes cpId,idTag"
                                        }
                                    }
                                }
                            },
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "csv": {
                                            "type": "string",
                                            "description": "Contenu CSV en texte"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "CSV importé",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": { "type": "boolean" },
                                            "count": { "type": "integer" },
                                            "source": { "type": "string", "enum": ["file", "json"] }
                                        }
                                    }
                                }
                            }
                        },
                        "400": { "description": "Format CSV invalide" }
                    }
                }
            },
            "/api/perf/start": {
                "post": {
                    "tags": ["Performance"],
                    "summary": "Démarrer un test de charge",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["url"],
                                    "properties": {
                                        "url": { "type": "string", "description": "URL OCPP WebSocket" },
                                        "sessions": { "type": "integer", "description": "Nombre de sessions (requis si useCsv=true)" },
                                        "concurrent": { "type": "integer", "default": 1, "description": "Sessions concurrentes" },
                                        "rampMs": { "type": "integer", "default": 250, "description": "Délai entre sessions (ms)" },
                                        "holdSec": { "type": "integer", "default": 0, "description": "Durée de charge (sec)" },
                                        "mvEverySec": { "type": "integer", "default": 0, "description": "Période MeterValues (sec)" },
                                        "powerKW": { "type": "number", "default": 7.4, "description": "Puissance (kW)" },
                                        "voltageV": { "type": "integer", "default": 230, "description": "Tension (V)" },
                                        "useCsv": { "type": "boolean", "default": false, "description": "Utiliser CSV importé" },
                                        "noAuth": { "type": "boolean", "default": false, "description": "Passer Authorize" },
                                        "noStart": { "type": "boolean", "default": false, "description": "Passer StartTransaction" },
                                        "noStop": { "type": "boolean", "default": false, "description": "Passer StopTransaction" },
                                        "csvText": { "type": "string", "description": "Contenu CSV direct (alternative à import)" }
                                    }
                                }
                            },
                            "multipart/form-data": {
                                "schema": {
                                    "type": "object",
                                    "required": ["url"],
                                    "properties": {
                                        "url": { "type": "string" },
                                        "sessions": { "type": "integer" },
                                        "concurrent": { "type": "integer" },
                                        "rampMs": { "type": "integer" },
                                        "holdSec": { "type": "integer" },
                                        "mvEverySec": { "type": "integer" },
                                        "powerKW": { "type": "number" },
                                        "voltageV": { "type": "integer" },
                                        "useCsv": { "type": "boolean" },
                                        "noAuth": { "type": "boolean" },
                                        "noStart": { "type": "boolean" },
                                        "noStop": { "type": "boolean" },
                                        "file": {
                                            "type": "string",
                                            "format": "binary",
                                            "description": "Fichier CSV direct"
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Test démarré",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": { "type": "boolean" },
                                            "runId": { "type": "string" }
                                        }
                                    }
                                }
                            }
                        },
                        "400": { "description": "Configuration invalide" },
                        "409": { "description": "Test déjà en cours" }
                    }
                }
            },
            "/api/perf/stop": {
                "post": {
                    "tags": ["Performance"],
                    "summary": "Arrêter le test de charge en cours",
                    "responses": {
                        "200": {
                            "description": "Test arrêté",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "ok": { "type": "boolean" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/perf/status": {
                "get": {
                    "tags": ["Performance"],
                    "summary": "Statut détaillé du test en cours",
                    "responses": {
                        "200": {
                            "description": "État complet du test",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "run": {
                                                "type": "object",
                                                "properties": {
                                                    "status": { "type": "string", "enum": ["IDLE", "RUNNING"] },
                                                    "runId": { "type": "string" }
                                                }
                                            },
                                            "stats": {
                                                "type": "object",
                                                "properties": {
                                                    "total": { "type": "integer", "description": "Total sessions lancées" },
                                                    "active": { "type": "integer", "description": "Sessions actives" },
                                                    "finished": { "type": "integer", "description": "Sessions terminées" },
                                                    "errors": { "type": "integer", "description": "Sessions en erreur" },
                                                    "msgs": { "type": "integer", "description": "Messages OCPP envoyés" },
                                                    "avgLatencyMs": { "type": "integer", "description": "Latence moyenne (ms)" },
                                                    "cpu": { "type": "integer", "description": "CPU usage %" },
                                                    "mem": { "type": "number", "description": "RAM usage (MB)" }
                                                }
                                            },
                                            "pool": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "cpId": { "type": "string" },
                                                        "idTag": { "type": "string" },
                                                        "status": { "type": "string" },
                                                        "txId": { "type": "integer" },
                                                        "lastError": { "type": "string" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/export": {
                "get": {
                    "tags": ["Performance"],
                    "summary": "Exporter les résultats du dernier test",
                    "responses": {
                        "200": {
                            "description": "Export JSON complet",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "runId": { "type": "string" },
                                            "config": {
                                                "type": "object",
                                                "properties": {
                                                    "url": { "type": "string" },
                                                    "sessions": { "type": "integer" },
                                                    "concurrent": { "type": "integer" },
                                                    "holdSec": { "type": "integer" },
                                                    "rampMs": { "type": "integer" },
                                                    "mvEverySec": { "type": "integer" },
                                                    "powerKW": { "type": "number" },
                                                    "voltageV": { "type": "integer" },
                                                    "noAuth": { "type": "boolean" },
                                                    "noStart": { "type": "boolean" },
                                                    "noStop": { "type": "boolean" },
                                                    "useCsv": { "type": "boolean" }
                                                }
                                            },
                                            "results": {
                                                "type": "object",
                                                "properties": {
                                                    "total": { "type": "integer" },
                                                    "finished": { "type": "integer" },
                                                    "errors": { "type": "integer" },
                                                    "avgLatencyMs": { "type": "integer" },
                                                    "totalMessages": { "type": "integer" },
                                                    "cpu": { "type": "integer" },
                                                    "memMB": { "type": "number" }
                                                }
                                            },
                                            "timestamp": { "type": "string", "format": "date-time" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/metrics": {
                "get": {
                    "tags": ["Performance"],
                    "summary": "Métriques détaillées du pool de sessions",
                    "responses": {
                        "200": {
                            "description": "Métriques agrégées",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "avgBootTime": { "type": "integer", "description": "Temps moyen BootNotification (ms)" },
                                            "avgAuthTime": { "type": "integer", "description": "Temps moyen Authorize (ms)" },
                                            "avgStartTime": { "type": "integer", "description": "Temps moyen StartTransaction (ms)" },
                                            "avgStopTime": { "type": "integer", "description": "Temps moyen StopTransaction (ms)" },
                                            "totalBytes": { "type": "integer", "description": "Total bytes échangés" },
                                            "totalMessages": { "type": "integer", "description": "Total messages OCPP" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/last-errors": {
                "get": {
                    "tags": ["Performance"],
                    "summary": "Liste des dernières erreurs (max 200)",
                    "responses": {
                        "200": {
                            "description": "Liste des erreurs",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "cpId": { "type": "string" },
                                                "error": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "components": {
            "schemas": {
                "Error": {
                    "type": "object",
                    "properties": {
                        "error": { "type": "string" }
                    }
                }
            }
        }
    });
});

/* ========================================================================== */
/* Server Startup                                                             */
/* ========================================================================== */

app.listen(PORT, () => {
    log(`Runner HTTP prêt sur http://localhost:${PORT}`);
    log(`Docs Swagger: /api/docs  (JSON: /api/swagger.json)`);
    log(`TNR endpoints disponibles sur /api/tnr/*`);
    log(`Simu endpoints disponibles sur /api/simu/*`);
    log(`Perf endpoints disponibles sur /api/perf/*`);
    if (!_cpuTimer) {
        _cpuTimer = setInterval(() => {
            const load = os.loadavg?.()[0] || 0;
            STATS.cpu = Math.round(Math.min(100, (load / Math.max(1, os.cpus().length)) * 100));
            STATS.mem = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;

            const startSamples = POOL.map((c) => c.metrics.startTime).filter((x) => x > 0);
            if (startSamples.length) pushLatencySample(startSamples.reduce((a, b) => a + b, 0) / startSamples.length);
        }, 1000);
    }
});

process.on("uncaughtException", (err) => log(`uncaughtException: ${err?.stack || err}`));
process.on("unhandledRejection", (err) => log(`unhandledRejection: ${err?.stack || err}`));