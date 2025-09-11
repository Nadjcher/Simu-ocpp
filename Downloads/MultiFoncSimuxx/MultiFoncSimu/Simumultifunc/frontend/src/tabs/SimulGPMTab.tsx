import React, { useEffect, useMemo, useState } from "react";

/** Même convention que les autres onglets : on peut surcharger via localStorage("runner_api") */
const API_BASE =
    (typeof window !== "undefined" && (window.localStorage.getItem("runner_api") || "")) ||
    (import.meta as any).env?.VITE_RUNNER_URL ||
    "http://localhost:8877";

type TnrScenario = {
    id: string;
    name?: string;
    createdAt?: string;
    config?: { url?: string };
    sessions?: { id: string; cpId: string; idTag?: string }[];
    expected?: { serverCallsSignature?: string | null };
};

type TnrResultSummary = {
    ok: boolean;
    runId: string;
    scenarioId: string;
    summary: { sessions: number; serverCallsCount: number; outboundCount: number };
    signature: string;
    compare: { hasBaseline: boolean; expected: string | null; actual: string; pass: boolean | null };
};

type TnrResult = TnrResultSummary & {
    serverCalls: Array<{ t: number; sessionId: string; action: string; payload: any }>;
    outboundCalls: Array<{ t: number; sessionId: string; action: string; payload: any }>;
};

async function fetchJSON<T = any>(url: string, init?: RequestInit): Promise<T> {
    const r = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...(init || {}),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    try {
        return (await r.json()) as T;
    } catch {
        // certaines routes peuvent renvoyer vide
        return {} as T;
    }
}

function prettyDate(iso?: string) {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        return d.toLocaleString();
    } catch {
        return iso;
    }
}

function useEndpointExists(path: string) {
    const [exists, setExists] = useState<boolean | null>(null);
    useEffect(() => {
        let stop = false;
        (async () => {
            try {
                await fetchJSON(`${API_BASE}${path}`);
                if (!stop) setExists(true);
            } catch (e: any) {
                if (!stop) setExists(e?.message !== "404"); // 404 => n’existe pas
            }
        })();
        return () => {
            stop = true;
        };
    }, [path]);
    return exists;
}

