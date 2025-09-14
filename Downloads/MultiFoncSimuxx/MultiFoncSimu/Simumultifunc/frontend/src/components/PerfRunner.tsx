import React, { useEffect, useRef, useState } from "react";

type Status = {
    run: { status: "RUNNING" | "IDLE"; runId: string | null };
    stats: { total: number; active: number; finished: number; errors: number; msgs: number; avgLatencyMs: number };
    pool: { cpId: string; status: string; txId?: number | string | null; lastError?: string | null }[];
};

export default function PerfRunner() {
    const [url, setUrl] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");
    const [sessions, setSessions] = useState(10);
    const [concurrent, setConcurrent] = useState(5);
    const [rampMs, setRampMs] = useState(250);
    const [holdSec, setHoldSec] = useState(30);
    const [mvEverySec, setMvEverySec] = useState(5);
    const [powerKW, setPowerKW] = useState(7.4);
    const [voltageV, setVoltageV] = useState(230);
    const [useCsv, setUseCsv] = useState(true);

    const [status, setStatus] = useState<Status | null>(null);
    const [csvInfo, setCsvInfo] = useState<string>("Aucun CSV importé");
    const [starting, setStarting] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    // Poll statut
    useEffect(() => {
        let t: any;
        const tick = async () => {
            try {
                const r = await fetch("/api/perf/status");
                if (r.ok) setStatus(await r.json());
            } catch {}
            t = setTimeout(tick, 1000);
        };
        tick();
        return () => clearTimeout(t);
    }, []);

    async function importCsv(file: File) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/perf/import", { method: "POST", body: form });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Import échoué");
        setCsvInfo(`CSV importé: ${j.count} lignes`);
    }

    async function onUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0];
        if (!f) return;
        try { await importCsv(f); }
        catch (err: any) { alert(err?.message || String(err)); }
        finally { e.target.value = ""; }
    }

    async function start() {
        setStarting(true);
        try {
            if (useCsv && (!sessions || sessions <= 0)) {
                alert("Veuillez renseigner 'Sessions' (>0) lorsque 'Utiliser CSV' est coché.");
                return;
            }
            const body = {
                url, sessions, concurrent, rampMs, holdSec,
                mvEverySec, powerKW, voltageV, useCsv,
                noAuth: false, noStart: false, noStop: false
            };
            const r = await fetch("/api/perf/start", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || "Erreur start");
        } catch (err: any) {
            alert(err?.message || String(err));
        } finally {
            setStarting(false);
        }
    }

    async function stop() { try { await fetch("/api/perf/stop", { method: "POST" }); } catch {} }

    const running = status?.run.status === "RUNNING";

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-lg border bg-white">
                <div className="grid md:grid-cols-3 gap-3">
                    <label className="flex flex-col text-sm">WebSocket URL
                        <input className="mt-1 p-2 border rounded" value={url} onChange={e => setUrl(e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">Sessions
                        <input type="number" className="mt-1 p-2 border rounded" value={sessions} onChange={e => setSessions(+e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">Concurrent
                        <input type="number" className="mt-1 p-2 border rounded" value={concurrent} onChange={e => setConcurrent(+e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">Ramp (ms)
                        <input type="number" className="mt-1 p-2 border rounded" value={rampMs} onChange={e => setRampMs(+e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">Hold (sec)
                        <input type="number" className="mt-1 p-2 border rounded" value={holdSec} onChange={e => setHoldSec(+e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">MV every (sec)
                        <input type="number" className="mt-1 p-2 border rounded" value={mvEverySec} onChange={e => setMvEverySec(+e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">Puissance (kW)
                        <input type="number" step="0.1" className="mt-1 p-2 border rounded" value={powerKW} onChange={e => setPowerKW(+e.target.value)} />
                    </label>
                    <label className="flex flex-col text-sm">Tension (V)
                        <input type="number" className="mt-1 p-2 border rounded" value={voltageV} onChange={e => setVoltageV(+e.target.value)} />
                    </label>
                    <label className="flex items-center gap-2 text-sm mt-6">
                        <input type="checkbox" checked={useCsv} onChange={e => setUseCsv(e.target.checked)} />
                        Utiliser CSV (importé)
                    </label>
                </div>

                <div className="flex items-center gap-3 mt-4">
                    <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onUploadChange} className="hidden" />
                    <button className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm" onClick={() => fileRef.current?.click()}>
                        📥 Import CSV
                    </button>
                    <span className="text-sm opacity-70">{csvInfo}</span>
                    <div className="flex-1" />
                    {!running ? (
                        <button className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50" onClick={start} disabled={starting}>
                            ▶️ Start
                        </button>
                    ) : (
                        <button className="px-4 py-2 rounded bg-rose-600 text-white" onClick={stop}>
                            ⏹ Stop
                        </button>
                    )}
                </div>
            </div>

            <div className="p-4 rounded-lg border bg-white">
                <div className="text-sm font-medium mb-2">Status</div>
                <pre className="text-xs overflow-auto bg-gray-50 p-3 rounded">{JSON.stringify(status, null, 2)}</pre>
            </div>
        </div>
    );
}
