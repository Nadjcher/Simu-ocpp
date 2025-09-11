// frontend/src/services/api.ts
// Client minimal pour parler au runner HTTP (port 8877 par défaut)

type Json = Record<string, any>;

/**
 * Stratégie:
 * - Si VITE_PERF_API ou localStorage("perfApi") est défini → on l'utilise tel quel (origin absolu).
 * - Sinon en DEV (Vite) → base vide + on PRÉFIXE automatiquement toutes les routes non /api avec /api
 *   pour profiter du proxy Vite.
 * - Sinon (build/prod/preview) → on tape directement le runner sur hostname:8877 (comportement historique).
 */
const OVERRIDE_ORIGIN =
    (import.meta as any).env?.VITE_PERF_API?.replace(/\/$/, "") ||
    window.localStorage.getItem("perfApi")?.replace(/\/$/, "") ||
    "";

const IS_DEV = Boolean((import.meta as any).env?.DEV);
const USE_PROXY = !OVERRIDE_ORIGIN && IS_DEV;

// Origin utilisée par fetch. Chaîne vide = même origine (Vite servira et proxifiera).
export const API_BASE =
    OVERRIDE_ORIGIN || (IS_DEV ? "" : `${location.protocol}//${location.hostname}:8877`);

// En mode proxy, on s’assure que *tous* les chemins passent par /api
function withBase(path: string) {
    if (USE_PROXY) {
        return path.startsWith("/api") ? path : `/api${path}`;
    }
    return path;
}

async function http<T = any>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: any,
    asText = false
): Promise<T> {
    const url = `${API_BASE}${withBase(path)}`;
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined;

    if (body instanceof FormData) {
        payload = body; // multipart
    } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text(); // on lit une fois

    if (!res.ok) {
        // essaie d’extraire un message JSON sinon renvoie le texte
        try {
            const j = JSON.parse(text);
            throw new Error(j?.error || res.statusText);
        } catch {
            throw new Error(text || res.statusText);
        }
    }

    if (asText) return text as unknown as T;
    if (!text) return {} as T;

    try {
        return JSON.parse(text) as T;
    } catch {
        // pas du JSON => renvoie brut
        return text as unknown as T;
    }
}

/* ============================= PERF (runner) ============================= */
export const perf = {
    status: () => http("GET", "/api/perf/status") as Promise<Json>,
    run: () => http("GET", "/api/perf/run") as Promise<Json>,
    start: (cfg: Json) => http("POST", "/api/perf/start", cfg) as Promise<Json>,
    stop: () => http("POST", "/api/perf/stop", {}) as Promise<Json>,
    importCsv: (csvText: string) =>
        http("POST", "/api/perf/import", { csv: csvText }) as Promise<Json>,
    csvTemplate: () =>
        http<string>("GET", "/api/perf/csv-template", undefined, true),
    stats: () => http("GET", "/stats") as Promise<Json>,
    metrics: () => http("GET", "/api/metrics") as Promise<Json>,
    logs: () => http<string>("GET", "/logs", undefined, true),
};

/* =============================== TNR ==================================== */
export const tnr = {
    list: () => http<any[]>("/api/tnr"),
    get: (id: string) => http<any>("/api/tnr/" + id),
    record: (scenario: any) =>
        http<{ ok: boolean; id: string }>("/api/tnr/record", {
            method: "POST",
            body: JSON.stringify(scenario),
        }),
    del: (id: string) => http("/api/tnr/" + id, { method: "DELETE" }),
    remove: (id: string) => http("/api/tnr/" + id, { method: "DELETE" }), // alias pour compatibilité
    replay: (id: string) =>
        http<{ ok: boolean; resultId: string }>("/api/tnr/replay/" + id, { method: "POST" }),
    result: (id: string) => http("/api/tnr/result/" + id),
    results: () => http<any[]>("/api/tnr/results"),

    // Recorder
    recorderStart: (name?: string) =>
        http("/api/tnr/recorder/start", {
            method: "POST",
            body: name ? JSON.stringify({ name }) : "{}",
        }),
    recorderStop: (id?: string) =>
        http("/api/tnr/recorder/stop", {
            method: "POST",
            body: id ? JSON.stringify({ id }) : "{}",
        }),
    cancelRecording: () =>
        http("/api/tnr/recorder/cancel", { method: "POST" }),

    // Méthodes additionnelles pour TNRPanel
    executions: () => http<any[]>("/api/tnr/executions"),
    scenarios: () => http<any[]>("/api/tnr/scenarios"),
    exportScenario: (id: string) => http<any>("/api/tnr/" + id),
    importScenario: (formData: FormData) =>
        fetch(`${RUNNER}/api/tnr/import`, {
            method: "POST",
            body: formData,
        }).then(res => {
            if (!res.ok) throw new Error(`Import failed: ${res.status}`);
            return res.json();
        }),
};

/* ============================== SIMU (Node) ============================= */
export const simu = {
    list: () => http<Json[]>("GET", "/api/simu"),
    create: (p: {
        url: string;
        cpId: string;
        idTag?: string;
        auto?: boolean;
        holdSec?: number;
        mvEverySec?: number;
    }) => http("POST", "/api/simu/session", p),
    del: (id: string) =>
        http("DELETE", `/api/simu/${encodeURIComponent(id)}`),

    authorize: (id: string, idTag?: string) =>
        http("POST", `/api/simu/${encodeURIComponent(id)}/authorize`, {
            idTag,
        }),
    startTx: (id: string) =>
        http("POST", `/api/simu/${encodeURIComponent(id)}/startTx`, {}),
    stopTx: (id: string) =>
        http("POST", `/api/simu/${encodeURIComponent(id)}/stopTx`, {}),
    mvStart: (id: string, periodSec: number) =>
        http("POST", `/api/simu/${encodeURIComponent(id)}/mv/start`, {
            periodSec,
        }),
    mvStop: (id: string) =>
        http("POST", `/api/simu/${encodeURIComponent(id)}/mv/stop`, {}),
    ocpp: (id: string, action: string, payload: Json = {}) =>
        http("POST", `/api/simu/${encodeURIComponent(id)}/ocpp`, {
            action,
            payload,
        }),
};

/* ================================ UI ==================================== */
export let ui = {
    pushSessions: (rows: Array<{
        cpId: string;
        idTag?: string;
        status?: string;
        txId?: number | null;
        lastError?: string | null;
    }>) => http("POST", "/api/ui/sessions", { list: rows }),
    getSessionsMirror: () => http("GET", "/api/ui/sessions") as Promise<Json[]>,
    mergedSessions: () => http("GET", "/api/sessions") as Promise<Json[]>,
};
