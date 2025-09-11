// frontend/src/tabs/OCPPMessagesTab.tsx
import React, { useMemo, useRef, useState } from "react";

/** UI helpers */
const nowIsoLocal = () => new Date().toISOString().slice(0, 19); // yyyy-MM-ddTHH:mm:ss
const nextId = (() => { let i = 1; return () => `${Date.now()}-${i++}`; })();

/** OCPP ref data */
const ACTIONS = [
    "BootNotification",
    "StatusNotification",
    "Authorize",
    "StartTransaction",
    "StopTransaction",
    "MeterValues",
    "Heartbeat",
] as const;
type Action = typeof ACTIONS[number];

const MEASURANDS = [
    "Energy.Active.Import.Register","Energy.Active.Export.Register",
    "Energy.Reactive.Import.Register","Energy.Reactive.Export.Register",
    "Power.Active.Import","Power.Active.Export","Power.Reactive.Import","Power.Reactive.Export",
    "Current.Import","Current.Export","Voltage","SoC","Temperature","Power.Offered"
];
const UNITS = ["Wh","kWh","varh","W","kW","var","A","V","Percent","Celsius","Fahrenheit",""];
const LOCATIONS = ["Outlet","Inlet","Body","Cable","EV","Unknown",""];
const PHASES = ["","L1","L2","L3","N","L1-L2","L2-L3","L3-L1","DC"];

type MVRow = { measurand: string; value: string; unit: string; location: string; phase: string };

