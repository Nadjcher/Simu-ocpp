import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stats = {
    total: number; active: number; finished: number; errors: number;
    avgLatencyMs: number; msgs: number; msgsPerSec: number; cpuPct: number; memPct: number;
    runId?: string | null;
};

const defaultStats: Stats = {
    total: 0, active: 0, finished: 0, errors: 0, avgLatencyMs: 0, msgs: 0, msgsPerSec: 0, cpuPct: 0, memPct: 0, runId: null
};

export default function PerfHttpControl() {
    // ---- runner connection
    const [runnerUrl, setRunnerUrl] = useState("http://localhost:8877");
    const [connected, setConnected] = useState(false);
    const [health, setHealth] = useState<{ status: string; runId?: string | null } | null>(null);

    // ---- run params
    const [ocppUrl, setOcppUrl] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");
    const [sessions, setSessions] = useState(100);
    const [concurrent, setConcurrent] = useState(20);
    const [rampMs, setRampMs] = useState(250);
    const [holdSec, setHoldSec] = useState(20);
    const [mvPeriodSec, setMvPeriodSec] = useState(0);
    const [noAuth, setNoAuth] = useState(false);
    const [noStart, setNoStart] = useState(false);
    const [noStop, setNoStop] = useState(false);

    // ---- CSV
    const [useCsv, setUseCsv] = useState(false);
    const [csvText, setCsvText] = useState("cpId,idTag");

    // ---- stats + logs
    const [stats, setStats] = useState<Stats>(defaultStats);
    const [logs, setLogs] = useState<string[]>([]);
    const addLog = useCallback((l: string) => {
        setLogs(prev => [...prev.slice(-299), `[${new Date().toLocaleTimeString()}] ${l}`]);
    }, []);
    const poller = useRef<any>(null);
    const statPoller = useRef<any>(null);

    // ---------- utils
    const fetchJson = useCallback(async (url: string, init?: RequestInit) => {
        const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
    }, []);

    // ---------- connect / disconnect runner (juste du polling “health”)
    const connectRunner = useCallback(async () => {
        try {
            const h = await fetchJson(`${runnerUrl}/health`);
            setHealth(h); setConnected(true);
            addLog("Connecté au runner HTTP");

            // health poll
            if (poller.current) clearInterval(poller.current);
            poller.current = setInterval(async () => {
                try {
                    const hh = await fetchJson(`${runnerUrl}/health`);
                    setHealth(hh);
                } catch {
                    setConnected(false);
                    setHealth(null);
                    addLog("Déconnecté du runner");
                }
            }, 3000);

            // stats poll
            if (statPoller.current) clearInterval(statPoller.current);
            statPoller.current = setInterval(async () => {
                try {
                    const s = await fetchJson(`${runnerUrl}/stats`);
                    setStats(s);
                } catch {/* ignore */}
            }, 1000);
        } catch (e:any) {
            setConnected(false); setHealth(null);
            addLog(`Erreur de connexion: ${e.message || e}`);
        }
    }, [runnerUrl, fetchJson, addLog]);

    const disconnectRunner = useCallback(() => {
        if (poller.current) clearInterval(poller.current);
        if (statPoller.current) clearInterval(statPoller.current);
        poller.current = null; statPoller.current = null;
        setConnected(false); setHealth(null);
        addLog("Déconnecté du runner");
    }, [addLog]);

    useEffect(() => () => { // cleanup on unmount
        if (poller.current) clearInterval(poller.current);
        if (statPoller.current) clearInterval(statPoller.current);
    }, []);

    // ---------- start / stop
    const buildStartBody = useCallback(async () => {
        let body: any = {
            url: ocppUrl,             // <-- IMPORTANT: clé attendue par le runner
            sessions,
            concurrent,
            rampMs,
            holdSec,
            mvPeriodSec,
            noAuth,
            noStart,
            noStop
        };

        if (useCsv) {
            // si un fichier a été choisi, l’IU standard peut l’avoir converti en texte;
            // ici on accepte le texte multiline "cpId,idTag" (l’IU te laisse coller du texte).
            // Le runner sait parser csvText côté serveur.
            body.csvText = csvText || "";
        }
        return body;
    }, [ocppUrl, sessions, concurrent, rampMs, holdSec, mvPeriodSec, noAuth, noStart, noStop, useCsv, csvText]);

    const startRun = useCallback(async () => {
        try {
            const body = await buildStartBody();
            if (!body.url || typeof body.url !== "string" || !body.url.trim()) {
                addLog("Erreur START: OCPP WebSocket URL vide");
                return;
            }
            const j = await fetchJson(`${runnerUrl}/start`, { method: "POST", body: JSON.stringify(body) });
            addLog(`START envoyé (runId=${j.runId}, sessions=${body.sessions}, conc=${body.concurrent})`);
        } catch (e:any) {
            addLog(`Erreur START: ${e.message || e}`);
            // aide rapide : va voir /last-errors
            try {
                const errs = await fetchJson(`${runnerUrl}/last-errors`);
                if (Array.isArray(errs) && errs.length) addLog(`Dernières erreurs runner: ${errs.slice(-3).map((x:any)=>x.msg).join(" | ")}`);
            } catch {}
        }
    }, [runnerUrl, buildStartBody, fetchJson, addLog]);

    const stopRun = useCallback(async () => {
        try {
            await fetchJson(`${runnerUrl}/stop`, { method: "POST", body: "{}" });
            addLog("STOP envoyé");
        } catch (e:any) {
            addLog(`Erreur STOP: ${e.message || e}`);
        }
    }, [runnerUrl, fetchJson, addLog]);

    // ---------- CSV file -> texte
    const onPickCsv = useCallback((file: File | undefined | null) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || "");
            setCsvText(text.trim());
        };
        reader.readAsText(file);
    }, []);

    // ---------- UI
    return (
        <div className="bg-white rounded shadow p-4">
            <div className="flex flex-wrap gap-3 items-end">
                <div style={{ minWidth: 280 }}>
                    <label className="block text-sm mb-1">Runner URL</label>
                    <input value={runnerUrl} onChange={e=>setRunnerUrl(e.target.value)} className="w-full px-3 py-2 border rounded"/>
                </div>

                <div style={{ minWidth: 420, flex: 1 }}>
                    <label className="block text-sm mb-1">OCPP WebSocket URL</label>
                    <input value={ocppUrl} onChange={e=>setOcppUrl(e.target.value)} className="w-full px-3 py-2 border rounded"/>
                </div>

                <button onClick={connectRunner} className="px-3 py-2 bg-gray-700 text-white rounded">CONNECT</button>
                <button onClick={disconnectRunner} className="px-3 py-2 bg-gray-400 text-white rounded">DISCONNECT</button>
                <button onClick={startRun} disabled={!connected} className="px-3 py-2 bg-green-600 text-white rounded disabled:opacity-50">START</button>
                <button onClick={stopRun} disabled={!connected} className="px-3 py-2 bg-red-600 text-white rounded disabled:opacity-50">STOP</button>
            </div>

            <div className="grid grid-cols-5 gap-3 my-3">
                <div><label className="text-sm">Sessions</label><input type="number" value={sessions} onChange={e=>setSessions(+e.target.value)} className="w-full px-3 py-2 border rounded"/></div>
                <div><label className="text-sm">Concurrent</label><input type="number" value={concurrent} onChange={e=>setConcurrent(+e.target.value)} className="w-full px-3 py-2 border rounded"/></div>
                <div><label className="text-sm">Ramp (ms)</label><input type="number" value={rampMs} onChange={e=>setRampMs(+e.target.value)} className="w-full px-3 py-2 border rounded"/></div>
                <div><label className="text-sm">Hold (s)</label><input type="number" value={holdSec} onChange={e=>setHoldSec(+e.target.value)} className="w-full px-3 py-2 border rounded"/></div>
                <div><label className="text-sm">MeterValues (s) — 0=off</label><input type="number" value={mvPeriodSec} onChange={e=>setMvPeriodSec(+e.target.value)} className="w-full px-3 py-2 border rounded"/></div>
            </div>

            <div className="flex gap-4 items-center mb-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noAuth} onChange={e=>setNoAuth(e.target.checked)}/> noAuth</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noStart} onChange={e=>setNoStart(e.target.checked)}/> noStart</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noStop} onChange={e=>setNoStop(e.target.checked)}/> noStop</label>
            </div>

            <div className="mt-2 border-t pt-3">
                <label className="flex items-center gap-2 text-sm mb-2">
                    <input type="checkbox" checked={useCsv} onChange={e=>setUseCsv(e.target.checked)}/>
                    Utiliser CSV (cpId,idTag)
                </label>
                <div className="flex gap-3 items-center mb-2">
                    <input type="file" accept=".csv" onChange={e=>onPickCsv(e.target.files?.[0])}/>
                    <span className="text-xs text-gray-500">ou colle ci-dessous</span>
                </div>
                <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={5} className="w-full px-3 py-2 border rounded font-mono text-sm"/>
            </div>

            <div className="grid grid-cols-5 gap-3 my-3">
                <div className="text-center"><div className="text-2xl font-bold">{stats.total}</div><div className="text-xs text-gray-600">TOTAL</div></div>
                <div className="text-center"><div className="text-2xl font-bold">{stats.active}</div><div className="text-xs text-gray-600">ACTIVES</div></div>
                <div className="text-center"><div className="text-2xl font-bold">{stats.finished}</div><div className="text-xs text-gray-600">FINISHED</div></div>
                <div className="text-center"><div className="text-2xl font-bold">{stats.errors}</div><div className="text-xs text-gray-600">ERRORS</div></div>
                <div className="text-center"><div className="text-2xl font-bold">{stats.avgLatencyMs} ms</div><div className="text-xs text-gray-600">AVG LATENCY</div></div>
            </div>

            <div className="bg-black text-green-300 font-mono text-xs p-3 rounded h-48 overflow-y-auto">
                {logs.map((l, i) => (<div key={i}>{l}</div>))}
            </div>
        </div>
    );
}