export default function TnrTab() {
    const endpointTnrExists = useEndpointExists("/api/tnr");

    const [list, setList] = useState<string[]>([]);
    const [resultsIds, setResultsIds] = useState<string[]>([]);
    const [filter, setFilter] = useState("");
    const [loading, setLoading] = useState(false);

    const [selScenario, setSelScenario] = useState<TnrScenario | null>(null);
    const [selResult, setSelResult] = useState<TnrResult | null>(null);

    const [recName, setRecName] = useState<string>("record-" + Date.now());

    // Compare tool
    const [cmpA, setCmpA] = useState("");
    const [cmpB, setCmpB] = useState("");
    const [cmpStatus, setCmpStatus] = useState<string>("");

    async function refreshAll() {
        try {
            const l = await fetchJSON<string[]>(`${API_BASE}/api/tnr`);
            setList(Array.isArray(l) ? l : []);
        } catch {
            setList([]);
        }
        try {
            const r = await fetchJSON<string[]>(`${API_BASE}/api/tnr/results`);
            setResultsIds(Array.isArray(r) ? r : []);
        } catch {
            setResultsIds([]);
        }
    }

    useEffect(() => {
        if (endpointTnrExists === false) return;
        refreshAll();
        const t = setInterval(refreshAll, 2500);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpointTnrExists]);

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return list;
        return list.filter((id) => id.toLowerCase().includes(q));
    }, [list, filter]);

    async function openScenario(id: string) {
        setSelResult(null);
        try {
            const sc = await fetchJSON<TnrScenario>(`${API_BASE}/api/tnr/${id}`);
            setSelScenario(sc);
        } catch (e) {
            setSelScenario(null);
        }
    }

    async function openResult(id: string) {
        setSelScenario(null);
        try {
            const rs = await fetchJSON<TnrResult>(`${API_BASE}/api/tnr/result/${id}`);
            setSelResult(rs);
        } catch (e) {
            setSelResult(null);
        }
    }

    async function replayScenario(id: string) {
        setLoading(true);
        try {
            const r = await fetchJSON<{ ok: boolean; resultId: string; compare: TnrResultSummary["compare"]; signature: string }>(
                `${API_BASE}/api/tnr/replay/${id}`,
                { method: "POST" }
            );
            // ouvre immédiatement le résultat
            await openResult(r.resultId);
            await refreshAll();
        } catch (e: any) {
            alert(`Erreur replay: ${e?.message || e}`);
        } finally {
            setLoading(false);
        }
    }

    async function deleteScenario(id: string) {
        if (!confirm(`Supprimer le scénario "${id}" ?`)) return;
        try {
            await fetchJSON(`${API_BASE}/api/tnr/${id}`, { method: "DELETE" });
            setSelScenario(null);
            await refreshAll();
        } catch (e: any) {
            alert(`Erreur delete: ${e?.message || e}`);
        }
    }

    async function startRecorder() {
        try {
            await fetchJSON(`${API_BASE}/api/tnr/recorder/start`, {
                method: "POST",
                body: JSON.stringify({ name: recName }),
            });
            alert("Recorder démarré. Lance tes actions dans l’onglet EVSE, puis Stop ici.");
        } catch (e: any) {
            alert(`Erreur start recorder: ${e?.message || e}`);
        }
    }

    async function stopRecorderAndSave() {
        try {
            const id = `tnr_${Date.now()}`;
            const r = await fetchJSON<{ ok: true; id: string }>(`${API_BASE}/api/tnr/recorder/stop`, {
                method: "POST",
                body: JSON.stringify({ id }),
            });
            setRecName("record-" + Date.now());
            await refreshAll();
            await openScenario(r.id);
        } catch (e: any) {
            alert(`Erreur stop recorder: ${e?.message || e}`);
        }
    }

    async function compareTwo() {
        setCmpStatus("En cours…");
        try {
            if (!cmpA || !cmpB) {
                setCmpStatus("Choisis deux IDs de scénario.");
                return;
            }
            // On rejoue A puis B (stateless côté runner), et on compare les signatures
            const rA = await fetchJSON<{ resultId: string; signature: string }>(`${API_BASE}/api/tnr/replay/${cmpA}`, {
                method: "POST",
            });
            const rB = await fetchJSON<{ resultId: string; signature: string }>(`${API_BASE}/api/tnr/replay/${cmpB}`, {
                method: "POST",
            });

            const resA = await fetchJSON<TnrResult>(`${API_BASE}/api/tnr/result/${rA.resultId}`);
            const resB = await fetchJSON<TnrResult>(`${API_BASE}/api/tnr/result/${rB.resultId}`);

            const same = resA.signature === resB.signature;
            setCmpStatus(
                same
                    ? `OK — signatures identiques (${resA.signature.slice(0, 10)}…)`
                    : `DIFF — ${resA.signature.slice(0, 10)}… vs ${resB.signature.slice(0, 10)}…`
            );
            await refreshAll();
        } catch (e: any) {
            setCmpStatus(`Erreur: ${e?.message || e}`);
        }
    }

    const canUse = endpointTnrExists !== false;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">TNR EVSE</div>
                <div className="flex gap-2 items-center">
                    <input
                        className="border rounded px-2 py-1"
                        placeholder="Recherche scénario…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                    <button className="px-3 py-2 rounded border" onClick={refreshAll}>
                        Rafraîchir
                    </button>
                </div>
            </div>

            {!canUse && (
                <div className="rounded border bg-rose-50 text-rose-800 p-3">
                    Endpoint <code>/api/tnr</code> absent (404). Assure-toi que le runner est démarré avec le fichier
                    <code> runner-http-api.js</code> qui expose les routes TNR.
                </div>
            )}

            {/* RECORDER */}
            {canUse && (
                <div className="rounded border bg-white p-4">
                    <div className="font-semibold mb-2">Recorder</div>
                    <div className="flex gap-2 items-center">
                        <input
                            className="border rounded px-2 py-1 min-w-[280px]"
                            value={recName}
                            onChange={(e) => setRecName(e.target.value)}
                            placeholder="Nom d’enregistrement"
                        />
                        <button className="px-3 py-2 rounded bg-sky-600 text-white hover:bg-sky-500" onClick={startRecorder}>
                            Start
                        </button>
                        <button className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500" onClick={stopRecorderAndSave}>
                            Stop & Save
                        </button>
                    </div>
                    <div className="text-xs opacity-70 mt-2">
                        Démarre le recorder, fais tes actions dans <b>Simu EVSE</b> (connexion, Auth, Start/Stop, MV…), puis
                        “Stop & Save” pour créer un scénario.
                    </div>
                </div>
            )}

            {/* LISTE SCENARIOS */}
            {canUse && (
                <div className="rounded border bg-white p-4">
                    <div className="font-semibold mb-2">Scénarios</div>
                    {!list.length ? (
                        <div className="text-sm opacity-70">Aucun scénario</div>
                    ) : (
                        <table className="min-w-full text-sm">
                            <thead>
                            <tr className="text-left border-b">
                                <th className="py-1 pr-4">Nom</th>
                                <th className="py-1 pr-4">ID</th>
                                <th className="py-1 pr-4">Créé</th>
                                <th className="py-1">Actions</th>
                            </tr>
                            </thead>
                            <tbody>
                            {filtered.map((id) => (
                                <tr key={id} className="border-b last:border-b-0">
                                    <td className="py-1 pr-4">
                                        <button className="underline" onClick={() => openScenario(id)}>
                                            {id}
                                        </button>
                                    </td>
                                    <td className="py-1 pr-4">{id}</td>
                                    <td className="py-1 pr-4">—</td>
                                    <td className="py-1">
                                        <div className="flex gap-2">
                                            <button className="px-2 py-1 rounded border" disabled={loading} onClick={() => replayScenario(id)}>
                                                Rejouer
                                            </button>
                                            <button className="px-2 py-1 rounded border" onClick={() => deleteScenario(id)}>
                                                Supprimer
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* DERNIERS RESULTATS (si endpoint) */}
            {canUse && (
                <div className="rounded border bg-white p-4">
                    <div className="font-semibold mb-2">Derniers résultats</div>
                    {!resultsIds.length ? (
                        <div className="text-sm opacity-70">Aucun résultat</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {resultsIds.slice(-12).reverse().map((rid) => (
                                <button
                                    key={rid}
                                    className="px-2 py-1 rounded border bg-slate-50 hover:bg-slate-100"
                                    onClick={() => openResult(rid)}
                                >
                                    {rid}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* COMPARE */}
            {canUse && (
                <div className="rounded border bg-white p-4">
                    <div className="font-semibold mb-2">Comparer deux scénarios (SCP / TXP / TXDP)</div>
                    <div className="flex gap-2 items-center">
                        <input
                            className="border rounded px-2 py-1 min-w-[220px]"
                            list="tnr-ids"
                            placeholder="Scénario A…"
                            value={cmpA}
                            onChange={(e) => setCmpA(e.target.value)}
                        />
                        <span>vs</span>
                        <input
                            className="border rounded px-2 py-1 min-w-[220px]"
                            list="tnr-ids"
                            placeholder="Scénario B…"
                            value={cmpB}
                            onChange={(e) => setCmpB(e.target.value)}
                        />
                        <button className="px-3 py-2 rounded border" onClick={compareTwo}>
                            Comparer
                        </button>
                        <span className="text-sm opacity-80">{cmpStatus}</span>
                        <datalist id="tnr-ids">
                            {list.map((id) => (
                                <option key={id} value={id} />
                            ))}
                        </datalist>
                    </div>
                </div>
            )}

            {/* DETAILS SCENARIO */}
            {selScenario && (
                <div className="rounded border bg-white p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold">Scénario: {selScenario.id}</div>
                        <div className="flex gap-2">
                            <button className="px-3 py-2 rounded border" onClick={() => replayScenario(selScenario.id)}>
                                Rejouer
                            </button>
                            <button
                                className="px-3 py-2 rounded border"
                                onClick={() => navigator.clipboard.writeText(JSON.stringify(selScenario, null, 2))}
                            >
                                Copier JSON
                            </button>
                        </div>
                    </div>
                    <pre className="bg-slate-50 border rounded p-2 overflow-auto text-xs">
            {JSON.stringify(selScenario, null, 2)}
          </pre>
                </div>
            )}

            {/* DETAILS RESULT */}
            {selResult && (
                <div className="rounded border bg-white p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold">
                            Résultat: {selResult.runId} — scénario <b>{selResult.scenarioId}</b>
                        </div>
                        <div className="text-sm">
                            Signature:{" "}
                            <span className="font-mono">{selResult.signature}</span>{" "}
                            {selResult.compare.pass === null ? "(pas de baseline)" : selResult.compare.pass ? "OK" : "DIFF"}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="font-semibold mb-1">Appels serveur (CS → CP)</div>
                            <pre className="bg-slate-50 border rounded p-2 overflow-auto h-64 text-xs">
                {JSON.stringify(selResult.serverCalls, null, 2)}
              </pre>
                        </div>
                        <div>
                            <div className="font-semibold mb-1">Appels sortants (CP → CS)</div>
                            <pre className="bg-slate-50 border rounded p-2 overflow-auto h-64 text-xs">
                {JSON.stringify(selResult.outboundCalls, null, 2)}
              </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
