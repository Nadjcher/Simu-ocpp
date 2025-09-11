// src/tabs/SimuEvseTab.tsx
// VERSION AMÉLIORÉE - Avec gestion des descriptions TNR

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { SmartChargingPanel } from "@/components/SmartChargingPanel";
import { OCPPChargingProfilesManager } from "@/services/OCPPChargingProfilesManager";

// Configuration API - Compatible avec Vite et Create React App
const API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return "http://localhost:8877";
  }
  return "/api";
})();

// =========================================================================
// Constantes et Types
// =========================================================================

const DEFAULT_VOLTAGE = 230;
const DEFAULT_PHASES: Record<string, number> = {
  "ac-mono": 1,
  "ac-bi": 2,
  "ac-tri": 3,
  dc: 3,
};

const ASSETS = {
  stationAC: "/images/charger-ac.png",
  stationDC: "/images/charger-dc.png",
  genericEV: "/images/generic-ev.png",
  connectors: {
    left: "/images/connecteur vers la droite.png",
    right: "/images/connecteur vers la gauche.png",
  },
};

const EFFICIENCY_DEFAULT = 0.92;
const RAMP_KW_PER_S = 5 / 3;
const NOISE = 0.03;
const MAX_POINTS = 900;
const SOC_CHARGE_MULTIPLIER = 3;
const VEHICLE_SCALE = 1.3;

type LogEntry = { ts: string; line: string };

type SessionItem = {
  id: string;
  cpId: string;
  url: string | null;
  status: "connected" | "booted" | "authorized" | "started" | "stopped" | "closed" | "error";
  txId?: number | null;
  metrics?: {
    stationKwMax?: number;
    backendKwMax?: number;
    txpKw?: number;
    txdpKw?: number;
    voltage?: number;
    phases?: number;
    energyKWh?: number;
  };
};

type MvMask = {
  powerActive: boolean;
  energy: boolean;
  soc: boolean;
  powerOffered: boolean;
};

type Serie = {
  label: string;
  color: string;
  points: Array<{ t: number; y: number }>;
  dash?: string;
  width?: number;
  opacity?: number;
};

type Toast = { id: number; text: string };

// =========================================================================
// Fonctions utilitaires (avant tout usage)
// =========================================================================

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const nowMs = () => Date.now();
const ewma = (prev: number | null, v: number, alpha = 0.25) =>
    prev == null ? v : prev + alpha * (v - prev);
const formatHMS = (s: number) => {
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${ss}`;
};

async function fetchJSON<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...(init || {}),
  });
  const txt = await r.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    return txt as any;
  }
}

async function postAny(paths: string[]) {
  for (const p of paths) {
    try {
      const r = await fetch(`${API_BASE}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

// Services de véhicules
const loadVehicleProfiles = async () => {
  // Charger les profils de véhicules
};

const getAllVehicles = () => [
  { id: "1", name: "Tesla Model 3", capacityKWh: 75, efficiency: 0.95, imageUrl: "/images/tesla-model3 white.png" },
  { id: "2", name: "Renault ZOE", capacityKWh: 52, efficiency: 0.90, imageUrl: "/images/renault-zoe-silver.jpg" },
  { id: "3", name: "Nissan Leaf", capacityKWh: 62, efficiency: 0.88, imageUrl: "/images/generic-ev.png" },
  { id: "4", name: "Hyundai Kona", capacityKWh: 64, efficiency: 0.92, imageUrl: "/images/generic-ev.png" },
  { id: "5", name: "BMW i3", capacityKWh: 42, efficiency: 0.93, imageUrl: "/images/generic-ev.png" },
  { id: "6", name: "Audi e-tron", capacityKWh: 95, efficiency: 0.91, imageUrl: "/images/generic-ev.png" },
  { id: "7", name: "Volkswagen ID.3", capacityKWh: 58, efficiency: 0.90, imageUrl: "/images/generic-ev.png" },
  { id: "8", name: "Peugeot e-208", capacityKWh: 50, efficiency: 0.89, imageUrl: "/images/generic-ev.png" },
  { id: "9", name: "Mercedes EQC", capacityKWh: 80, efficiency: 0.91, imageUrl: "/images/generic-ev.png" },
  { id: "10", name: "Porsche Taycan", capacityKWh: 93, efficiency: 0.94, imageUrl: "/images/generic-ev.png" }
];

const calcVehPowerKW = (vehicleId: string, soc: number) => {
  if (soc < 20) return 50;
  if (soc < 80) return 35;
  return 7;
};

// =========================================================================
// Hook Toasts
// =========================================================================

function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  function push(text: string) {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text }]);
    setTimeout(() => { setItems((x) => x.filter((t) => t.id !== id)); }, 5000);
  }
  return { items, push };
}

// =========================================================================
// Hook TNR AMÉLIORÉ avec description
// =========================================================================

