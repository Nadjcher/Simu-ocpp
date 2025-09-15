// components/TnrPlusPanel.tsx — panneau autonome (aucune modif ailleurs)
import React, { useEffect, useMemo, useState } from "react";
import { tnrplus, type ExecMeta } from "@/services/tnrplus";

type Diff = { eventIndex?: number; path?: string; type?: string; expected?: any; actual?: any; };
type CompareResult = {
    baselineId: string; currentId: string; signatureMatch: boolean;
    totalEventsBaseline: number; totalEventsCurrent: number;
    differencesCount: number; differences: Diff[];
};

const DEFAULT_IGNORES = ["timestamp","latency","ts","id","uuid"];

export default function TnrPlusPanel() {
    const [execs, setExecs] = useState<ExecMeta[]>([]);
    const [baseline, setBaseline] = useState("");
    const [current, setCurrent] = useState("");
    const [opts, setOpts] = useState({ strictOrder: true, allowExtras: true, numberTolerance: 0, ignoreKeys: DEFAULT_IGNORES });
    const [res, setRes] = useState<CompareResult | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        tnrplus.executions().then(setExecs).catch(()=>setExecs([]));
    }, []);

    const submit = async () => {
        if (!baseline || !current) return;
        setLoading(true);
        try {
            const r = await tnrplus.compare({ baseline, current, ...opts });
            setRes(r as any);
        } finally { setLoading(false); }
    };

    const diffRows = useMemo(() => (res?.differences ?? []).slice(0, 500), [res]);

    return (
        <section className="rounded-2xl border shadow-sm p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">TNR+ (comparaison avancée)</h2>
                <div className="flex gap-2">
                    <button onClick={submit} disabled={loading || !baseline || !current}
                            className="px-3 py-1 rounded border">
                        {loading ? "Comparaison..." : "Comparer"}
                    </button>
                    {res && (
                        <a className="px-3 py-1 rounded border"
                           href="#"
                           onClick={async (e)=>{e.preventDefault(); const csv = await tnrplus.exportCsv({ baseline, current, ...opts });
                               const blob = new Blob([csv], {type:"text/csv"});
                               const url = URL.createObjectURL(blob);
                               const a = document.createElement("a"); a.href = url; a.download = "tnr-diff.csv"; a.click(); URL.revokeObjectURL(url);}}>
                            Export CSV
                        </a>
                    )}
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3 mb-4">
                <SelectExec label="Baseline" value={baseline} onChange={setBaseline} items={execs} />
                <SelectExec label="Courant"  value={current}  onChange={setCurrent}  items={execs} />
            </div>

            <div className="grid md:grid-cols-3 gap-3 mb-4">
                <Kpi label="Signature égale" value={res ? (res.signatureMatch ? "Oui" : "Non") : "—"} />
                <Kpi label="Évènements (B/C)" value={`${res?.totalEventsBaseline ?? "—"} / ${res?.totalEventsCurrent ?? "—"}`} />
                <Kpi label="Différences" value={res?.differencesCount?.toString() ?? "—"} />
            </div>

            <Options opts={opts} setOpts={setOpts} />

            <div className="mt-4">
                <table className="w-full text-sm border">
                    <thead className="bg-gray-50">
                    <tr>
                        <th className="border px-2 py-1 text-left">#Evt</th>
                        <th className="border px-2 py-1 text-left">Chemin</th>
                        <th className="border px-2 py-1 text-left">Type</th>
                        <th className="border px-2 py-1 text-left">Expected</th>
                        <th className="border px-2 py-1 text-left">Actual</th>
                    </tr>
                    </thead>
                    <tbody>
                    {diffRows.map((d, i) => (
                        <tr key={i} className="odd:bg-white even:bg-gray-50 align-top">
                            <td className="border px-2 py-1">{d.eventIndex ?? "—"}</td>
                            <td className="border px-2 py-1">{d.path}</td>
                            <td className="border px-2 py-1">{d.type}</td>
                            <td className="border px-2 py-1 whitespace-pre-wrap break-all">{toStr(d.expected)}</td>
                            <td className="border px-2 py-1 whitespace-pre-wrap break-all">{toStr(d.actual)}</td>
                        </tr>
                    ))}
                    {!diffRows.length && (
                        <tr><td colSpan={5} className="text-center text-gray-500 p-4">Aucune différence</td></tr>
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function SelectExec({label, value, onChange, items}: {label:string; value:string; onChange:(id:string)=>void; items:ExecMeta[]}) {
    return (
        <div>
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <select className="w-full border rounded px-2 py-1"
                    value={value} onChange={(e)=>onChange(e.target.value)}>
                <option value="">— choisir —</option>
                {items.map(x => (
                    <option key={x.executionId} value={x.executionId}>
                        {x.executionId} — {x.scenarioId} {x.passed ? "✅" : "❌"}
                    </option>
                ))}
            </select>
        </div>
    );
}
function Kpi({label, value}:{label:string; value:string}) {
    return (
        <div className="rounded-xl border p-3 text-center">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
        </div>
    );
}
function Options({opts, setOpts}:{opts:any; setOpts:(o:any)=>void}) {
    return (
        <div className="rounded-xl border p-3">
            <div className="text-sm font-medium mb-2">Options de comparaison</div>
            <div className="flex flex-wrap gap-4 items-center">
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={opts.strictOrder} onChange={e=>setOpts({...opts, strictOrder:e.target.checked})}/>
                    Strict order
                </label>
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={opts.allowExtras} onChange={e=>setOpts({...opts, allowExtras:e.target.checked})}/>
                    Allow extras
                </label>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">Tolérance num.</span>
                    <input type="number" className="w-24 border rounded px-2 py-1" value={opts.numberTolerance}
                           onChange={e=>setOpts({...opts, numberTolerance: Number(e.target.value)})}/>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">Ignore</span>
                    <input type="text" className="w-72 border rounded px-2 py-1"
                           value={opts.ignoreKeys.join(",")}
                           onChange={e=>setOpts({...opts, ignoreKeys: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}/>
                </div>
            </div>
        </div>
    );
}
function toStr(v:any){ try{ return typeof v==='string'?v:JSON.stringify(v); }catch{ return String(v); } }
