// frontend/src/components/TnrComparePanel.tsx
import React, { useEffect, useMemo, useState } from "react";

/* ===================== API BASE alignée avec le projet ===================== */
const API_BASE =
    (typeof window !== "undefined" &&
        (window.localStorage.getItem("runner_api") || "")) ||
    "http://localhost:8877";

/** Types minimales (compatibles avec vos payloads backend) */
type TNREvent = {
    timestamp?: number;
    sessionId?: string;
    type?: string;
    action?: string;
    payload?: any;
};

type SCPMessage = { timestamp?: number; sessionId?: string; data: any };
type TXPMessage = { timestamp?: number; sessionId?: string; data: any };
type TXDPMessage = { timestamp?: number; sessionId?: string; data: any };

type TNRScenario = {
    id: string;
    name?: string;
    description?: string;
    createdAt?: string;
    sessions?: any[];
    events?: TNREvent[];

    // si votre backend renvoie ces tableaux, on les utilisera en priorité
    scpMessages?: SCPMessage[];
    txpMessages?: TXPMessage[];
    txdpMessages?: TXDPMessage[];
};

type ScenarioMeta = { id: string; name?: string; createdAt?: string };

/** HTTP helper sans dépendances */
async function http<T>(path: string, init?: RequestInit): Promise<T> {
    const url = API_BASE + "/api/tnr" + path;
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const ct = res.headers.get("content-type") || "";
    return (ct.includes("application/json") ? res.json() : (undefined as any)) as T;
}

/** Normalisation: supprime champs volatils, tri des clés */
function normalize(value: any): any {
    const IGNORED = new Set(["timestamp", "messageId", "id", "transactionId"]);
    const seen = new WeakSet();
    const walk = (v: any): any => {
        if (v && typeof v === "object") {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
            if (Array.isArray(v)) return v.map(walk);
            const out: any = {};
            Object.keys(v)
                .filter((k) => !IGNORED.has(k))
                .sort()
                .forEach((k) => (out[k] = walk(v[k])));
            return out;
        }
        return v;
    };
    return walk(value);
}

/** Hash simple */
function simpleHash(obj: any): string {
    const json = JSON.stringify(normalize(obj));
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
        const c = json.charCodeAt(i);
        hash = ((hash << 5) - hash) + c;
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
}

type Diff = { index: number; field: string; expected: any; actual: any };
type Comp = {
    match: boolean;
    expectedCount: number;
    actualCount: number;
    expectedSignature: string;
    actualSignature: string;
    differences: Diff[];
};

function deepCompare(expected: any, actual: any, path = ""): Diff[] {
    const diffs: Diff[] = [];
    const isObj = (v: any) => v && typeof v === "object";
    if (!isObj(expected) || !isObj(actual)) {
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            diffs.push({ index: 0, field: path || "value", expected, actual });
        }
        return diffs;
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
        const np = path ? `${path}.${k}` : k;
        if (!(k in expected)) diffs.push({ index: 0, field: np, expected: undefined, actual: (actual as any)[k] });
        else if (!(k in actual)) diffs.push({ index: 0, field: np, expected: (expected as any)[k], actual: undefined });
        else diffs.push(...deepCompare((expected as any)[k], (actual as any)[k], np));
    }
    return diffs;
}

function compareArrays(exp: any[], act: any[]): Comp {
    const expected = exp.map(normalize);
    const actual = act.map(normalize);
    const differences: Diff[] = [];
    if (expected.length !== actual.length) {
        differences.push({ index: -1, field: "count", expected: expected.length, actual: actual.length });
    }
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if (!expected[i] || !actual[i]) continue;
        const d = deepCompare(expected[i], actual[i]).map((x) => ({ ...x, index: i }));
        differences.push(...d);
    }
    return {
        match: differences.length === 0,
        expectedCount: expected.length,
        actualCount: actual.length,
        expectedSignature: simpleHash(expected),
        actualSignature: simpleHash(actual),
        differences,
    };
}

