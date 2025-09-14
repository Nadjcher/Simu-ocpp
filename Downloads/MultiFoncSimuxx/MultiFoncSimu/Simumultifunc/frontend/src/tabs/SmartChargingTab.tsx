// frontend/src/tabs/SmartChargingTab.tsx
import React, { useMemo, useRef, useState } from "react";

const nextId = (() => {
    let i = 1;
    return () => `${Date.now()}-${i++}`;
})();

type WsRef = { ws: WebSocket | null; open: boolean };

type Period = { start: number; limit: number };

export default function SmartChargingTab() {
    // Connexion
    const wsRef = useRef<WsRef>({ ws: null, open: false });
    const [urlBase, setUrlBase] = useState(
        "wss://evse-test.total-ev-charge.com/ocpp/WebSocket"
    );
    const [cpId, setCpId] = useState("CP-DEMO-001");
    const [evpId, setEvpId] = useState("EVP-FLOW-001"); // info visuelle
    const [token, setToken] = useState(""); // non utilisé OCPP
    const [status, setStatus] = useState<"Déconnecté" | "Connexion…" | "Connecté">(
        "Déconnecté"
    );

    // Paramètres de ChargingProfile
    const [connectorId, setConnectorId] = useState<number>(1);
    const [profileId, setProfileId] = useState<number>(1);
    const [stackLevel, setStackLevel] = useState<number>(0);
    const [purpose, setPurpose] = useState<
        "TxProfile" | "TxDefaultProfile" | "ChargePointMaxProfile"
    >("TxProfile");
    const [kind, setKind] = useState<"Absolute" | "Recurring" | "Relative">(
        "Absolute"
    );
    const [unit, setUnit] = useState<"W" | "A" | "Wh">("W");
    const [validFrom, setValidFrom] = useState<string>("");
    const [validTo, setValidTo] = useState<string>("");
    const [recurrence, setRecurrence] = useState<"" | "Daily" | "Weekly">("");

    // Périodes
    const [newStart, setNewStart] = useState<number>(0);
    const [newLimit, setNewLimit] = useState<number>(10000);
    const [periods, setPeriods] = useState<Period[]>([]);

    // zones texte
    const [preview, setPreview] = useState("");
    const [log, setLog] = useState("");

    function appendLog(msg: string) {
        const ts = new Date().toLocaleTimeString();
        setLog((p) => `[${ts}] ${msg}\n` + p);
    }

    function urlWs() {
        const base = urlBase.trim().replace(/\/+$/, "");
        return `${base}/${encodeURIComponent(cpId.trim())}`;
    }

    function connectToggle() {
        const cur = wsRef.current;
        if (cur.ws && cur.ws.readyState !== WebSocket.CLOSED) {
            try {
                cur.ws.close();
            } catch {}
            cur.ws = null;
            cur.open = false;
            setStatus("Déconnecté");
            appendLog("WS fermé.");
            return;
        }
        const url = urlWs();
        appendLog(`Connexion → ${url}`);
        setStatus("Connexion…");
        try {
            const ws = new WebSocket(url, ["ocpp1.6"]);
            cur.ws = ws;
            ws.onopen = () => {
                cur.open = true;
                setStatus("Connecté");
                appendLog("WS ouvert.");
                // Boot auto pour synchro, comme JavaFX
                const msgId = nextId();
                const payload = {
                    chargePointVendor: "EVSE Simulator",
                    chargePointModel: "SmartCharging",
                    chargePointSerialNumber: cpId,
                    chargeBoxSerialNumber: cpId,
                };
                ws.send(JSON.stringify([2, msgId, "BootNotification", payload]));
                appendLog(`>>> BootNotification ${msgId}`);
            };
            ws.onclose = () => {
                cur.open = false;
                setStatus("Déconnecté");
                appendLog("WS fermé.");
            };
            ws.onerror = () => appendLog("Erreur WS.");
            ws.onmessage = (ev) => appendLog(`<<< ${ev.data}`);
        } catch (e: any) {
            appendLog(`Erreur: ${e?.message || e}`);
            setStatus("Déconnecté");
        }
    }

    function ensureOpen(): WebSocket | null {
        const cur = wsRef.current;
        if (cur.ws && cur.open && cur.ws.readyState === WebSocket.OPEN) return cur.ws;
        return null;
    }

    // Périodes UI
    function addPeriod() {
        setPeriods((p) => [...p, { start: Math.max(0, newStart), limit: Math.max(0, newLimit) }]);
    }
    function clearPeriods() {
        setPeriods([]);
    }
    function removeLast() {
        setPeriods((p) => p.slice(0, Math.max(0, p.length - 1)));
    }

    // Construction du SetChargingProfile
    const setChargingProfilePayload = useMemo(() => {
        const schedule = {
            chargingRateUnit: unit,
            chargingSchedulePeriod: periods.map((x) => ({
                startPeriod: x.start,
                limit: x.limit,
            })),
        };
        const csChargingProfiles: any = {
            chargingProfileId: profileId,
            stackLevel: stackLevel,
            chargingProfilePurpose: purpose,
            chargingProfileKind: kind,
            chargingSchedule: schedule,
        };
        if (validFrom) csChargingProfiles.validFrom = new Date(validFrom).toISOString();
        if (validTo) csChargingProfiles.validTo = new Date(validTo).toISOString();
        if (kind === "Recurring" && recurrence) {
            csChargingProfiles.recurrencyKind = recurrence;
        }
        return {
            connectorId: connectorId,
            csChargingProfiles,
        };
    }, [
        connectorId,
        profileId,
        stackLevel,
        purpose,
        kind,
        unit,
        periods,
        validFrom,
        validTo,
        recurrence,
    ]);

    // Preview
    function doPreview() {
        const frame = [2, "<msgId>", "SetChargingProfile", setChargingProfilePayload];
        setPreview(JSON.stringify(frame, null, 2));
    }

    // Envois
    function sendSetChargingProfile() {
        const ws = ensureOpen();
        if (!ws) return appendLog("❗ Connecte-toi d’abord.");
        const msgId = nextId();
        ws.send(JSON.stringify([2, msgId, "SetChargingProfile", setChargingProfilePayload]));
        appendLog(`>>> SetChargingProfile ${msgId}`);
    }

    function sendClearProfile() {
        const ws = ensureOpen();
        if (!ws) return appendLog("❗ Connecte-toi d’abord.");
        const msgId = nextId();
        const payload: any = { connectorId };
        // on utilise profileId comme identifiant optionnel
        if (profileId) payload.id = profileId;
        // optionnellement filtrer par purpose
        payload.chargingProfilePurpose = purpose;
        ws.send(JSON.stringify([2, msgId, "ClearChargingProfile", payload]));
        appendLog(`>>> ClearChargingProfile ${msgId}`);
    }

    function sendGetComposite() {
        const ws = ensureOpen();
        if (!ws) return appendLog("❗ Connecte-toi d’abord.");
        const msgId = nextId();
        // durée : si validTo est défini on calcule, sinon 3600
        let duration = 3600;
        if (validTo) {
            const to = new Date(validTo).getTime();
            const now = Date.now();
            if (to > now) duration = Math.round((to - now) / 1000);
        }
        const payload = { connectorId, duration, chargingRateUnit: unit };
        ws.send(JSON.stringify([2, msgId, "GetCompositeSchedule", payload]));
        appendLog(`>>> GetCompositeSchedule ${msgId}`);
    }

    return (
        <div className="page">
            {/* Barre de connexion (comme JavaFX) */}
            <div className="card p16 mb16">
                <div className="grid4">
                    <div>
                        <label>URL OCPP :</label>
                        <input
                            value={urlBase}
                            onChange={(e) => setUrlBase(e.target.value)}
                            placeholder="wss://.../ocpp/WebSocket"
                        />
                    </div>
                    <div>
                        <label>CP-ID :</label>
                        <input value={cpId} onChange={(e) => setCpId(e.target.value)} />
                    </div>
                    <div>
                        <label>EvP-ID :</label>
                        <input value={evpId} onChange={(e) => setEvpId(e.target.value)} />
                    </div>
                    <div>
                        <label>Token :</label>
                        <input
                            placeholder="Bearer token (optionnel)"
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                        />
                    </div>
                </div>
                <div className="row mt8">
                    <button className="btn" onClick={connectToggle}>
                        {status === "Déconnecté" ? "Connect" : "Disconnect"}
                    </button>
                    <div className="ml8 muted">{status}</div>
                </div>
            </div>

            {/* Paramétrage du profile */}
            <div className="card p16 mb16">
                <div className="grid6">
                    <div>
                        <label>connectorId</label>
                        <input
                            type="number"
                            value={connectorId}
                            onChange={(e) => setConnectorId(Number(e.target.value))}
                        />
                    </div>
                    <div>
                        <label>profileId</label>
                        <input
                            type="number"
                            value={profileId}
                            onChange={(e) => setProfileId(Number(e.target.value))}
                        />
                    </div>
                    <div>
                        <label>stackLevel</label>
                        <input
                            type="number"
                            value={stackLevel}
                            onChange={(e) => setStackLevel(Number(e.target.value))}
                        />
                    </div>
                    <div>
                        <label>purpose</label>
                        <select
                            value={purpose}
                            onChange={(e) =>
                                setPurpose(e.target.value as typeof purpose)
                            }
                        >
                            <option>TxProfile</option>
                            <option>TxDefaultProfile</option>
                            <option>ChargePointMaxProfile</option>
                        </select>
                    </div>
                    <div>
                        <label>kind</label>
                        <select
                            value={kind}
                            onChange={(e) => setKind(e.target.value as typeof kind)}
                        >
                            <option>Absolute</option>
                            <option>Recurring</option>
                            <option>Relative</option>
                        </select>
                    </div>
                    <div>
                        <label>unit</label>
                        <select value={unit} onChange={(e) => setUnit(e.target.value as any)}>
                            <option>W</option>
                            <option>A</option>
                            <option>Wh</option>
                        </select>
                    </div>

                    <div>
                        <label>validFrom</label>
                        <input
                            type="datetime-local"
                            value={validFrom}
                            onChange={(e) => setValidFrom(e.target.value)}
                        />
                    </div>
                    <div>
                        <label>validTo</label>
                        <input
                            type="datetime-local"
                            value={validTo}
                            onChange={(e) => setValidTo(e.target.value)}
                        />
                    </div>
                    <div>
                        <label>recurrence</label>
                        <select
                            value={recurrence}
                            onChange={(e) => setRecurrence(e.target.value as any)}
                            disabled={kind !== "Recurring"}
                        >
                            <option value="">(aucun)</option>
                            <option value="Daily">Daily</option>
                            <option value="Weekly">Weekly</option>
                        </select>
                    </div>
                </div>

                {/* Ajout de périodes */}
                <div className="row mt12">
                    <label className="mr8">start(s):</label>
                    <input
                        type="number"
                        value={newStart}
                        onChange={(e) => setNewStart(Number(e.target.value))}
                        style={{ width: 120 }}
                    />
                    <label className="ml12 mr8">limit:</label>
                    <input
                        type="number"
                        value={newLimit}
                        onChange={(e) => setNewLimit(Number(e.target.value))}
                        style={{ width: 140 }}
                    />
                    <button className="btn ml12" onClick={addPeriod}>
                        Ajouter période
                    </button>
                    <button className="btn secondary ml8" onClick={removeLast}>
                        Retirer dernière
                    </button>
                    <button className="btn danger ml8" onClick={clearPeriods}>
                        Vider
                    </button>
                </div>

                {periods.length > 0 && (
                    <div className="mt12 surface p12">
                        <table>
                            <thead>
                            <tr>
                                <th>#</th>
                                <th>start(s)</th>
                                <th>limit</th>
                            </tr>
                            </thead>
                            <tbody>
                            {periods.map((p, i) => (
                                <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td>{p.start}</td>
                                    <td>{p.limit}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="row mt12">
                    <button className="btn secondary" onClick={doPreview}>
                        Prévisualiser JSON
                    </button>
                    <button className="btn ml8" onClick={sendSetChargingProfile}>
                        Envoyer OCPP
                    </button>
                    <button className="btn ml8 warning" onClick={sendClearProfile}>
                        CALL OCPP
                    </button>
                    <button className="btn ml8" onClick={sendGetComposite}>
                        Envoyer Central
                    </button>
                </div>
            </div>

            <div className="card p16 mb16">
                <label>Prévisualisation JSON :</label>
                <textarea rows={10} value={preview} readOnly />
            </div>

            <div className="card p16">
                <label>Logs Smart Charging :</label>
                <textarea rows={12} value={log} readOnly />
            </div>
        </div>
    );
}