export default function OCPPMessagesTab() {
    /** Connexion */
    const [urlBase, setUrlBase] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");
    const [cpId, setCpId] = useState("CP-DEMO-001");
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [status, setStatus] = useState("Déconnecté");

    function wsUrl() {
        const base = urlBase.trim().replace(/\/+$/, "");
        return `${base}/${encodeURIComponent(cpId.trim())}`;
    }
    function logLine(s: string) {
        setRespLog((prev) => `[${new Date().toLocaleTimeString()}] ${s}\n` + prev);
    }
    function connectToggle() {
        if (connected && wsRef.current) {
            try { wsRef.current.close(); } catch {}
            wsRef.current = null; setConnected(false); setStatus("Déconnecté"); logLine("WS fermé.");
            return;
        }
        const url = wsUrl();
        setStatus("Connexion…"); logLine(`Connexion → ${url}`);
        const ws = new WebSocket(url, ["ocpp1.6"]);
        wsRef.current = ws;
        ws.onopen = () => {
            setConnected(true); setStatus("Connecté"); logLine("WS ouvert.");
            const msgId = nextId();
            const payload = {
                chargePointVendor: boot.vendor || "EVSE Simulator",
                chargePointModel: boot.model || "WebClient",
                chargePointSerialNumber: cpId,
                chargeBoxSerialNumber: cpId,
            };
            ws.send(JSON.stringify([2, msgId, "BootNotification", payload]));
            logLine(`>>> BootNotification ${msgId}`);
        };
        ws.onmessage = (ev) => logLine(`<<< ${ev.data}`);
        ws.onerror  = () => logLine("Erreur WebSocket");
        ws.onclose  = () => { setConnected(false); setStatus("Déconnecté"); logLine("WS fermé."); };
    }
    function ensureOpen(): WebSocket | null {
        const ws = wsRef.current;
        return ws && ws.readyState === WebSocket.OPEN ? ws : null;
    }

    /** Etats action/payload */
    const [action, setAction] = useState<Action>("MeterValues");

    const [boot, setBoot] = useState({ vendor: "EVSE Simulator", model: "WebClient" });
    const [stat, setStat] = useState({ connectorId: 1, status: "Available", errorCode: "NoError" });
    const [auth, setAuth] = useState({ idTag: "TAG-UI-001" });
    const [startTx, setStartTx] = useState({ connectorId: 1, idTag: "TAG-UI-001", meterStart: 0 });
    const [stopTx, setStopTx]   = useState({ transactionId: 0, meterStop: 0, reason: "Local" });

    /** MeterValues */
    const [mvConnectorId, setMvConnectorId] = useState(1);
    const [mvTxId, setMvTxId] = useState(0);
    const [mvTs, setMvTs] = useState(nowIsoLocal());
    const [rows, setRows] = useState<MVRow[]>([
        { measurand: "Energy.Active.Import.Register", value: "", unit: "Wh", location: "Outlet", phase: "L1" },
    ]);

    function addRow(r?: Partial<MVRow>) {
        setRows((prev) => [
            ...prev,
            {
                measurand: r?.measurand ?? "Power.Active.Import",
                value: r?.value ?? "",
                unit: r?.unit ?? "W",
                location: r?.location ?? "Outlet",
                phase: r?.phase ?? "",
            },
        ]);
    }
    function delRow(i: number) { setRows((prev) => prev.filter((_, idx) => idx !== i)); }
    function updRow(i: number, patch: Partial<MVRow>) {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    }

    /** Templates (Mono/Bi/Tri/DC) */
    function insertTemplate(kind: "Monophasé" | "Biphasé" | "Triphasé" | "DC") {
        if (kind === "DC") {
            setRows([
                { measurand: "Energy.Active.Import.Register", value: "", unit: "Wh", location: "Outlet", phase: "DC" },
                { measurand: "Power.Active.Import",            value: "", unit: "W",  location: "Outlet", phase: "DC" },
                { measurand: "Current.Import",                 value: "", unit: "A",  location: "Outlet", phase: "DC" },
                { measurand: "Voltage",                        value: "", unit: "V",  location: "Outlet", phase: "DC" },
                { measurand: "SoC",                            value: "", unit: "Percent", location: "EV", phase: "" },
            ]);
            return;
        }
        const base: MVRow[] = [
            { measurand: "Energy.Active.Import.Register", value: "", unit: "Wh", location: "Outlet", phase: "" },
            { measurand: "Power.Active.Import",          value: "", unit: "W",  location: "Outlet", phase: "" },
            { measurand: "Current.Import",               value: "", unit: "A",  location: "Outlet", phase: "" },
            { measurand: "Voltage",                      value: "", unit: "V",  location: "Outlet", phase: "" },
            { measurand: "Power.Offered",                value: "", unit: "",   location: "Outlet", phase: "" },
        ];
        if (kind === "Monophasé") {
            setRows(base.map((r) => ({ ...r, phase: "L1" })));
        } else if (kind === "Biphasé") {
            setRows([...base.map(r => ({...r, phase:"L1"})), ...base.map(r => ({...r, phase:"L2"}))]);
        } else {
            setRows([
                ...base.map(r => ({...r, phase:"L1"})),
                ...base.map(r => ({...r, phase:"L2"})),
                ...base.map(r => ({...r, phase:"L3"})),
            ]);
        }
    }

    /** Prévisualisation / envoi */
    const payload = useMemo(() => {
        switch (action) {
            case "BootNotification":
                return { chargePointVendor: boot.vendor, chargePointModel: boot.model };
            case "StatusNotification":
                return {
                    connectorId: Number(stat.connectorId) || 1,
                    status: stat.status,
                    errorCode: stat.errorCode,
                    timestamp: new Date().toISOString(),
                };
            case "Authorize":
                return { idTag: auth.idTag || "TAG-UI-001" };
            case "StartTransaction":
                return {
                    connectorId: Number(startTx.connectorId) || 1,
                    idTag: startTx.idTag || "TAG-UI-001",
                    meterStart: Number(startTx.meterStart) || 0,
                    timestamp: new Date().toISOString(),
                };
            case "StopTransaction":
                return {
                    transactionId: Number(stopTx.transactionId) || 0,
                    meterStop: Number(stopTx.meterStop) || 0,
                    timestamp: new Date().toISOString(),
                    reason: stopTx.reason || "Local",
                };
            case "Heartbeat":
                return {};
            case "MeterValues":
                return {
                    connectorId: Number(mvConnectorId) || 1,
                    transactionId: Number(mvTxId) || 0,
                    meterValue: [
                        {
                            timestamp: (mvTs.length === 19 ? mvTs + "Z" : new Date().toISOString()),
                            sampledValue: rows
                                .filter((r) => String(r.value).trim() !== "")
                                .map((r) => ({
                                    value: String(r.value),
                                    ...(r.measurand ? { measurand: r.measurand } : {}),
                                    ...(r.unit ? { unit: r.unit } : {}),
                                    ...(r.location ? { location: r.location } : {}),
                                    ...(r.phase ? { phase: r.phase } : {}),
                                    context: "Sample.Periodic",
                                })),
                        },
                    ],
                };
        }
    }, [action, boot, stat, auth, startTx, stopTx, mvConnectorId, mvTxId, mvTs, rows]);

    const [preview, setPreview] = useState("");
    const [respLog, setRespLog] = useState("");
    function doPreview() {
        setPreview(JSON.stringify([2, "<msgId>", action, payload], null, 2));
    }
    function send() {
        const ws = ensureOpen();
        if (!ws) return logLine("❗ Veuillez vous connecter d'abord.");
        const msgId = nextId();
        ws.send(JSON.stringify([2, msgId, action, payload]));
        logLine(`>>> ${action} ${msgId}`);
    }

    return (
        <div className="page">
            {/* Connexion */}
            <div className="card p16 mb16">
                <div className="grid2">
                    <div>
                        <label>URL OCPP :</label>
                        <input value={urlBase} onChange={(e) => setUrlBase(e.target.value)} />
                    </div>
                    <div>
                        <label>CP-ID :</label>
                        <input value={cpId} onChange={(e) => setCpId(e.target.value)} />
                    </div>
                </div>
                <div className="row mt8">
                    <button className="btn" onClick={connectToggle}>{connected ? "Disconnect" : "Connect"}</button>
                    <div className="ml8 muted">{status}</div>
                </div>
            </div>

            {/* Action + payload */}
            <div className="card p16 mb16">
                <div className="grid3">
                    <div>
                        <label>Action OCPP :</label>
                        <select value={action} onChange={(e) => setAction(e.target.value as Action)}>
                            {ACTIONS.map((a) => (
                                <option key={a} value={a}>{a}</option>
                            ))}
                        </select>
                    </div>

                    {action === "BootNotification" && (
                        <>
                            <div>
                                <label>Vendor</label>
                                <input value={boot.vendor} onChange={(e) => setBoot({ ...boot, vendor: e.target.value })} />
                            </div>
                            <div>
                                <label>Model</label>
                                <input value={boot.model} onChange={(e) => setBoot({ ...boot, model: e.target.value })} />
                            </div>
                        </>
                    )}

                    {action === "StatusNotification" && (
                        <>
                            <div>
                                <label>connectorId</label>
                                <input type="number" value={stat.connectorId} onChange={(e) => setStat({ ...stat, connectorId: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label>status</label>
                                <select value={stat.status} onChange={(e) => setStat({ ...stat, status: e.target.value })}>
                                    {["Available","Preparing","Charging","Finishing","SuspendedEV","SuspendedEVSE","Faulted","Unavailable"].map(s => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label>errorCode</label>
                                <select value={stat.errorCode} onChange={(e) => setStat({ ...stat, errorCode: e.target.value })}>
                                    {["NoError","ConnectorLockFailure","GroundFailure","HighTemperature","PowerLoss","OtherError"].map(s => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                        </>
                    )}

                    {action === "Authorize" && (
                        <div>
                            <label>idTag</label>
                            <input value={auth.idTag} onChange={(e) => setAuth({ idTag: e.target.value })} />
                        </div>
                    )}

                    {action === "StartTransaction" && (
                        <>
                            <div>
                                <label>connectorId</label>
                                <input type="number" value={startTx.connectorId} onChange={(e) => setStartTx({ ...startTx, connectorId: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label>idTag</label>
                                <input value={startTx.idTag} onChange={(e) => setStartTx({ ...startTx, idTag: e.target.value })} />
                            </div>
                            <div>
                                <label>meterStart</label>
                                <input type="number" value={startTx.meterStart} onChange={(e) => setStartTx({ ...startTx, meterStart: Number(e.target.value) })} />
                            </div>
                        </>
                    )}

                    {action === "StopTransaction" && (
                        <>
                            <div>
                                <label>transactionId</label>
                                <input type="number" value={stopTx.transactionId} onChange={(e) => setStopTx({ ...stopTx, transactionId: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label>meterStop</label>
                                <input type="number" value={stopTx.meterStop} onChange={(e) => setStopTx({ ...stopTx, meterStop: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label>reason</label>
                                <select value={stopTx.reason} onChange={(e) => setStopTx({ ...stopTx, reason: e.target.value })}>
                                    {["Local","EVDisconnected","HardReset","SoftReset","UnlockCommand","DeAuthorized"].map(s => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                        </>
                    )}
                </div>

                {action === "MeterValues" && (
                    <>
                        <div className="grid3 mt12">
                            <div>
                                <label>connectorId</label>
                                <input type="number" value={mvConnectorId} onChange={(e) => setMvConnectorId(Number(e.target.value))} />
                            </div>
                            <div>
                                <label>transactionId</label>
                                <input type="number" value={mvTxId} onChange={(e) => setMvTxId(Number(e.target.value))} />
                            </div>
                            <div>
                                <label>timestamp</label>
                                <input type="datetime-local" value={mvTs} onChange={(e) => setMvTs(e.target.value)} />
                            </div>
                        </div>

                        <div className="row mt12">
                            <label className="mr8">Insérer un template :</label>
                            <select onChange={(e) => { const v = e.target.value as any; if (v) insertTemplate(v); e.currentTarget.selectedIndex = 0; }}>
                                <option value="">(choisir)</option>
                                <option value="Monophasé">Monophasé</option>
                                <option value="Biphasé">Biphasé</option>
                                <option value="Triphasé">Triphasé</option>
                                <option value="DC">DC</option>
                            </select>
                            <button className="btn ml8" onClick={() => addRow({})}>+ ligne</button>
                        </div>

                        <div className="surface p12 mt12">
                            <table>
                                <thead>
                                <tr>
                                    <th style={{width:220}}>measurand</th>
                                    <th>value</th>
                                    <th style={{width:90}}>unit</th>
                                    <th style={{width:110}}>location</th>
                                    <th style={{width:90}}>phase</th>
                                    <th style={{width:48}}></th>
                                </tr>
                                </thead>
                                <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i}>
                                        <td>
                                            <select value={r.measurand} onChange={(e) => updRow(i, { measurand: e.target.value })}>
                                                {MEASURANDS.map((m) => <option key={m}>{m}</option>)}
                                            </select>
                                        </td>
                                        <td><input value={r.value} onChange={(e) => updRow(i, { value: e.target.value })} placeholder="ex: 123.4" /></td>
                                        <td>
                                            <select value={r.unit} onChange={(e) => updRow(i, { unit: e.target.value })}>
                                                {UNITS.map((u) => <option key={u}>{u}</option>)}
                                            </select>
                                        </td>
                                        <td>
                                            <select value={r.location} onChange={(e) => updRow(i, { location: e.target.value })}>
                                                {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                                            </select>
                                        </td>
                                        <td>
                                            <select value={r.phase} onChange={(e) => updRow(i, { phase: e.target.value })}>
                                                {PHASES.map((p) => <option key={p} value={p}>{p || "(n/a)"}</option>)}
                                            </select>
                                        </td>
                                        <td><button className="btn danger" onClick={() => delRow(i)}>X</button></td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                <div className="row mt12">
                    <button className="btn secondary" onClick={doPreview}>Prévisualiser JSON</button>
                    <button className="btn ml8" onClick={send}>Envoyer</button>
                </div>
            </div>

            {/* Preview + Logs */}
            <div className="card p16 mb16">
                <label>Prévisualisation JSON :</label>
                <textarea rows={10} readOnly value={preview} />
            </div>
            <div className="card p16">
                <label>Réponse du serveur OCPP :</label>
                <textarea rows={12} readOnly value={respLog} />
            </div>
        </div>
    );
}