/** Récupère SCP/TXP/TXDP d’un scénario */
function extractBuckets(s: TNRScenario) {
    if (s.scpMessages || s.txpMessages || s.txdpMessages) {
        return {
            scp: (s.scpMessages ?? []).map((m) => m.data ?? m),
            txp: (s.txpMessages ?? []).map((m) => m.data ?? m),
            txdp: (s.txdpMessages ?? []).map((m) => m.data ?? m),
        };
    }
    const events = s.events ?? [];
    const scp = events.filter((e) => e.action === "SetChargingProfile").map((e) => e.payload);
    const txp = events.filter((e) => e.action === "MeterValues").map((e) => e.payload);
    const txdp = events.filter((e) => e.action === "StopTransaction").map((e) => e.payload);
    return { scp, txp, txdp };
}

export default function TnrComparePanel() {
    const [list, setList] = useState<ScenarioMeta[]>([]);
    const [aId, setAId] = useState<string>("");
    const [bId, setBId] = useState<string>("");
    const [a, setA] = useState<TNRScenario | null>(null);
    const [b, setB] = useState<TNRScenario | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await http<TNRScenario[]>("/scenarios");
                setList(data.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt })));
            } catch (e: any) {
                setError(e.message || String(e));
            }
        })();
    }, []);

    async function loadScenario(id: string): Promise<TNRScenario | null> {
        if (!id) return null;
        return await http<TNRScenario>(`/scenarios/${id}`);
    }

    async function onCompare() {
        setError(null);
        setLoading(true);
        try {
            const [sa, sb] = await Promise.all([loadScenario(aId), loadScenario(bId)]);
            setA(sa); setB(sb);
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setLoading(false);
        }
    }

    const result = useMemo(() => {
        if (!a || !b) return null;
        const A = extractBuckets(a);
        const B = extractBuckets(b);
        return {
            scp: compareArrays(A.scp, B.scp),
            txp: compareArrays(A.txp, B.txp),
            txdp: compareArrays(A.txdp, B.txdp),
        };
    }, [a, b]);

    return (
        <div style={{ display: "grid", gap: 12 }}>
            <h3>Comparer deux scénarios (SCP / TXP / TXDP)</h3>
            {error && <div style={{ color: "crimson" }}>Erreur: {error}</div>}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select value={aId} onChange={(e) => setAId(e.target.value)}>
                    <option value="">Scénario A…</option>
                    {list.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.name || s.id}
                        </option>
                    ))}
                </select>
                <span>vs</span>
                <select value={bId} onChange={(e) => setBId(e.target.value)}>
                    <option value="">Scénario B…</option>
                    {list.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.name || s.id}
                        </option>
                    ))}
                </select>
                <button disabled={!aId || !bId || loading} onClick={onCompare}>
                    {loading ? "Comparaison…" : "Comparer"}
                </button>
            </div>

            {result && (
                <div style={{ display: "grid", gap: 8 }}>
                    <Section title="SCP" comp={result.scp} />
                    <Section title="TXP" comp={result.txp} />
                    <Section title="TXDP" comp={result.txdp} />
                </div>
            )}
        </div>
    );
}

function Section({ title, comp }: { title: string; comp: Comp }) {
    return (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{title}</strong>
                <span style={{ color: comp.match ? ("green" as any) : ("crimson" as any) }}>
          {comp.match ? "OK (identiques)" : "DIFF (écarts détectés)"}
        </span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                {comp.expectedCount} vs {comp.actualCount} — sig: {comp.expectedSignature} / {comp.actualSignature}
            </div>
            {!comp.match && (
                <details style={{ marginTop: 8 }}>
                    <summary>Voir les différences ({comp.differences.length})</summary>
                    <ul style={{ marginTop: 8 }}>
                        {comp.differences.slice(0, 200).map((d, i) => (
                            <li key={i}>
                                [#{d.index}] <code>{d.field}</code> — attendu: <code>{JSON.stringify(d.expected)}</code> vs actuel:{" "}
                                <code>{JSON.stringify(d.actual)}</code>
                            </li>
                        ))}
                    </ul>
                    {comp.differences.length > 200 && <em>…{comp.differences.length - 200} autres</em>}
                </details>
            )}
        </div>
    );
}