const useTNRWithAPI = (toasts: any, defaultUrl: string) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recName, setRecName] = useState(`record-${Date.now()}`);
  const [recId, setRecId] = useState(`tnr_${Date.now()}`);
  const [recDescription, setRecDescription] = useState(""); // AJOUT: Description
  const [recTags, setRecTags] = useState("");
  const [recBaseline, setRecBaseline] = useState(false);
  const [recEvents, setRecEvents] = useState(0);

  const startRecording = async () => {
    try {
      const tagsArray = recTags
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);

      const response = await fetchJSON("/api/tnr/recorder/start", {
        method: "POST",
        body: JSON.stringify({
          name: recName,
          description: recDescription || `Enregistré depuis Simu EVSE le ${new Date().toLocaleString()}`, // MODIFICATION
          tags: ["simu-evse", ...tagsArray],
          folder: "simu-evse",
          config: {
            url: defaultUrl
          }
        })
      });

      // IMPORTANT: Vérifier le succès plus strictement
      if (response && response.ok !== false && !response.error) {
        setIsRecording(true);
        setRecEvents(0);
        console.log("TNR Recording started:", response);
        toasts?.push("✅ Enregistrement TNR démarré");
        return true;
      } else {
        throw new Error(response?.error || "Erreur démarrage enregistrement");
      }
    } catch (error: any) {
      console.error("Failed to start TNR recording:", error);
      toasts?.push(`❌ Erreur démarrage: ${error.message}`);
      setIsRecording(false);
      return false;
    }
  };

  const stopRecording = async () => {
    // Vérifier d'abord le statut côté serveur
    const serverStatus = await checkRecordingStatus();

    if (!serverStatus?.isRecording && !isRecording) {
      console.warn("TNR: Aucun enregistrement actif");
      toasts?.push("⚠ Aucun enregistrement en cours");
      return false;
    }

    try {
      const tagsArray = recTags
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);

      const timestamp = Date.now();
      const uniqueId = `tnr_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
      const uniqueName = recName || `Scenario_${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}`;

      console.log(`[TNR] Stopping recording with ID: ${uniqueId}, Name: ${uniqueName}`);

      const response = await fetchJSON("/api/tnr/recorder/stop", {
        method: "POST",
        body: JSON.stringify({
          id: uniqueId,
          name: uniqueName,
          description: recDescription || `Enregistré depuis Simu EVSE le ${new Date().toLocaleString()}`,
          tags: ["simu-evse", ...tagsArray],
          folder: "simu-evse",
          baseline: recBaseline
        })
      });

      console.log(`[TNR] Stop response:`, response);

      // Vérifier la réponse plus strictement
      if (response && response.ok !== false && !response.error) {
        setIsRecording(false);
        const savedId = response.id || uniqueId;
        console.log("TNR Recording saved:", savedId);
        toasts?.push(`✅ Scénario sauvegardé: ${savedId}`);

        // Réinitialiser pour le prochain enregistrement
        const nextTimestamp = Date.now();
        setRecName(`record-${nextTimestamp}`);
        setRecId(`tnr_${nextTimestamp}`);
        setRecDescription("");
        setRecEvents(0);
        setRecTags("");
        setRecBaseline(false);

        // Notifier l'onglet TNR
        window.dispatchEvent(new CustomEvent('tnr-scenario-saved', {
          detail: {
            id: savedId,
            name: uniqueName,
            description: recDescription
          }
        }));

        return true;
      } else {
        throw new Error(response?.error || response?.message || "Erreur arrêt enregistrement");
      }
    } catch (error: any) {
      console.error("Failed to stop TNR recording:", error);

      // Force reset de l'état local en cas d'erreur
      setIsRecording(false);

      if (error.message?.includes("not recording")) {
        toasts?.push("⚠ Pas d'enregistrement actif côté serveur");
      } else {
        toasts?.push(`❌ Erreur sauvegarde: ${error.message}`);
      }

      return false;
    }
  };

  const tapEvent = async (type: string, action: string, payload: any, sessionId?: string) => {
    if (!isRecording) {
      console.debug("TNR: tapEvent ignoré car pas d'enregistrement actif");
      return false;
    }

    try {
      const response = await fetchJSON("/api/tnr/tap", {
        method: "POST",
        body: JSON.stringify({
          type,
          action,
          sessionId: sessionId || "unknown",
          payload: payload || {},
          timestamp: Date.now()
        })
      });

      // Vérifier si le tap a réussi
      if (response && response.ok !== false) {
        setRecEvents(e => e + 1);
        console.debug(`TNR: Event tapped - ${type}/${action}`, payload);
        return true;
      } else {
        console.warn("TNR: tap event failed", response);
        return false;
      }
    } catch (error) {
      console.error("Failed to tap event:", error);
      return false;
    }
  };

  // Ajouter une fonction pour vérifier l'état
  const checkRecordingStatus = async () => {
    try {
      const status = await fetchJSON("/api/tnr/status");
      if (status.isRecording !== isRecording) {
        console.warn(`TNR: État désynchronisé - local:${isRecording}, serveur:${status.isRecording}`);
        setIsRecording(status.isRecording);
      }
      return status;
    } catch (error) {
      console.error("Failed to check TNR status:", error);
      return null;
    }
  };

  return {
    isRecording,
    recName,
    recId,
    recDescription, // AJOUT: Exposer la description
    recTags,
    recBaseline,
    recEvents,
    setRecName,
    setRecId,
    setRecDescription, // AJOUT: Exposer le setter
    setRecTags,
    setRecBaseline,
    startRecording,
    stopRecording,
    tapEvent,
    checkRecordingStatus
  };
};

// =========================================================================
// Composant TNRBandeau AMÉLIORÉ
// =========================================================================

const TNRBandeau = ({ tnr, onOpenTNR }: any) => (
    <div className="rounded border bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="font-semibold">TNR Recording</div>
          <div className="text-xs text-slate-600">
            (Test & Replay - Enregistrement de scénarios OCPP)
          </div>
          {tnr.isRecording && (
              <div className="ml-4 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600" />
                </span>
                <span className="text-sm font-medium text-rose-600">
                  REC • {tnr.recEvents} events
                </span>
              </div>
          )}
        </div>
        <button
            className="px-3 py-2 bg-slate-100 rounded hover:bg-slate-200 text-sm"
            onClick={onOpenTNR}
        >
          Ouvrir TNR
        </button>
      </div>

      <div className="mt-3 grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <div className="text-xs mb-1 text-slate-600">Nom du scénario</div>
          <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={tnr.recName}
              onChange={(e) => tnr.setRecName(e.target.value)}
              disabled={tnr.isRecording}
              placeholder="Ex: Test_Charge_Complete"
          />
        </div>

        <div className="col-span-3">
          <div className="text-xs mb-1 text-slate-600">Tags (séparés par virgule)</div>
          <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={tnr.recTags}
              onChange={(e) => tnr.setRecTags(e.target.value)}
              disabled={tnr.isRecording}
              placeholder="test, charge, ac"
          />
        </div>

        <label className="col-span-1 text-sm inline-flex items-center gap-2">
          <input
              type="checkbox"
              checked={tnr.recBaseline}
              onChange={(e) => tnr.setRecBaseline(e.target.checked)}
              disabled={tnr.isRecording}
          />
          <span className="text-xs">Baseline</span>
        </label>

        <div className="col-span-1 text-right">
          {!tnr.isRecording ? (
              <button
                  className="px-3 py-2 bg-rose-600 text-white rounded hover:bg-rose-700 transition-colors w-full font-medium text-sm"
                  onClick={async () => {
                    const success = await tnr.startRecording();
                    if (!success) {
                      console.error("TNR: Échec du démarrage de l'enregistrement");
                    }
                  }}
              >
                ● Start
              </button>
          ) : (
              <button
                  className="px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors w-full font-medium text-sm animate-pulse"
                  onClick={async () => {
                    const success = await tnr.stopRecording();
                    if (!success) {
                      console.error("TNR: Échec de l'arrêt de l'enregistrement");
                    }
                  }}
              >
                ■ Stop & Save
              </button>
          )}
        </div>
      </div>

      {/* AJOUT: Champ description en dessous */}
      <div className="mt-2">
        <div className="text-xs mb-1 text-slate-600">Description du scénario (optionnel)</div>
        <textarea
            className="w-full border rounded px-2 py-1 text-sm"
            value={tnr.recDescription}
            onChange={(e) => tnr.setRecDescription(e.target.value)}
            disabled={tnr.isRecording}
            placeholder="Décrivez le scénario de test..."
            rows={2}
            style={{ resize: 'vertical', minHeight: '40px' }}
        />
      </div>

      {tnr.isRecording && (
          <div className="mt-2 p-2 bg-rose-50 rounded-lg border border-rose-200">
            <div className="text-xs text-rose-700">
              🔴 Enregistrement en cours... Toutes les actions OCPP sont capturées.
            </div>
          </div>
      )}
    </div>
);

// =========================================================================
// Styles
// =========================================================================

const extraCSS = `
@keyframes cableEnergy {
  from { stroke-dashoffset: 0 }
  to   { stroke-dashoffset: -80 }
}
@keyframes charging-pulse {
  0%, 100% { opacity: .6; transform: scale(1); }
  50%      { opacity: 1;  transform: scale(1.05); }
}
@keyframes connector-glow {
  0%, 100% { filter: drop-shadow(0 0 8px rgba(16,185,129,.9)); }
  50%      { filter: drop-shadow(0 0 16px rgba(16,185,129,1)); }
}
`;

// =========================================================================
// Composants auxiliaires (déclarés avant usage)
// =========================================================================

const ChargingProfileCard: React.FC<{
  profilesManager: OCPPChargingProfilesManager;
  connectorId: number;
}> = ({ profilesManager, connectorId }) => {
  const [state, setState] = useState({
    limitW: 0,
    source: 'default' as string,
    profiles: [] as any[]
  });

  useEffect(() => {
    const update = () => {
      const connectorState = profilesManager.getConnectorState(connectorId);
      setState({
        limitW: connectorState.effectiveLimit.limitW,
        source: connectorState.effectiveLimit.source === 'profile'
            ? connectorState.effectiveLimit.purpose
            : 'Limite Physique',
        profiles: connectorState.profiles
      });
    };

    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [profilesManager, connectorId]);

  return (
      <div className="rounded-lg border border-emerald-500 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-lg">
        <div className="text-sm font-bold text-emerald-700 mb-3">
          Charging Profiles OCPP 1.6
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-gray-600 mb-1">Limite active:</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-gray-900">
                {(state.limitW / 1000).toFixed(1)} kW
              </span>
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-600 mb-1">Source:</div>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                state.source === 'Limite Physique'
                    ? 'bg-amber-100 text-amber-800'
                    : state.source === 'TxProfile'
                        ? 'bg-green-100 text-green-800'
                        : state.source === 'TxDefaultProfile'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-800'
            }`}>
              {state.source}
            </span>
          </div>

          {state.profiles.length > 0 && (
              <div className="pt-2 border-t border-emerald-200">
                <div className="text-xs text-gray-600 mb-1">Profils actifs:</div>
                {state.profiles.map((p: any) => (
                    <div key={p.chargingProfileId} className="text-xs text-gray-700">
                      • #{p.chargingProfileId} - {p.chargingProfilePurpose} (Stack: {p.stackLevel})
                    </div>
                ))}
              </div>
          )}
        </div>
      </div>
  );
};

