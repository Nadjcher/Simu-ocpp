// API client pour parler au runner (Swagger)
export const RUNNER = import.meta.env.VITE_RUNNER_URL ?? "http://localhost:8877";

/** Helper JSON tolérant (pas de crash si body vide) */
async function http<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${RUNNER}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${txt}`);
    try {
        return (txt ? JSON.parse(txt) : undefined) as T;
    } catch {
        // réponse non-JSON ou vide => renvoie undefined
        return undefined as unknown as T;
    }
}

/* ---------- Types utiles ---------- */
export type SessionItem = {
    id: string;
    cpId: string;
    url: string;
    status: string;
    txId?: number | null;
    lastError?: string | null;
    physicalMaxW?: number;
    appliedLimitW?: number;
    txpLimitW?: number | null;
    txdpLimitW?: number | null;
    txpDurationSec?: number | null;
    lastScp?: string | null;
    mvEverySec?: number | null;
};

export type PagedSessions = {
    sessions: SessionItem[];
    total: number;
    hasMore: boolean;
    nextOffset: number;
};

export type LogEntry = { ts: string; line: string };

/* =======================================================================
   EVSE Simu
   ======================================================================= */
export const simu = {
    /**
     * Récupère la **liste** sous forme **de tableau** (compat rétro).
     * Si le backend supporte la pagination, on agrège la première page
     * ou l’ancien format en tableau unique.
     */
    list: async (opts?: { includeClosed?: boolean; limit?: number }) => {
        const q: string[] = [];
        // on demande pagination si dispo (mais on renverra un tableau plat)
        q.push("paged=1");
        if (opts?.limit) q.push(`limit=${opts.limit}`);
        if (opts?.includeClosed) q.push("includeClosed=1");

        const resp = await http<any>(`/api/simu${q.length ? "?" + q.join("&") : ""}`);
        if (Array.isArray(resp)) return resp as SessionItem[]; // ancien format
        return (resp?.sessions ?? []) as SessionItem[];        // nouveau format
    },

    /**
     * Récupère **une page** (brut, paginé).
     */
    listPage: async (opts?: {
        includeClosed?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<PagedSessions> => {
        const q: string[] = ["paged=1"];
        if (opts?.limit) q.push(`limit=${opts.limit}`);
        if (opts?.offset) q.push(`offset=${opts.offset}`);
        if (opts?.includeClosed) q.push("includeClosed=1");
        const resp = await http<any>(`/api/simu?${q.join("&")}`);
        // si le backend ancien renvoie un tableau, on l’emballe en page unique
        if (Array.isArray(resp)) {
            return {
                sessions: resp as SessionItem[],
                total: (resp as SessionItem[]).length,
                hasMore: false,
                nextOffset: (resp as SessionItem[]).length,
            };
        }
        return resp as PagedSessions;
    },

    /**
     * Récupère **toutes** les sessions (boucle pagination).
     */
    listAll: async (opts?: {
        includeClosed?: boolean;
        pageSize?: number;
    }): Promise<SessionItem[]> => {
        const all: SessionItem[] = [];
        let offset = 0;
        const limit = Math.max(1, Math.min(500, opts?.pageSize ?? 200));
        // on boucle jusqu'à hasMore = false
        /* eslint-disable no-constant-condition */
        while (true) {
            const page = await simu.listPage({
                includeClosed: !!opts?.includeClosed,
                limit,
                offset,
            });
            all.push(...(page.sessions || []));
            if (!page.hasMore) break;
            offset = page.nextOffset ?? (offset + (page.sessions?.length || 0));
        }
        return all;
    },

    create: async (body: any) => {
        const resp = await http<any>("/api/simu/session", {
            method: "POST",
            body: JSON.stringify(body),
        });
        // Compat : si le backend renvoie la session {id,...}, on transforme
        if (resp && typeof resp === "object" && resp.id && resp.ok === undefined) {
            return { ok: true, id: resp.id as string, auto: !!resp.auto } as {
                ok: boolean; id: string; auto: boolean;
            };
        }
        return resp as { ok: boolean; id: string; auto: boolean };
    },

    remove: (id: string) => http("/api/simu/" + id, { method: "DELETE" }),

    authorize: (id: string, idTag?: string) =>
        http("/api/simu/" + id + "/authorize", {
            method: "POST",
            body: JSON.stringify({ idTag }),
        }),

    startTx: (id: string, body?: any) =>
        http("/api/simu/" + id + "/startTx", {
            method: "POST",
            body: JSON.stringify(body || {}),
        }),

    stopTx: (id: string, body?: any) =>
        http("/api/simu/" + id + "/stopTx", {
            method: "POST",
            body: JSON.stringify(body || {}),
        }),

    mvStart: (id: string, sec: number) =>
        http("/api/simu/" + id + "/mv/start", {
            method: "POST",
            body: JSON.stringify({ periodSec: sec }),
        }),

    mvStop: (id: string) => http("/api/simu/" + id + "/mv/stop", { method: "POST" }),

    logs: (id: string) => http<LogEntry[]>(`/api/simu/${id}/logs`),

    ocpp: (id: string, action: string, payload?: any) =>
        http("/api/simu/" + id + "/ocpp", {
            method: "POST",
            body: JSON.stringify({ action, payload }),
        }),
};

/* ---------- Perf ---------- */
export const perf = {
    csvTemplate: () => fetch(`${RUNNER}/api/perf/csv-template`).then((r) => r.text()),
    importCsv: (csv: string) =>
        http<{ ok: boolean; count: number }>("/api/perf/import", {
            method: "POST",
            body: JSON.stringify({ csv }),
        }),
    start: (body: any) =>
        http<{ ok: boolean; runId: string }>("/api/perf/start", {
            method: "POST",
            body: JSON.stringify(body),
        }),
    status: () => http("/api/perf/status"),
    stop: () => http("/api/perf/stop", { method: "POST" }),
};

/* ---------- TNR ---------- */
export const tnr = {
    list: () => http<any[]>("/api/tnr"),
    get: (id: string) => http<any>("/api/tnr/" + id),
    record: (scenario: any) =>
        http<{ ok: boolean; id: string }>("/api/tnr/record", {
            method: "POST",
            body: JSON.stringify(scenario),
        }),
    del: (id: string) => http("/api/tnr/" + id, { method: "DELETE" }),
    replay: (id: string) =>
        http<{ ok: boolean; resultId: string }>("/api/tnr/replay/" + id, { method: "POST" }),
    result: (id: string) => http("/api/tnr/result/" + id),
    results: () => http<any[]>("/api/tnr/results"),
};