function ChargeDisplay({
                         soc,
                         powerKw,
                         energyKWh,
                         elapsedTime,
                         isCharging,
                       }: {
  soc: number;
  powerKw: number;
  energyKWh: number;
  elapsedTime: string;
  isCharging: boolean;
}) {
  const strokeDasharray = `${(soc / 100) * 251.2}, 251.2`;

  return (
      <div
          className="absolute rounded-xl px-4 py-3
                bg-white/95 backdrop-blur-md border-2 border-slate-300 shadow-2xl select-none"
          style={{ minWidth: 280, zIndex: 60 }}
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <svg width="84" height="84" viewBox="0 0 90 90">
              <circle
                  cx="45"
                  cy="45"
                  r="40"
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="8"
              />
              <circle
                  cx="45"
                  cy="45"
                  r="40"
                  fill="none"
                  stroke={soc > 80 ? "#10b981" : soc > 20 ? "#3b82f6" : "#ef4444"}
                  strokeWidth="8"
                  strokeDasharray={strokeDasharray}
                  strokeLinecap="round"
                  transform="rotate(-90 45 45)"
                  style={{ transition: "stroke-dasharray .35s ease" }}
              />
              <text
                  x="45"
                  y="45"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-slate-900"
              >
                <tspan fontSize="20" fontWeight="bold">
                  {Math.round(soc)}
                </tspan>
                <tspan fontSize="12" dy="12" x="45">
                  %
                </tspan>
              </text>
            </svg>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-slate-900">
                {powerKw.toFixed(1)}
              </span>
              <span className="text-sm text-slate-600">kW</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-semibold text-slate-700">
                {energyKWh.toFixed(2)}
              </span>
              <span className="text-sm text-slate-500">kWh</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <span className="font-mono">{elapsedTime}</span>
              {isCharging && powerKw > 0.1 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 animate-[charging-pulse_2s_ease-in-out_infinite]">
                    en charge
                  </span>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}

function Chart({
                 series,
                 yMax,
                 height = 300,
                 xLabel,
                 yLabel,
                 refLines,
               }: {
  series: Serie[];
  yMax: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  refLines?: Array<{ value: number; label: string; color: string }>;
}) {
  const [hover, setHover] = useState<{
    x: number;
    vals: { label: string; y: number; color: string }[];
  } | null>(null);

  const boxRef = React.useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  const H = height;
  const pad = 48;

  useEffect(() => {
    const update = () => {
      const w = boxRef.current?.clientWidth || 560;
      setW(Math.max(480, Math.floor(w)));
    };
    update();
    const ro = new ResizeObserver(update);
    if (boxRef.current) ro.observe(boxRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const all = series.flatMap((s) => s.points);
  const tmin = all.length ? Math.min(...all.map((p) => p.t)) : 0;
  const tmax = all.length ? Math.max(...all.map((p) => p.t)) : 1;

  const xOf = (t: number) =>
      pad + ((t - tmin) / Math.max(1, tmax - tmin)) * (W - pad * 2);
  const yOf = (y: number) =>
      H - pad - (clamp(y, 0, yMax) / Math.max(1, yMax)) * (H - pad * 2);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.target as SVGElement)
        .closest("svg")!
        .getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tGuess =
        tmin +
        ((x - pad) / Math.max(1, W - pad * 2)) * Math.max(1, tmax - tmin);

    const vals = series.map((s) => {
      let best = s.points[0];
      let d = Infinity;
      for (const p of s.points) {
        const dd = Math.abs(p.t - tGuess);
        if (dd < d) {
          d = dd;
          best = p;
        }
      }
      return { label: s.label, y: best?.y ?? 0, color: s.color };
    });
    setHover({ x: clamp(x, pad, W - pad), vals });
  }

  const gridLines = [];
  const numLines = 6;
  for (let i = 0; i <= numLines; i++) {
    const yPos = H - pad - (i / numLines) * (H - pad * 2);
    const value = (i / numLines) * yMax;
    gridLines.push(
        <g key={`grid-${i}`}>
          <line
              x1={pad}
              y1={yPos}
              x2={W - pad}
              y2={yPos}
              stroke={i === 0 ? "#374151" : "#e5e7eb"}
              strokeWidth={i === 0 ? 2 : 1}
              strokeDasharray={i === 0 ? "0" : "2 2"}
          />
          <text
              x={pad - 8}
              y={yPos + 4}
              fill="#64748b"
              fontSize="11"
              textAnchor="end"
              fontWeight={i === 0 ? "bold" : "normal"}
          >
            {value.toFixed(0)}
          </text>
        </g>
    );
  }

  return (
      <div ref={boxRef} className="relative w-full">
        <svg
            width={W}
            height={H}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            className="bg-gradient-to-br from-white to-slate-50 rounded-lg border border-slate-200"
        >
          <defs>
            {series.map((s, i) => (
                <linearGradient
                    key={`grad-${i}`}
                    id={`grad-${i}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                >
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
                </linearGradient>
            ))}
          </defs>

          {refLines?.map((ref, i) => (
              <g key={`ref-${i}`}>
                <line
                    x1={pad}
                    y1={yOf(ref.value)}
                    x2={W - pad}
                    y2={yOf(ref.value)}
                    stroke={ref.color}
                    strokeWidth={2}
                    strokeDasharray="8 4"
                    opacity={0.6}
                />
                <rect
                    x={W - pad - 64}
                    y={yOf(ref.value) - 10}
                    width={60}
                    height={18}
                    fill="white"
                    opacity={0.9}
                    rx={3}
                />
                <text
                    x={W - pad - 34}
                    y={yOf(ref.value) + 2}
                    fill={ref.color}
                    fontSize="10"
                    textAnchor="middle"
                    fontWeight="bold"
                >
                  {ref.label}
                </text>
              </g>
          ))}

          {gridLines}

          <line
              x1={pad}
              y1={pad}
              x2={pad}
              y2={H - pad}
              stroke="#374151"
              strokeWidth={2}
          />
          <line
              x1={pad}
              y1={H - pad}
              x2={W - pad}
              y2={H - pad}
              stroke="#374151"
              strokeWidth={2}
          />

          {yLabel && (
              <text
                  x={12}
                  y={H / 2}
                  fill="#374151"
                  fontSize="12"
                  fontWeight="bold"
                  transform={`rotate(-90, 12, ${H / 2})`}
                  textAnchor="middle"
              >
                {yLabel}
              </text>
          )}
          {xLabel && (
              <text
                  x={W / 2}
                  y={H - 8}
                  fill="#374151"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
              >
                {xLabel}
              </text>
          )}

          {series.map((s, i) => {
            const pathD = s.points
                .map((p) => `${xOf(p.t)},${yOf(p.y)}`)
                .join(" ");
            const areaD =
                s.points.length > 1
                    ? `M ${xOf(s.points[0].t)},${yOf(0)} L ${pathD} L ${xOf(
                        s.points[s.points.length - 1].t
                    )},${yOf(0)} Z`
                    : "";

            return (
                <g key={i}>
                  {!s.dash && areaD && (
                      <path d={areaD} fill={`url(#grad-${i})`} opacity={0.2} />
                  )}
                  <polyline
                      fill="none"
                      stroke={s.color}
                      strokeWidth={s.width ?? 2.5}
                      strokeDasharray={s.dash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={s.opacity ?? 1}
                      points={pathD}
                  />
                </g>
            );
          })}

          {hover && (
              <>
                <line
                    x1={hover.x}
                    y1={pad}
                    x2={hover.x}
                    y2={H - pad}
                    stroke="#6b7280"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                />
                {hover.vals.map((v, i) => (
                    <circle
                        key={i}
                        cx={hover.x}
                        cy={yOf(v.y)}
                        r={4}
                        fill={v.color}
                        stroke="white"
                        strokeWidth={2}
                    />
                ))}
              </>
          )}
        </svg>

        {hover && (
            <div
                className="absolute bg-white border border-slate-200 rounded-lg shadow-xl px-3 py-2"
                style={{ left: Math.min(hover.x + 10, W - 130), top: 10 }}
            >
              {hover.vals.map((v) => (
                  <div key={v.label} className="flex items-center gap-2">
                    <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: v.color }}
                    />
                    <span className="text-xs text-slate-600">{v.label}:</span>
                    <span className="text-sm font-bold">
                      {v.y.toFixed(2)} {v.label.includes("SoC") ? "%" : "kW"}
                    </span>
                  </div>
              ))}
            </div>
        )}
      </div>
  );
}

function Connector({
                     side,
                     glowing = false,
                     size = 220,
                     rotation = 0,
                   }: {
  side: "left" | "right";
  glowing?: boolean;
  size?: number;
  rotation?: number;
}) {
  const src = side === "left" ? ASSETS.connectors.left : ASSETS.connectors.right;
  const [imageError, setImageError] = useState(false);

  return (
      <div
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            width: size,
            height: size,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            zIndex: 60,
          }}
      >
        {!imageError ? (
            <img
                src={src}
                alt={`Connecteur ${side}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  filter: glowing
                      ? "drop-shadow(0 0 18px rgba(16,185,129,.85))"
                      : "drop-shadow(0 1px 6px rgba(0,0,0,.35))",
                }}
                onError={() => {
                  console.error(`Image non trouvée: ${src}`);
                  setImageError(true);
                }}
            />
        ) : (
            <div
                className="w-full h-full rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: glowing ? "#10b981" : "#6b7280",
                  opacity: glowing ? 0.9 : 0.6,
                  boxShadow: glowing
                      ? "0 0 20px rgba(16,185,129,0.8)"
                      : "0 2px 4px rgba(0,0,0,0.2)",
                }}
            >
              <span style={{
                color: "white",
                fontSize: size * 0.3,
                fontWeight: "bold"
              }}>
                {side === "left" ? "◀" : "▶"}
              </span>
            </div>
        )}
      </div>
  );
}

function Cable({
                 containerRef,
                 startRef,
                 endRef,
                 show,
                 charging,
                 sagFactor = 0.48,
                 extraDropPx = 10,
                 onAnglesChange,
               }: {
  containerRef: React.RefObject<HTMLDivElement>;
  startRef: React.RefObject<HTMLDivElement>;
  endRef: React.RefObject<HTMLDivElement>;
  show: boolean;
  charging: boolean;
  sagFactor?: number;
  extraDropPx?: number;
  onAnglesChange?: (angles: { left: number; right: number }) => void;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0, d: "" });
  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  const [dashOffset, setDashOffset] = useState(0);

  useEffect(() => {
    if (!show) return;

    const update = () => {
      const cont = containerRef.current;
      const a = startRef.current;
      const b = endRef.current;
      if (!cont || !a || !b) return;

      const r = cont.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();

      const x1 = ra.left + ra.width / 2 - r.left;
      const y1 = ra.top + ra.height / 2 - r.top;
      const x2 = rb.left + rb.width / 2 - r.left;
      const y2 = rb.top + rb.height / 2 - r.top;

      const dx = Math.abs(x2 - x1);
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const sag = clamp(dist * sagFactor, 60, 220);
      const cx1 = x1 + dx * 0.28, cy1 = y1 + sag + extraDropPx;
      const cx2 = x2 - dx * 0.28, cy2 = y2 + sag * 0.85 + extraDropPx;

      const leftAngle = (Math.atan2(cy1 - y1, cx1 - x1) * 180) / Math.PI;
      const rightAngle = (Math.atan2(y2 - cy2, x2 - cx2) * 180) / Math.PI;
      onAnglesChange?.({ left: leftAngle, right: rightAngle });

      const d = `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
      setDims({ w: r.width, h: r.height, d });

      requestAnimationFrame(() => {
        const p = pathRef.current;
        if (!p) return;
        const L = p.getTotalLength();
        setLen(L);
        setDashOffset(L);
        requestAnimationFrame(() => setDashOffset(0));
      });
    };

    update();
    const int = setInterval(update, 500);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(int);
      window.removeEventListener("resize", update);
    };
  }, [containerRef, startRef, endRef, show, sagFactor, extraDropPx, onAnglesChange]);

  if (!show) return null;

  return (
      <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${Math.max(1, dims.w)} ${Math.max(1, dims.h)}`}
          style={{ position: "absolute", inset: 0, zIndex: 40 }}
      >
        <defs>
          <filter id="cable-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dx="0" dy="4" result="offsetblur" />
            <feFlood floodColor="rgba(0,0,0,0.25)" />
            <feComposite in2="offsetblur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {charging && (
              <linearGradient id="energy-flow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
          )}
        </defs>

        <path
            ref={pathRef}
            d={dims.d}
            stroke="#0f172a"
            strokeWidth={18}
            strokeLinecap="round"
            fill="none"
            filter="url(#cable-shadow)"
            style={{
              strokeDasharray: len,
              strokeDashoffset: dashOffset,
              transition:
                  "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
        />

        {charging && (
            <path
                d={dims.d}
                stroke="url(#energy-flow)"
                strokeWidth={6}
                strokeLinecap="round"
                fill="none"
                strokeDasharray="12 20"
                style={{ animation: "cableEnergy 1.5s linear infinite" }}
            />
        )}
      </svg>
  );
}

// =========================================================================
// Composant principal SimuEvseTab
// =========================================================================

export default function SimuEvseTab() {
  // ========= 1. HOOKS DE BASE =========
  const toasts = useToasts();

  // ========= 2. ÉTATS NÉCESSAIRES POUR TNR =========
  const [cpUrl, setCpUrl] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");

  // ========= 3. HOOK TNR (après toasts et cpUrl) =========
  const tnr = useTNRWithAPI(toasts, cpUrl);

  // ========= 4. AUTRES ÉTATS =========
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [cpId, setCpId] = useState("POP-REGULATION-TEST-TOMY2");
  const [idTag, setIdTag] = useState<string>("");

  const [evseType, setEvseType] = useState<"ac-mono" | "ac-bi" | "ac-tri" | "dc">("ac-mono");
  const [maxA, setMaxA] = useState<number>(32);

  const [vehicles, setVehicles] = useState<Array<{
    id: string;
    name?: string;
    manufacturer?: string;
    model?: string;
    variant?: string;
    capacityKWh: number;
    efficiency?: number;
    imageUrl?: string;
  }>>([]);
  const [vehicleId, setVehicleId] = useState<string>("");

  const [mvEvery, setMvEvery] = useState<number>(10);
  const [mvMask, setMvMask] = useState<MvMask>({
    powerActive: true,
    energy: true,
    soc: true,
    powerOffered: true,
  });
  const [socStart, setSocStart] = useState<number>(20);
  const [socTarget, setSocTarget] = useState<number>(80);
  const [mvRunning, setMvRunning] = useState(false);

  const [priceToken, setPriceToken] = useState<string>("");
  const [priceApiUrl, setPriceApiUrl] = useState<string>("https://evplatform.evcharge-pp.totalenergies.com/evportal/api/tx");
  const [priceData, setPriceData] = useState<any | null>(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [showPriceConfig, setShowPriceConfig] = useState(false);

  const [series, setSeries] = useState<{
    soc: Array<{ t: number; y: number }>;
    pActive: Array<{ t: number; y: number }>;
    expected: Array<{ t: number; y: number }>;
  }>({ soc: [], pActive: [], expected: [] });

  const [ackStats, setAckStats] = useState<{
    sent: number;
    ack: number;
    rate: number;
  }>({ sent: 0, ack: 0, rate: 1 });

  const [showCable, setShowCable] = useState(true);
  const [isParked, setIsParked] = useState(false);
  const [isPlugged, setIsPlugged] = useState(false);
  const [connAngles, setConnAngles] = useState<{ left: number; right: number }>({
    left: 0,
    right: 0,
  });

  // ========= 5. REFS =========
  const lastMvTapRef = useRef<number>(0);
  const energyStartKWhRef = useRef<number | null>(null);
  const energyNowKWhRef = useRef<number | null>(null);
  const energyFromPowerKWhRef = useRef<number>(0);
  const lastPowerMsRef = useRef<number | null>(null);
  const chargeStartTimeRef = useRef<number | null>(null);
  const pActiveFiltRef = useRef<number | null>(null);
  const socFiltRef = useRef<number | null>(20);
  const lastRealMvMsRef = useRef<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const stationRef = useRef<HTMLDivElement>(null);
  const stationPortRef = useRef<HTMLDivElement>(null);
  const carRef = useRef<HTMLDivElement>(null);
  const carPortRef = useRef<HTMLDivElement>(null);

  // ========= 6. VARIABLES DÉRIVÉES (qui dépendent des états) =========
  const selSession = sessions.find((s) => s.id === selId) || null;
  const isCharging = selSession?.status === "started";
  const voltage = selSession?.metrics?.voltage || DEFAULT_VOLTAGE;
  const phases = selSession?.metrics?.phases || DEFAULT_PHASES[evseType] || 1;
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) || undefined;
  const vehicleCapacityKWh = selectedVehicle?.capacityKWh ?? 60;
  const vehicleEfficiency = selectedVehicle?.efficiency ?? EFFICIENCY_DEFAULT;
  const vehicleImage = selectedVehicle?.imageUrl || ASSETS.genericEV;
  const currentSoc = socFiltRef.current ?? socStart;
  const currentPowerKw = pActiveFiltRef.current ?? 0;

  // ========= 7. FONCTIONS CALLBACK (utilisées dans le gestionnaire) =========
  const vehMaxKwAtSoc = useCallback((soc: number): number => {
    if (!vehicleId) return 22;
    const kw = calcVehPowerKW(vehicleId, soc);
    return Number.isFinite(kw) ? Math.max(0, kw) : 22;
  }, [vehicleId]);

  const clampRamp = useCallback((prev: number, target: number, dtSec: number) => {
    const maxStep = RAMP_KW_PER_S * dtSec;
    return prev + Math.max(-maxStep, Math.min(maxStep, target - prev));
  }, []);

  // ========= 8. GESTIONNAIRE OCPP (qui peut maintenant utiliser toasts) =========
  const [profilesManager] = useState(
      () =>
          new OCPPChargingProfilesManager({
            maxPowerW: 22000,
            defaultVoltage: DEFAULT_VOLTAGE,
            defaultPhases: DEFAULT_PHASES["ac-mono"],
            onLimitChange: (_connectorId: number, limitW: number, source: any) => {
              const limitKw = limitW / 1000;
              // Utilisation différée pour éviter les problèmes de closure
              setTimeout(() => {
                toasts.push(`SCP • ${source.purpose} → ${limitKw.toFixed(1)} kW`);
                setSeries(s => ({ ...s }));
              }, 0);
            },
            onProfileChange: (_event: any) => {
              console.log("Profile change:", _event);
              setSeries(s => ({ ...s }));
            },
          })
  );

  const profileState = profilesManager.getConnectorState(1);

  // ========= 9. CALCULS USEMEMO (peuvent maintenant utiliser vehMaxKwAtSoc) =========
  const physicalLimitKw = useMemo(() => {
    const evseKw = (maxA * voltage * phases) / 1000;
    return evseKw;
  }, [maxA, voltage, phases]);

  const appliedLimitKw = useMemo(() => {
    const profileLimitKw = profileState.effectiveLimit.limitW / 1000;
    if (profileState.effectiveLimit.source === "profile") {
      return Math.min(profileLimitKw, physicalLimitKw);
    }
    return physicalLimitKw;
  }, [physicalLimitKw, profileState]);

  const effectivePowerLimit = useMemo(() => {
    const currentSoc = socFiltRef.current ?? socStart;
    const vehKw = vehMaxKwAtSoc(currentSoc);
    const stationKw = selSession?.metrics?.stationKwMax ?? Infinity;
    const backendKw = selSession?.metrics?.backendKwMax ?? Infinity;
    return Math.min(appliedLimitKw, vehKw, stationKw, backendKw);
  }, [appliedLimitKw, vehMaxKwAtSoc, socStart, selSession]);

  const totalEnergyKWh = useMemo(() => {
    if (energyNowKWhRef.current != null && energyStartKWhRef.current != null) {
      return Math.max(0, energyNowKWhRef.current - energyStartKWhRef.current);
    }
    return energyFromPowerKWhRef.current;
  }, [series.pActive, series.soc]);

  const elapsedTime = useMemo(() => {
    if (!chargeStartTimeRef.current || selSession?.status !== "started")
      return "00:00:00";
    const elapsed = Math.floor((Date.now() - chargeStartTimeRef.current) / 1000);
    return formatHMS(elapsed);
  }, [selSession?.status, series.pActive]);

  // ========= 10. FONCTIONS ACTIONS =========
  async function refreshSessions() {
    try {
      const list: SessionItem[] = await fetchJSON(`/api/simu`);
      setSessions(list);
      if (!selId && list.length) setSelId(list[0].id);
      if (selId && !list.some((s) => s.id === selId))
        setSelId(list[0]?.id || null);
    } catch {}
  }

  async function saveTokenConfig() {
    try {
      await fetchJSON("/api/config/price-token", {
        method: "POST",
        body: JSON.stringify({
          token: priceToken,
          url: priceApiUrl,
        }),
      });
      toasts.push("Configuration du token sauvegardée");
    } catch (error: any) {
      toasts.push(`Erreur: ${error.message}`);
    }
  }

  async function fetchPrice() {
    if (!selId) {
      toasts.push("Aucune session sélectionnée");
      return;
    }

    setFetchingPrice(true);
    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };

      if (priceToken) {
        headers["x-price-token"] = priceToken;
      }

      const data = await fetchJSON<typeof priceData>(
          `/api/simu/${selId}/price`,
          {
            method: "GET",
            headers,
          }
      );

      setPriceData(data);

      if (data?.source === "api") {
        toasts.push(`Prix récupéré depuis l'API`);
      } else if (data?.source === "no_token") {
        toasts.push(`Pas de token configuré - prix à 0`);
      } else if (data?.source === "not_found") {
        toasts.push(`Transaction non trouvée - prix à 0`);
      } else {
        toasts.push(`Prix calculé avec fallback`);
      }
    } catch (error: any) {
      toasts.push(`Erreur récupération prix: ${error.message}`);
      setPriceData(null);
    } finally {
      setFetchingPrice(false);
    }
  }

  async function callEither(
      paths: string[],
      tap: { type: string; action: string; payload?: any }
  ) {
    if (!selId) return;
    const ok = await postAny(paths);
    if (ok) await tnr.tapEvent(tap.type, tap.action, tap.payload || {}, selId);
    refreshSessions();
  }

  async function onConnect() {
    const fullUrl = cpUrl.endsWith(`/${cpId}`) ? cpUrl : `${cpUrl}/${cpId}`;
    const tagToUse = idTag.trim() || "TAG-001";

    try {
      const res = await fetchJSON<any>("/api/simu/session", {
        method: "POST",
        body: JSON.stringify({
          url: fullUrl,
          cpId,
          idTag: tagToUse,
          auto: false,
          evseType,
          maxA,
        }),
      });

      if (res?.id) {
        setSelId(res.id);
        await postAny([
          `/api/simu/${res.id}/mv-mask`,
          `/api/simu/${res.id}/status/mv-mask`,
        ]);
        await fetchJSON(`/api/simu/${res.id}/status/mv-mask`, {
          method: "POST",
          body: JSON.stringify({
            mvMask,
            mvEverySec: mvEvery,
            socStart,
            socTarget,
            evseType,
            maxA,
          }),
        }).catch(() => {});
        await tnr.tapEvent(
            "session",
            "CONNECT",
            { url: fullUrl, cpId, idTag: tagToUse, evseType, maxA },
            res.id
        );
      } else {
        alert("Erreur CONNECT");
      }
    } catch (e: any) {
      alert(e?.message || "Erreur CONNECT");
    } finally {
      refreshSessions();
    }
  }

  async function onNewSession() {
    const newCpId = prompt("Entrez le CP-ID pour la nouvelle session:", `TEST-CP-${Date.now()}`);
    if (!newCpId) return;

    const fullUrl = cpUrl.endsWith(`/${newCpId}`) ? cpUrl : `${cpUrl}/${newCpId}`;
    try {
      const res = await fetchJSON<any>("/api/simu/session", {
        method: "POST",
        body: JSON.stringify({
          url: fullUrl,
          cpId: newCpId,
          idTag: "TAG-001",
          auto: false,
          evseType,
          maxA,
        }),
      });
      if (res?.id) {
        setCpId(newCpId);
        setSelId(res.id);
        toasts.push(`Nouvelle session créée: ${newCpId}`);
        await tnr.tapEvent(
            "session",
            "NEW_SESSION",
            { url: fullUrl, cpId: newCpId, idTag: "TAG-001", evseType, maxA },
            res.id
        );
      }
    } catch (e: any) {
      alert(e?.message || "Erreur création session");
    } finally {
      refreshSessions();
    }
  }

  async function onDisconnect() {
    if (!selId) return;
    try {
      await fetchJSON(`/api/simu/${selId}`, { method: "DELETE" });
      await tnr.tapEvent("session", "DISCONNECT", { id: selId }, selId);
    } finally {
      setSelId(null);
      setLogs([]);
      setSeries({ soc: [], pActive: [], expected: [] });
      setMvRunning(false);
      setIsParked(false);
      setIsPlugged(false);
      profilesManager.reset();
      energyStartKWhRef.current = null;
      energyNowKWhRef.current = null;
      energyFromPowerKWhRef.current = 0;
      lastPowerMsRef.current = null;
      socFiltRef.current = socStart;
      pActiveFiltRef.current = null;
      lastRealMvMsRef.current = 0;
    }
  }

  const onPark = async () =>
      callEither(
          [`/api/simu/${selId}/park`, `/api/simu/${selId}/status/park`],
          { type: "session", action: "PARK" }
      ).then(() => setIsParked(true));

  const onPlug = async () =>
      callEither(
          [`/api/simu/${selId}/plug`, `/api/simu/${selId}/status/plug`],
          { type: "session", action: "PLUG" }
      ).then(() => setIsPlugged(true));

  const onUnplug = async () => {
    if (!selId) return;
    if (isCharging) {
      alert("Arrête la charge avant de débrancher le câble.");
      return;
    }
    await callEither(
        [`/api/simu/${selId}/unplug`, `/api/simu/${selId}/status/unplug`],
        { type: "session", action: "UNPLUG" }
    );
    setIsPlugged(false);
  };

  const onLeave = async () => {
    if (!selId) return;
    if (isCharging) {
      alert("Impossible de partir : charge en cours. Arrête d'abord la charge.");
      return;
    }
    if (isPlugged) {
      alert("Impossible de partir : câble branché. Débranche d'abord.");
      return;
    }
    await callEither(
        [`/api/simu/${selId}/leave`, `/api/simu/${selId}/status/unpark`],
        { type: "session", action: "LEAVE" }
    );
    setIsParked(false);
    setIsPlugged(false);
  };

  const onAuth = async () => {
    if (!selId) return;
    const tagToUse = idTag.trim() || "TAG-001";
    await fetchJSON(`/api/simu/${selId}/authorize`, {
      method: "POST",
      body: JSON.stringify({ idTag: tagToUse }),
    });
    await tnr.tapEvent("session", "Authorize", { idTag: tagToUse }, selId);
  };

  const onStart = async () => {
    if (!selId) return;
    profilesManager.markTransactionStart(1);
    await fetchJSON(`/api/simu/${selId}/startTx`, {
      method: "POST",
      body: JSON.stringify({ connectorId: 1 }),
    });
    await fetchJSON(`/api/simu/${selId}/mv/start`, {
      method: "POST",
      body: JSON.stringify({ periodSec: mvEvery }),
    }).catch(() => {});
    setMvRunning(true);
    chargeStartTimeRef.current = Date.now();
    energyStartKWhRef.current = null;
    energyNowKWhRef.current = null;
    energyFromPowerKWhRef.current = 0;
    lastPowerMsRef.current = null;
    await tnr.tapEvent(
        "session",
        "StartTransaction",
        { connectorId: 1, mvEvery },
        selId
    );
  };

  const onStop = async () => {
    if (!selId) return;
    profilesManager.markTransactionStop(1);
    await fetchJSON(`/api/simu/${selId}/mv/stop`, { method: "POST" }).catch(
        () => {}
    );
    await fetchJSON(`/api/simu/${selId}/stopTx`, { method: "POST" });
    setMvRunning(false);
    await tnr.tapEvent("session", "StopTransaction", {}, selId);
  };

  const onApplyMv = async () => {
    if (!selId) return;
    await fetchJSON(`/api/simu/${selId}/status/mv-mask`, {
      method: "POST",
      body: JSON.stringify({
        mvMask,
        mvEverySec: mvEvery,
        socStart,
        socTarget,
        evseType,
        maxA,
      }),
    }).catch(() => {});
    if (mvRunning) {
      await fetchJSON(`/api/simu/${selId}/mv/restart`, {
        method: "POST",
        body: JSON.stringify({ periodSec: mvEvery }),
      }).catch(() => {});
    }
    await tnr.tapEvent(
        "session",
        "APPLY_MV_MASK",
        { mvMask, mvEvery, socStart, socTarget, evseType, maxA },
        selId || undefined
    );
  };

  // ========= 11. USE EFFECTS =========

  // MAJ config connecteur quand type EVSE change ou session change
  useEffect(() => {
    const phasesFromType = evseType === "ac-tri" ? 3 : evseType === "ac-bi" ? 2 : 1;
    const actualVoltage = selSession?.metrics?.voltage || DEFAULT_VOLTAGE;
    const actualPhases = selSession?.metrics?.phases || phasesFromType;

    profilesManager.updateConnectorConfig(1, {
      voltage: actualVoltage,
      phases: actualPhases
    });

    console.log(`Config mise à jour: ${actualVoltage}V, ${actualPhases} phases`);
  }, [evseType, profilesManager, selSession]);

  // Charger config au montage
  useEffect(() => {
    fetchJSON<{ hasToken: boolean; url: string }>("/api/config/price-token")
        .then((config) => {
          if (config.url) {
            setPriceApiUrl(config.url);
          }
        })
        .catch(() => {});
  }, []);

  useEffect(() => {
    setPriceData(null);
  }, [selId]);

  // Charger véhicules
  useEffect(() => {
    loadVehicleProfiles().then(() => {
      const arr = getAllVehicles();
      setVehicles(arr);
      if (!vehicleId && arr.length) setVehicleId(arr[0].id);
    });
  }, [vehicleId]);

  // Sessions polling
  useEffect(() => {
    refreshSessions();
    const t = setInterval(refreshSessions, 1500);
    return () => clearInterval(t);
  }, []);

  // Logs polling
  useEffect(() => {
    let t: any;
    async function poll() {
      if (!selId) return;
      try {
        const data: LogEntry[] = await fetchJSON(`/api/simu/${selId}/logs`);
        if (Array.isArray(data)) setLogs(data.slice(-800));
      } catch {}
    }
    poll();
    t = setInterval(poll, 1000);
    return () => clearInterval(t);
  }, [selId]);

  // Fiabilité OCPP
  useEffect(() => {
    const slice = logs.slice(-200);
    const sent = slice.filter((l) => l.line.includes(">> Sent")).length;
    const ack = slice.filter((l) => l.line.includes("<< RESULT")).length;
    setAckStats({ sent, ack, rate: sent ? ack / sent : 1 });
  }, [logs])

  // Ajoutez un ref pour tracker les logs déjà traités
  const processedLogsRef = useRef<Set<string>>(new Set());

  // Parsing des logs (avec SCP robuste)
  useEffect(() => {
    const recent = logs.slice(-80);
    if (!recent.length) return;

    const sSoc = [...series.soc];
    const sPA = [...series.pActive];
    const sExp = [...series.expected];
    let mvTapPayload: any | null = null;
    let hasNewData = false;

    for (const l of recent) {
      const t = nowMs();
      const logKey = `${l.ts}_${l.line}`;

      // Ignorer si déjà traité
      if (processedLogsRef.current.has(logKey)) continue;

      // Marquer comme traité APRÈS vérification
      processedLogsRef.current.add(logKey);

      // Nettoyer les anciens logs traités (garder seulement les 200 derniers)
      if (processedLogsRef.current.size > 200) {
        const keys = Array.from(processedLogsRef.current);
        keys.slice(0, keys.length - 200).forEach(k =>
            processedLogsRef.current.delete(k)
        );
      }

      // MeterValues
      if (/MeterValues/i.test(l.line)) {
        let paKw: number | undefined;
        let socPct: number | undefined;
        let energyKWh: number | undefined;

        const i1 = l.line.indexOf("{");
        const i2 = l.line.lastIndexOf("}");
        if (i1 !== -1 && i2 !== -1 && i2 > i1) {
          try {
            const payload = JSON.parse(l.line.slice(i1, i2 + 1));
            const mvArr = payload?.meterValue || [];
            for (const mv of mvArr) {
              for (const it of mv?.sampledValue || []) {
                const meas = String(it?.measurand || "");
                const val = Number(it?.value);
                const unit = String(it?.unit || "");
                if (!Number.isFinite(val)) continue;
                if (meas === "Power.Active.Import") {
                  paKw = unit === "W" ? val / 1000 : val;
                  hasNewData = true;
                } else if (meas === "SoC") {
                  socPct = val;
                  hasNewData = true;
                } else if (meas === "Energy.Active.Import.Register") {
                  energyKWh = unit.toLowerCase() === "wh" ? val / 1000 : val;
                  hasNewData = true;
                }
              }
            }
          } catch {}
        }

        if (energyKWh != null) {
          if (energyStartKWhRef.current == null)
            energyStartKWhRef.current = energyKWh;
          energyNowKWhRef.current = energyKWh;
        }
        if (paKw != null) {
          lastRealMvMsRef.current = t;
          const lastT = lastPowerMsRef.current;
          lastPowerMsRef.current = t;
          if (lastT != null) {
            const dtH = (t - lastT) / 3600000;
            energyFromPowerKWhRef.current += Math.max(0, paKw) * dtH;
          }
          const smooth = ewma(pActiveFiltRef.current, Math.max(0, paKw));
          pActiveFiltRef.current = smooth;
          sPA.push({ t, y: smooth });
          if (sPA.length > MAX_POINTS) sPA.shift();
        }
        if (socPct != null) {
          const smoothSoc = ewma(
              socFiltRef.current,
              clamp(socPct, 0, 100)
          );
          socFiltRef.current = smoothSoc;
          const lastY = sSoc.length ? sSoc[sSoc.length - 1].y : socStart;
          sSoc.push({ t, y: clamp(Math.max(lastY, smoothSoc), 0, 100) });
          if (sSoc.length > MAX_POINTS) sSoc.shift();

          const expKw = vehMaxKwAtSoc(smoothSoc);
          sExp.push({ t, y: expKw });
          if (sExp.length > MAX_POINTS) sExp.shift();
        }
        mvTapPayload = { powerActiveKw: paKw, socPercent: socPct };
      }

      // SetChargingProfile (parser robuste avec conversion A→W)
      if (/SetChargingProfile/i.test(l.line)) {
        const i1 = l.line.indexOf("{");
        const i2 = l.line.lastIndexOf("}");
        if (i1 !== -1 && i2 !== -1 && i2 > i1) {
          try {
            const parsed = JSON.parse(l.line.slice(i1, i2 + 1));

            const payload =
                Array.isArray(parsed) ? parsed[3] :
                    (parsed && typeof parsed === "object" && "payload" in parsed) ? (parsed as any).payload :
                        parsed;

            const connectorId = Number(payload?.connectorId || 1);
            const profile = payload?.csChargingProfiles || payload?.chargingProfile;

            if (profile) {
              // Normaliser duration si nécessaire
              if (profile?.chargingSchedule?.duration != null) {
                const d = profile.chargingSchedule.duration;
                profile.chargingSchedule.duration = d > 7 * 24 * 3600 ? Math.round(d / 1000) : d;
              }

              // CONVERSION A → W SI NÉCESSAIRE
              if (profile?.chargingSchedule?.chargingRateUnit === "A") {
                profile.chargingSchedule.chargingSchedulePeriod?.forEach((p: any) => {
                  // Convertir ampères en watts
                  p.limit = p.limit * voltage * phases;
                });
                profile.chargingSchedule.chargingRateUnit = "W";
                toasts.push(`SCP converti: A → W (${voltage}V × ${phases} phases)`);
              }

              const res = profilesManager.setChargingProfile(connectorId, profile);
              if (res.status === "Accepted") {
                toasts.push(`SCP appliqué • ${profile.chargingProfilePurpose} (stack ${profile.stackLevel})`);
              }
            }
          } catch (e) {
            console.error("Parse SCP failed", e);
          }
        }
      }

      // ClearChargingProfile
      if (/ClearChargingProfile/i.test(l.line)) {
        const i1 = l.line.indexOf("{");
        const i2 = l.line.lastIndexOf("}");

        let criteria = {};
        if (i1 !== -1 && i2 !== -1 && i2 > i1) {
          try {
            criteria = JSON.parse(l.line.slice(i1, i2 + 1));
          } catch {}
        }

        const result = profilesManager.clearChargingProfile(criteria as any);
        toasts.push(`Clear: ${result.cleared.length} profil(s) supprimé(s)`);
      }
    }

    if (hasNewData) setSeries({ soc: sSoc, pActive: sPA, expected: sExp });

    const now = nowMs();
    if (
        tnr.isRecording &&
        mvTapPayload &&
        now - (lastMvTapRef.current || 0) > 1000
    ) {
      lastMvTapRef.current = now;
      tnr.tapEvent(
          "meter",
          "MeterValues",
          mvTapPayload,
          selId || undefined
      );
    }
  }, [
    logs,
    tnr.isRecording,
    selId,
    socStart,
    voltage,
    phases,
    profilesManager,
    toasts,
    vehMaxKwAtSoc,
    tnr
  ]);

  useEffect(() => {
    if (!socFiltRef.current) socFiltRef.current = socStart;
  }, [socStart]);

  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Simulation 1 Hz
  useEffect(() => {
    if (selSession?.status !== "started") return;
    const id = setInterval(() => {
      const vehKw = vehMaxKwAtSoc(socFiltRef.current ?? socStart);
      const targetKw = Math.min(vehKw, appliedLimitKw);
      const prev = pActiveFiltRef.current ?? 0;
      const ramped = clampRamp(prev, targetKw, 1);
      const noisy = ramped * (1 + (Math.random() * 2 - 1) * NOISE);

      pActiveFiltRef.current = ewma(prev, Math.max(0, noisy));
      setSeries((s) => ({
        ...s,
        pActive: [
          ...s.pActive,
          { t: Date.now(), y: pActiveFiltRef.current! },
        ].slice(-MAX_POINTS),
        expected: [...s.expected, { t: Date.now(), y: vehKw }].slice(
            -MAX_POINTS
        ),
      }));

      const dtH = 1 / 3600;
      if (Date.now() - lastRealMvMsRef.current > 3000) {
        energyFromPowerKWhRef.current += Math.max(
            0,
            pActiveFiltRef.current!
        ) * dtH;
      }

      const cap = vehicleCapacityKWh;
      const eff = vehicleEfficiency;
      const dSoc = ((pActiveFiltRef.current! * dtH * eff) / cap) * 100 * SOC_CHARGE_MULTIPLIER;
      socFiltRef.current = clamp(
          (socFiltRef.current ?? socStart) + dSoc,
          0,
          100
      );

      setSeries((s) => ({
        ...s,
        soc: [...s.soc, { t: Date.now(), y: socFiltRef.current! }].slice(
            -MAX_POINTS
        ),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [selSession?.status, appliedLimitKw, vehMaxKwAtSoc, socStart, vehicleCapacityKWh, vehicleEfficiency, clampRamp]);

  // ========= 12. RENDER =========
  const canAuth = !!selSession && isPlugged;
  const canStart = selSession?.status === "authorized" && isPlugged;
  const canStop = selSession?.status === "started";

  return (
      <div className="flex flex-col gap-4">
        <style dangerouslySetInnerHTML={{ __html: extraCSS }} />

        {/* Utilisation du composant TNRBandeau AMÉLIORÉ */}
        <TNRBandeau tnr={tnr} onOpenTNR={() => window.open("/tnr", "_blank")} />

        {/* Sélection session */}
        <div className="flex items-center justify-between">
          <div className="flex gap-4 items-center">
            <div className="flex gap-2 items-center">
              <span className="text-sm">Session</span>
              <select
                  className="border rounded px-2 py-1 min-w-[320px]"
                  value={selId || ""}
                  onChange={(e) => setSelId(e.target.value || null)}
              >
                <option value="">—</option>
                {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.cpId} — {s.status}
                    </option>
                ))}
              </select>
              <button
                  onClick={onNewSession}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
              >
                + Nouvelle Session
              </button>
            </div>
            <div className="text-xs">
              <div className="opacity-60">Fiabilité OCPP</div>
              <div
                  className={`font-semibold ${
                      ackStats.rate >= 0.98
                          ? "text-emerald-600"
                          : ackStats.rate >= 0.9
                              ? "text-amber-600"
                              : "text-rose-600"
                  }`}
              >
                ACK: {Math.round(ackStats.rate * 100)}%
                <span className="opacity-60 ml-1">
                  ({ackStats.ack}/{ackStats.sent})
                </span>
              </div>
            </div>
          </div>
          <button
              onClick={onDisconnect}
              className="px-3 py-2 rounded bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50"
              disabled={!selId}
          >
            Fermer (DISCONNECT)
          </button>
        </div>

        {/* Connexion + Contrôle */}
        <div className="grid grid-cols-12 gap-4">
          {/* Panneau gauche */}
          <div className="col-span-4 rounded border bg-white p-4 shadow-sm">
            <div className="font-semibold mb-2">Connexion OCPP</div>
            <div className="text-xs mb-1">OCPP WebSocket URL</div>
            <input
                className="w-full border rounded px-2 py-1 mb-2"
                value={cpUrl}
                onChange={(e) => setCpUrl(e.target.value)}
            />
            <div className="text-xs mb-1">CP-ID</div>
            <input
                className="w-full border rounded px-2 py-1 mb-3"
                value={cpId}
                onChange={(e) => setCpId(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                  onClick={onConnect}
                  className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500"
              >
                CONNECT
              </button>
              <button
                  onClick={onDisconnect}
                  className="px-3 py-2 rounded bg-slate-200 hover:bg-slate-100"
                  disabled={!selId}
              >
                DISCONNECT
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded border p-2 bg-slate-50">
                <div className="text-xs">Status</div>
                <div className="text-lg">{selSession?.status ?? "—"}</div>
              </div>
              <div className="rounded border p-2 bg-slate-50">
                <div className="text-xs">Transaction</div>
                <div className="text-lg">{selSession?.txId ?? "—"}</div>
              </div>
            </div>

            {/* État Charging Profiles avec ChargingProfileCard */}
            <div className="mt-4">
              <ChargingProfileCard
                  profilesManager={profilesManager}
                  connectorId={1}
              />
            </div>
          </div>

          {/* Panneau droit */}
          <div className="col-span-8 rounded border bg-white p-4 shadow-sm">
            <div className="font-semibold mb-2">Contrôle de charge</div>

            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-3">
                <div className="text-xs mb-1">Type EVSE</div>
                <select
                    className="w-full border rounded px-2 py-1"
                    value={evseType}
                    onChange={(e) =>
                        setEvseType(e.target.value as any)
                    }
                >
                  <option value="ac-mono">AC Mono</option>
                  <option value="ac-bi">AC Bi</option>
                  <option value="ac-tri">AC Tri</option>
                  <option value="dc">DC</option>
                </select>
              </div>
              <div className="col-span-2">
                <div className="text-xs mb-1">Max (A)</div>
                <input
                    type="number"
                    className="w-full border rounded px-2 py-1"
                    value={maxA}
                    onChange={(e) =>
                        setMaxA(Number(e.target.value || 0))
                    }
                />
              </div>

              <div className="col-span-4">
                <div className="text-xs mb-1">Véhicule</div>
                <select
                    className="w-full border rounded px-2 py-1"
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                >
                  {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name ||
                            `${v.manufacturer ?? ""} ${v.model ?? ""} ${v.variant ?? ""}`.trim()}
                      </option>
                  ))}
                </select>
              </div>

              <div className="col-span-3">
                <div className="text-xs mb-1">idTag</div>
                <input
                    className="w-full border rounded px-2 py-1"
                    value={idTag}
                    onChange={(e) => setIdTag(e.target.value)}
                    placeholder="Entrez l'idTag..."
                />
              </div>

              <div className="col-span-12 grid grid-cols-12 gap-2 mt-2">
                <div className="col-span-2">
                  <div className="text-xs mb-1">Période MV (s)</div>
                  <input
                      type="number"
                      min={1}
                      className="w-full border rounded px-2 py-1"
                      value={mvEvery}
                      onChange={(e) =>
                          setMvEvery(Number(e.target.value || 1))
                      }
                  />
                </div>
                <div className="col-span-4">
                  <div className="text-xs mb-1">Mesures envoyées</div>
                  <div className="flex items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-1">
                      <input
                          type="checkbox"
                          checked={mvMask.powerActive}
                          onChange={(e) =>
                              setMvMask((m) => ({
                                ...m,
                                powerActive: e.target.checked,
                              }))
                          }
                      />
                      Power.Active.Import
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                          type="checkbox"
                          checked={mvMask.energy}
                          onChange={(e) =>
                              setMvMask((m) => ({
                                ...m,
                                energy: e.target.checked,
                              }))
                          }
                      />
                      Energy.Active.Import.Register
                    </label>
                  </div>
                  <div className="flex items-center gap-4 text-xs mt-1">
                    <label className="inline-flex items-center gap-1">
                      <input
                          type="checkbox"
                          checked={mvMask.soc}
                          onChange={(e) =>
                              setMvMask((m) => ({
                                ...m,
                                soc: e.target.checked,
                              }))
                          }
                      />
                      SoC
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                          type="checkbox"
                          checked={mvMask.powerOffered}
                          onChange={(e) =>
                              setMvMask((m) => ({
                                ...m,
                                powerOffered: e.target.checked,
                              }))
                          }
                      />
                      Power.Offered
                    </label>
                  </div>
                </div>

                <div className="col-span-3">
                  <div className="text-xs mb-1">SoC (%)</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Départ</span>
                    <input
                        type="number"
                        className="w-16 border rounded px-2 py-1"
                        value={socStart}
                        onChange={(e) =>
                            setSocStart(clamp(Number(e.target.value || 0), 0, 100))
                        }
                    />
                    <span className="text-xs text-slate-500">Cible</span>
                    <input
                        type="number"
                        className="w-16 border rounded px-2 py-1"
                        value={socTarget}
                        onChange={(e) =>
                            setSocTarget(clamp(Number(e.target.value || 0), 0, 100))
                        }
                    />
                  </div>
                </div>

                <div className="col-span-3 flex items-end justify-end gap-2">
                  <button
                      className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 w-full"
                      onClick={onApplyMv}
                  >
                    Appliquer MV
                  </button>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Câble</span>
                    <label className="inline-flex items-center gap-2">
                      <input
                          type="checkbox"
                          checked={showCable}
                          onChange={(e) => setShowCable(e.target.checked)}
                      />
                      Afficher
                    </label>
                  </div>
                </div>
              </div>

              {/* Boutons organisés */}
              <div className="col-span-12 grid grid-cols-2 gap-4 mt-3">
                {/* Colonne gauche – Contrôles BORNE */}
                <div className="rounded border p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 font-semibold mb-2">
                    Borne
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            isParked && !isPlugged
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-slate-200 text-slate-500"
                        }`}
                        onClick={onPlug}
                        disabled={!selId || !isParked || isPlugged}
                    >
                      Plug
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            isPlugged && !isCharging
                                ? "bg-slate-700 text-white hover:bg-slate-600"
                                : "bg-slate-200 text-slate-500"
                        }`}
                        onClick={onUnplug}
                        disabled={!selId || !isPlugged || isCharging}
                    >
                      Unplug
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            !!selSession &&
                            isPlugged &&
                            selSession?.status !== "authorized" &&
                            selSession?.status !== "started"
                                ? "bg-sky-600 text-white hover:bg-sky-700"
                                : "bg-sky-200 text-sky-600"
                        }`}
                        disabled={
                            !selId ||
                            !isPlugged ||
                            selSession?.status === "authorized" ||
                            selSession?.status === "started"
                        }
                        onClick={onAuth}
                    >
                      Auth
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            selSession?.status === "authorized" && isPlugged
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "bg-emerald-200 text-emerald-700"
                        }`}
                        disabled={!selId || !(selSession?.status === "authorized" && isPlugged)}
                        onClick={onStart}
                    >
                      Start
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            selSession?.status === "started"
                                ? "bg-rose-600 text-white hover:bg-rose-700"
                                : "bg-rose-200 text-rose-700"
                        }`}
                        disabled={!selId || !(selSession?.status === "started")}
                        onClick={onStop}
                    >
                      Stop
                    </button>
                  </div>
                </div>

                {/* Colonne droite – Contrôles VÉHICULE */}
                <div className="rounded border p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 font-semibold mb-2">
                    Véhicule
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            !isParked && !isPlugged
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-slate-200 text-slate-500"
                        }`}
                        onClick={onPark}
                        disabled={!selId || isParked || isPlugged}
                    >
                      Park
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-sm ${
                            isParked && !isPlugged && !isCharging
                                ? "bg-orange-600 text-white hover:bg-orange-700"
                                : "bg-slate-200 text-slate-500"
                        }`}
                        onClick={onLeave}
                        disabled={!selId || !isParked || isPlugged || isCharging}
                    >
                      Leave
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Scène visuelle - Disposition horizontale comme la référence */}
            <div
                ref={containerRef}
                className="mt-4 rounded-xl bg-gradient-to-br from-slate-100 via-white to-slate-50 p-6 relative overflow-hidden"
                style={{ minHeight: 400 }}
            >
              {/* Container flex pour aligner horizontalement */}
              <div className="flex items-center justify-between w-full h-full relative">

                {/* BORNE à gauche */}
                <div
                    ref={stationRef}
                    className="relative select-none flex-shrink-0"
                    style={{ width: 200, height: 280 }}
                >
                  <img
                      src={evseType === "dc" ? ASSETS.stationDC : ASSETS.stationAC}
                      alt="Borne de charge"
                      className="w-full h-full object-contain"
                      style={{
                        filter: "drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))",
                      }}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          parent.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
                          parent.style.borderRadius = '8px';
                          parent.style.display = 'flex';
                          parent.style.alignItems = 'center';
                          parent.style.justifyContent = 'center';
                          parent.innerHTML = '<div style="color: white; text-align: center; font-weight: bold;">EVSE</div>';
                        }
                      }}
                  />
                  {/* Port de la borne - position ajustée */}
                  <div
                      ref={stationPortRef}
                      className="absolute w-3 h-3"
                      style={{ right: 20, top: "50%", transform: "translateY(-50%)" }}
                  />
                </div>

                {/* Zone centrale pour le câble et connecteurs */}
                <div className="flex-1 relative" style={{ minHeight: 300 }}>

                  {/* CONNECTEURS - avec rotation selon l'angle du câble */}
                  {isPlugged && (
                      <>
                        {/* Connecteur côté borne */}
                        <div
                            style={{
                              position: "absolute",
                              left: 61,
                              top: "35%",
                              transform: "translateY(-50%)",
                              zIndex: 80,
                            }}
                        >
                          <Connector
                              side="right"
                              rotation={connAngles.left-50}
                              glowing={selSession?.status === "started"}
                              size={220}
                          />
                        </div>

                        {/* Connecteur côté voiture */}
                        {isParked && (
                            <div
                                style={{
                                  position: "absolute",
                                  right: 173 ,
                                  top: "35%",
                                  transform: "translateY(-50%)",
                                  zIndex: 80,
                                }}
                            >
                              <Connector
                                  side="left"
                                  rotation={connAngles.right+50}
                                  glowing={selSession?.status === "started"}
                                  size={220}
                              />
                            </div>
                        )}
                      </>
                  )}

                  {/* CÂBLE - avec callback pour les angles */}
                  {showCable && isParked && isPlugged && (
                      <Cable
                          containerRef={containerRef}
                          startRef={stationPortRef}
                          endRef={carPortRef}
                          show={isParked && isPlugged}
                          charging={selSession?.status === "started"}
                          sagFactor={0.35}
                          extraDropPx={60}
                          onAnglesChange={setConnAngles}
                      />
                  )}

                  {/* ChargeDisplay en bas avec valeurs corrigées */}
                  {selSession?.status === "started" && isParked && (
                      <div
                          className="absolute"
                          style={{
                            left: "80%",
                            bottom: 60,
                            transform: "translateX(-50%)",
                            zIndex: 65,
                          }}
                      >
                        <ChargeDisplay
                            soc={currentSoc}
                            powerKw={currentPowerKw}
                            energyKWh={totalEnergyKWh}
                            elapsedTime={elapsedTime}
                            isCharging={true}
                        />
                      </div>
                  )}
                </div>

                {/* VOITURE à droite */}
                {isParked && (
                    <div
                        ref={carRef}
                        className="relative select-none flex-shrink-0"
                        style={{
                          width: 380 * VEHICLE_SCALE,
                          height: 200 * VEHICLE_SCALE,
                        }}
                    >
                      <img
                          src={vehicleImage}
                          alt="Véhicule électrique"
                          className="w-full h-full object-contain"
                          style={{
                            filter: "drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))",
                          }}
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
                              parent.style.borderRadius = '8px';
                              parent.style.display = 'flex';
                              parent.style.alignItems = 'center';
                              parent.style.justifyContent = 'center';
                              parent.innerHTML = '<div style="color: white; text-align: center; font-weight: bold;">EV</div>';
                            }
                          }}
                      />
                      {/* Port de la voiture - position ajustée avec le facteur d'échelle */}
                      <div
                          ref={carPortRef}
                          className="absolute w-3 h-3"
                          style={{
                            left: 20 * VEHICLE_SCALE,
                            top: "50%",
                            transform: "translateY(-50%)"
                          }}
                      />
                    </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section Prix avec récupération corrigée */}
        <div className="col-span-12 grid grid-cols-12 gap-4 mt-4">
          {/* Configuration du prix */}
          <div className="col-span-6 rounded border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Configuration Prix API</div>
              <button
                  onClick={() => setShowPriceConfig(!showPriceConfig)}
                  className="text-sm px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
              >
                {showPriceConfig ? "Masquer" : "Configurer"}
              </button>
            </div>

            {showPriceConfig && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs mb-1">URL de l'API</div>
                    <input
                        type="text"
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={priceApiUrl}
                        onChange={(e) => setPriceApiUrl(e.target.value)}
                        placeholder="https://api.example.com/transactions"
                    />
                  </div>
                  <div>
                    <div className="text-xs mb-1">Token API (Bearer)</div>
                    <input
                        type="password"
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={priceToken}
                        onChange={(e) => setPriceToken(e.target.value)}
                        placeholder="Entrez votre token API..."
                    />
                  </div>
                  <button
                      onClick={saveTokenConfig}
                      className="w-full px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm"
                  >
                    Sauvegarder la configuration
                  </button>
                </div>
            )}

            {!showPriceConfig && (
                <div className="text-sm text-slate-600">
                  {priceToken ? "Token configuré" : "Aucun token configuré"}
                </div>
            )}
          </div>

          {/* Affichage du prix avec récupération améliorée */}
          <div className="col-span-6 rounded border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Prix de la session</div>
              <button
                  onClick={fetchPrice}
                  disabled={!selId || fetchingPrice}
                  className={`px-3 py-2 rounded text-sm font-medium ${
                      selSession?.status === "stopped" || selSession?.status === "closed"
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-slate-300 text-slate-500"
                  } disabled:opacity-50`}
              >
                {fetchingPrice ? "Chargement..." : "Récupérer le prix"}
              </button>
            </div>

            {priceData ? (
                <div className="space-y-2">
                  {/* Prix principal */}
                  <div className="rounded-lg bg-gradient-to-r from-emerald-50 to-blue-50 p-3">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <div className="text-xs text-slate-600">Prix total</div>
                        <div className="text-2xl font-bold text-slate-900">
                          {priceData.totalPrice.toFixed(2)} {priceData.currency}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-600">Énergie</div>
                        <div className="text-lg font-semibold text-slate-700">
                          {priceData.energyKWh.toFixed(2)} kWh
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Détails */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border p-2 bg-slate-50">
                      <div className="text-xs text-slate-500">Prix/kWh</div>
                      <div className="font-semibold">
                        {priceData.pricePerKWh > 0 ? priceData.pricePerKWh.toFixed(3) : "0.000"} {priceData.currency}
                      </div>
                    </div>
                    <div className="rounded border p-2 bg-slate-50">
                      <div className="text-xs text-slate-500">Source</div>
                      <div className="font-semibold">
                        {priceData.source === "api" ? "API" :
                            priceData.source === "no_token" ? "Pas de token" :
                                priceData.source === "not_found" ? "Non trouvé" : "Erreur"}
                      </div>
                    </div>
                  </div>

                  {/* Informations supplémentaires */}
                  {priceData.transactionId && (
                      <div className="text-xs text-slate-600 border-t pt-2">
                        <div>Transaction ID: {priceData.transactionId}</div>
                        {priceData.chargePointId && (
                            <div>Charge Point: {priceData.chargePointId}</div>
                        )}
                        {priceData.status && <div>Status: {priceData.status}</div>}
                      </div>
                  )}

                  {/* Détails de taxation */}
                  {priceData.details && priceData.details.taxedPrice !== undefined && (
                      <div className="text-xs text-slate-600 border-t pt-2">
                        {priceData.details.nonTaxedPrice !== undefined && (
                            <div>Prix HT: {priceData.details.nonTaxedPrice.toFixed(2)} {priceData.currency}</div>
                        )}
                        {priceData.details.taxedPrice !== undefined && (
                            <div>Prix TTC: {priceData.details.taxedPrice.toFixed(2)} {priceData.currency}</div>
                        )}
                        {priceData.details.taxRate !== undefined && (
                            <div>Taux TVA: {(priceData.details.taxRate * 100).toFixed(1)}%</div>
                        )}
                      </div>
                  )}

                  {/* Informations de recherche si pas trouvé */}
                  {priceData?.searchCriteria && (
                      <div className="text-xs text-orange-600 border-t pt-2 bg-orange-50 p-2 rounded">
                        <div className="font-semibold mb-1">Recherche de transaction:</div>
                        <div>CP-ID recherché: {priceData.searchCriteria.cpId}</div>
                        <div>TX-ID recherché: {priceData.searchCriteria.txId}</div>
                        {priceData.apiTransactionCount !== undefined && (
                            <div>Transactions dans l'API: {priceData.apiTransactionCount}</div>
                        )}
                      </div>
                  )}

                  {/* Message d'information */}
                  {priceData.message && (
                      <div className={`text-xs p-2 rounded ${
                          priceData.source === "api" ? "bg-green-100 text-green-700" :
                              priceData.source === "no_token" ? "bg-gray-100 text-gray-700" :
                                  priceData.source === "not_found" ? "bg-yellow-100 text-yellow-700" :
                                      "bg-orange-100 text-orange-700"
                      }`}>
                        {priceData.message}
                      </div>
                  )}
                </div>
            ) : (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-sm">
                    {selSession?.status === "stopped" || selSession?.status === "closed"
                        ? "Cliquez pour récupérer le prix de la session"
                        : "Terminez la session pour récupérer le prix"}
                  </div>
                </div>
            )}
          </div>
        </div>

        {/* Métriques + Graph + Logs */}
        <div className="grid grid-cols-12 gap-4">
          {/* Métriques temps réel corrigées */}
          <div className="col-span-4 rounded border bg-white p-4 shadow-sm">
            <div className="font-semibold mb-2">Métriques temps réel</div>

            {/* Carte Charging Profiles */}
            <div className="mb-3">
              <ChargingProfileCard
                  profilesManager={profilesManager}
                  connectorId={1}
              />
            </div>

            <div className="rounded border p-2 bg-emerald-50 mb-2">
              <div className="text-xs text-emerald-700 mb-1">Énergie totale</div>
              <div className="text-xl font-bold">{totalEnergyKWh.toFixed(2)} kWh</div>
              <div className="text-[11px] text-emerald-700/80 mt-1">
                Utilisation {appliedLimitKw > 0
                  ? ((currentPowerKw / appliedLimitKw) * 100).toFixed(0)
                  : "0"}% de la limite
              </div>
            </div>

            <div className="rounded border p-2 bg-blue-50 mb-2">
              <div className="text-xs text-blue-700 mb-1">Temps écoulé</div>
              <div className="text-xl font-mono">{elapsedTime}</div>
              <div className="text-[11px] text-blue-700/80 mt-1">
                Puissance instantanée: {currentPowerKw.toFixed(1)} kW
              </div>
            </div>

            <div className="rounded border p-2 bg-slate-50 mb-2">
              <div className="text-xs text-slate-500 mb-1">Limite physique</div>
              <div className="text-xl font-bold">{physicalLimitKw.toFixed(1)} kW</div>
              <div className="text-[11px] text-slate-500 mt-1">
                {maxA}A × {voltage}V × {phases} phase{phases > 1 ? 's' : ''}
              </div>
            </div>

            <div className="rounded border p-2 bg-indigo-50">
              <div className="text-xs text-indigo-600 mb-1">Limite appliquée</div>
              <div className="text-xl font-bold text-indigo-900">
                {appliedLimitKw.toFixed(1)} kW
              </div>
              <div className="text-[11px] text-indigo-600 mt-1">
                Min(SCP, Physique)
              </div>
            </div>

            {selSession?.status === "started" && (
                <div className="mt-2 rounded border p-2 bg-yellow-50">
                  <div className="text-xs text-yellow-700 mb-1">Coût estimé (0.40 €/kWh)</div>
                  <div className="text-lg font-bold text-yellow-900">
                    {(totalEnergyKWh * 0.40).toFixed(2)} €
                  </div>
                </div>
            )}
          </div>

          {/* Graphique corrigé */}
          <div className="col-span-4 rounded border bg-white p-4 shadow-sm">
            <div className="font-semibold mb-2">Courbe de charge</div>
            <Chart
                height={300}
                yMax={Math.max(
                    10,
                    Math.ceil(Math.max(physicalLimitKw, appliedLimitKw) * 1.3)
                )}
                xLabel="Temps"
                yLabel="Puissance (kW)"
                refLines={[
                  {
                    value: appliedLimitKw,
                    label: `Limite: ${appliedLimitKw.toFixed(1)} kW`,
                    color: "#dc2626",
                  },
                  ...(profileState.effectiveLimit.source === "profile"
                      ? [
                        {
                          value: profileState.effectiveLimit.limitW / 1000,
                          label: `SCP: ${(profileState.effectiveLimit.limitW / 1000).toFixed(1)} kW`,
                          color: "#22c55e",
                        },
                      ]
                      : []),
                ]}
                series={[
                  {
                    label: "Puissance réelle",
                    color: "#10b981",
                    points: series.pActive,
                    width: 3,
                  },
                  {
                    label: "Courbe véhicule",
                    color: "#6b7280",
                    dash: "6 3",
                    points: series.expected,
                    width: 2,
                    opacity: 0.7,
                  },
                ]}
            />
          </div>

          {/* Logs */}
          <div className="col-span-4 rounded border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Logs de session</div>
              <div className="flex gap-2">
                <button
                    className="px-3 py-1 bg-slate-200 hover:bg-slate-100 rounded text-sm"
                    onClick={() => {
                      const txt = logs
                          .map((l) => `[${l.ts}] ${l.line}`)
                          .join("\n");
                      navigator.clipboard.writeText(txt);
                    }}
                    disabled={!logs.length}
                >
                  Copier
                </button>
                <button
                    className="px-3 py-1 bg-rose-600 text-white hover:bg-rose-500 rounded text-sm"
                    onClick={() => setLogs([])}
                >
                  Effacer
                </button>
              </div>
            </div>
            <div
                className="bg-[#0b1220] text-[#cde3ff] font-mono text-[12px] p-2 overflow-y-auto rounded"
                style={{ height: 260 }}
            >
              {logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    [{l.ts}] {l.line}
                  </div>
              ))}
            </div>
          </div>
        </div>

        {/* Toasts */}
        {toasts.items.length > 0 && (
            <div className="fixed right-4 bottom-4 z-[1000] flex flex-col gap-2">
              {toasts.items.map((t) => (
                  <div
                      key={t.id}
                      className="px-4 py-3 rounded-lg bg-slate-900 text-white shadow-2xl text-sm animate-[pulse_0.5s_ease-in-out]"
                  >
                    {t.text}
                  </div>
              ))}
            </div>
        )}
      </div>
  );
}