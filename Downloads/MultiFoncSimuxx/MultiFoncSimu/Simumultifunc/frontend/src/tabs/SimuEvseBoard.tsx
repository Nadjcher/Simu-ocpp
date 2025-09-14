// src/tabs/SimuEvseBoard.tsx - Board multi-sessions avec profils véhicules
import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/apiBase";
import { useTNR } from "@/contexts/TNRContext";
import {
  loadVehicleProfiles,
  getAllVehicles,
  getVehicleNames,
  getVehicleByName,
  calcPower,
  getCapacity,
  getEfficiency,
  estimateMinutes,
  VehicleProfile
} from "@/services/vehAdapter";

/* -------------------------------------------------------------------------- */
/*  Manager OCPP                                                               */
/* -------------------------------------------------------------------------- */

type ChargingProfilePurposeType = "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile";
type ChargingRateUnitType = "W" | "A";
type ChargingProfileKindType = "Absolute" | "Recurring" | "Relative";

type ChargingSchedulePeriod = { startPeriod: number; limit: number; numberPhases?: number };
type ChargingSchedule = {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: ChargingRateUnitType;
  chargingSchedulePeriod: ChargingSchedulePeriod[];
  minChargingRate?: number;
};
type ChargingProfile = {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: ChargingProfilePurposeType;
  chargingProfileKind: ChargingProfileKindType;
  chargingSchedule: ChargingSchedule;
};

type ProfileApplication = {
  profileId: number;
  purpose: ChargingProfilePurposeType;
  stackLevel: number;
  limitW: number;
  source: "profile" | "default" | "physical";
  timestamp: number;
};

class OCPPChargingProfilesManager {
  private byConnector = new Map<number, Map<number, ChargingProfile>>();
  private limits = new Map<number, ProfileApplication>();
  private defaultVoltage = 230;
  private defaultPhases = 3;
  private maxPowerW = 22000;

  constructor(cfg?: { maxPowerW?: number; defaultVoltage?: number; defaultPhases?: number }) {
    if (cfg?.maxPowerW) this.maxPowerW = cfg.maxPowerW;
    if (cfg?.defaultVoltage) this.defaultVoltage = cfg.defaultVoltage;
    if (cfg?.defaultPhases) this.defaultPhases = cfg.defaultPhases;
  }

  reset() {
    this.byConnector.clear();
    this.limits.clear();
  }

  setChargingProfile(connectorId: number, p: ChargingProfile) {
    if (!this.byConnector.has(connectorId)) this.byConnector.set(connectorId, new Map());
    this.byConnector.get(connectorId)!.set(p.chargingProfileId, p);
    this.limits.set(connectorId, this.compute(connectorId));
    return { status: "Accepted" as const };
  }

  clearChargingProfile(_criteria?: any) {
    const cleared: number[] = [];
    this.byConnector.forEach((map) => {
      map.forEach((_v, k) => cleared.push(k));
      map.clear();
    });
    this.limits.forEach((_v, k) => this.limits.set(k, this.compute(k)));
    return { status: cleared.length ? ("Accepted" as const) : ("Unknown" as const), cleared };
  }

  getConnectorState(connectorId: number) {
    const profiles = Array.from(this.byConnector.get(connectorId)?.values() ?? []);
    const effectiveLimit = this.limits.get(connectorId) ?? this.compute(connectorId);
    return { profiles, effectiveLimit, history: [] as any[] };
  }

  private compute(connectorId: number): ProfileApplication {
    const now = Date.now();
    const map = this.byConnector.get(connectorId);
    if (!map || !map.size) {
      return {
        profileId: -1,
        purpose: "ChargePointMaxProfile",
        stackLevel: -1,
        limitW: this.maxPowerW,
        source: "physical",
        timestamp: now,
      };
    }
    const arr = Array.from(map.values()).sort((a, b) => {
      const prio: any = { TxProfile: 3, TxDefaultProfile: 2, ChargePointMaxProfile: 1 };
      const d = prio[b.chargingProfilePurpose] - prio[a.chargingProfilePurpose];
      return d || b.stackLevel - a.stackLevel;
    });
    const win = arr[0];
    const per = win.chargingSchedule.chargingSchedulePeriod[0];
    let limitW = per.limit;
    if (win.chargingSchedule.chargingRateUnit === "A") {
      const phases = per.numberPhases ?? this.defaultPhases;
      const U = phases === 1 ? this.defaultVoltage : this.defaultVoltage * Math.sqrt(3);
      limitW = per.limit * U * phases;
    }
    return {
      profileId: win.chargingProfileId,
      purpose: win.chargingProfilePurpose,
      stackLevel: win.stackLevel,
      limitW: Math.min(limitW, this.maxPowerW),
      source: "profile",
      timestamp: now,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Types & Utils                                                              */
/* -------------------------------------------------------------------------- */

type LogEntry = { ts: string; line: string };
type SessionItem = {
  id: string;
  cpId: string;
  url: string | null;
  status: "connected" | "booted" | "authorized" | "started" | "stopped" | "closed" | "error";
  txId?: number | null;
  metrics?: { stationKwMax?: number; backendKwMax?: number; voltage?: number; phases?: number };
};

type SessionStats = {
  powerKw: number;
  energyKwh: number;
  soc: number;
  startTime: number | null;
  vehicle: string;
};

const DEFAULT_VOLTAGE = 230;
const DEFAULT_PHASES: Record<string, number> = { "ac-mono": 1, "ac-bi": 2, "ac-tri": 3, dc: 3 };

const ASSETS = {
  stationAC: "/images/charger-ac.png",
  stationDC: "/images/charger-dc.png",
  connectors: {
    left: "/images/connecteur vers la droite.png",
    right: "/images/connecteur vers la gauche.png",
  },
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const ewma = (prev: number | null, v: number, alpha = 0.25) => (prev == null ? v : prev + alpha * (v - prev));

async function j<T = any>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${p}`, { headers: { "Content-Type": "application/json" }, ...(init || {}) });
  const t = await r.text();
  try {
    return JSON.parse(t) as T;
  } catch {
    return t as any;
  }
}

/* -------------------------------------------------------------------------- */
/*  Dashboard Global                                                           */
/* -------------------------------------------------------------------------- */

function GlobalDashboard({ sessions, stats }: { sessions: SessionItem[]; stats: Map<string, SessionStats> }) {
  const totalPower = Array.from(stats.values()).reduce((sum, s) => sum + s.powerKw, 0);
  const totalEnergy = Array.from(stats.values()).reduce((sum, s) => sum + s.energyKwh, 0);
  const activeCharging = sessions.filter(s => s.status === "started").length;
  const avgSoc = stats.size > 0
    ? Array.from(stats.values()).reduce((sum, s) => sum + s.soc, 0) / stats.size
    : 0;

  return (
    <div className="rounded-lg border bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Tableau de bord global</h2>
        <div className="text-sm text-slate-500">
          {new Date().toLocaleTimeString('fr-FR')}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 p-3">
          <div className="text-xs text-blue-600 font-medium">Sessions actives</div>
          <div className="text-2xl font-bold text-blue-900">{sessions.length}</div>
          <div className="text-xs text-blue-600 mt-1">{activeCharging} en charge</div>
        </div>

        <div className="rounded-lg bg-gradient-to-br from-emerald-50 to-emerald-100 p-3">
          <div className="text-xs text-emerald-600 font-medium">Puissance totale</div>
          <div className="text-2xl font-bold text-emerald-900">{totalPower.toFixed(1)} kW</div>
          <div className="text-xs text-emerald-600 mt-1">
            {sessions.length > 0 ? `~${(totalPower / sessions.length).toFixed(1)} kW/session` : '—'}
          </div>
        </div>

        <div className="rounded-lg bg-gradient-to-br from-amber-50 to-amber-100 p-3">
          <div className="text-xs text-amber-600 font-medium">Énergie totale</div>
          <div className="text-2xl font-bold text-amber-900">{totalEnergy.toFixed(2)} kWh</div>
          <div className="text-xs text-amber-600 mt-1">Depuis le début</div>
        </div>

        <div className="rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 p-3">
          <div className="text-xs text-purple-600 font-medium">SoC moyen</div>
          <div className="text-2xl font-bold text-purple-900">{avgSoc.toFixed(0)}%</div>
          <div className="text-xs text-purple-600 mt-1">
            {stats.size > 0 ? `${stats.size} véhicule(s)` : '—'}
          </div>
        </div>
      </div>

      {activeCharging > 0 && (
        <div className="mt-4 pt-3 border-t">
          <div className="text-xs text-slate-500 mb-2">Répartition de puissance</div>
          <div className="flex gap-1">
            {Array.from(stats.entries()).map(([id, stat]) => {
              const session = sessions.find(s => s.id === id);
              if (!session || session.status !== "started") return null;
              const width = Math.max(5, (stat.powerKw / totalPower) * 100);
              return (
                <div
                  key={id}
                  className="h-6 bg-gradient-to-r from-blue-500 to-emerald-500 rounded"
                  style={{ width: `${width}%` }}
                  title={`${session.cpId}: ${stat.powerKw.toFixed(1)} kW`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Composants visuels                                                         */
/* -------------------------------------------------------------------------- */

function Connector({ side, size = 96, halo = 10, glow = false }: { side: "left" | "right"; size?: number; halo?: number; glow?: boolean }) {
  const src = side === "left" ? ASSETS.connectors.left : ASSETS.connectors.right;
  const wrap = size + halo * 2;
  return (
    <div className="relative" style={{ width: wrap, height: wrap, transform: side === "left" ? "scaleX(-1)" : undefined, zIndex: 31 }}>
      <div
        className="absolute inset-0 rounded-full bg-white/92 ring-1 ring-slate-200"
        style={{ boxShadow: glow ? "0 10px 30px rgba(16,185,129,0.25)" : "0 6px 20px rgba(2,6,23,0.18)" }}
      />
      <img
        src={src}
        alt=""
        className="absolute"
        style={{ width: size, height: size, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    </div>
  );
}

function Cable({
  containerRef,
  aRef,
  bRef,
  show,
  charging,
  sag = 0.46,
  drop = 26,
  z = 25,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  aRef: React.RefObject<HTMLDivElement>;
  bRef: React.RefObject<HTMLDivElement>;
  show: boolean;
  charging: boolean;
  sag?: number;
  drop?: number;
  z?: number;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0, d: "" });
  const pathRef = useRef<SVGPathElement>(null);
  const [L, setL] = useState(0);
  const [off, setOff] = useState(0);

  useEffect(() => {
    if (!show) return;
    const upd = () => {
      const c = containerRef.current, a = aRef.current, b = bRef.current;
      if (!c || !a || !b) return;
      const rc = c.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const x1 = ra.left + ra.width / 2 - rc.left;
      const y1 = ra.top + ra.height / 2 - rc.top;
      const x2 = rb.left + rb.width / 2 - rc.left;
      const y2 = rb.top + rb.height / 2 - rc.top;
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const s = clamp(dist * sag, 60, 200);
      const cx1 = x1 + dx * 0.28;
      const cy1 = y1 + s + drop;
      const cx2 = x2 - dx * 0.28;
      const cy2 = y2 + s * 0.85 + drop;
      const d = `M ${x1},${y1} C ${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
      setDims({ w: rc.width, h: rc.height, d });
      requestAnimationFrame(() => {
        const P = pathRef.current;
        if (!P) return;
        const len = P.getTotalLength();
        setL(len);
        setOff(len);
        requestAnimationFrame(() => setOff(0));
      });
    };
    upd();
    const id = setInterval(upd, 400);
    window.addEventListener("resize", upd);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", upd);
    };
  }, [containerRef, aRef, bRef, show, sag, drop]);

  if (!show) return null;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(1, dims.w)} ${Math.max(1, dims.h)}`} style={{ position: "absolute", inset: 0, zIndex: z }}>
      <defs>
        <filter id="cable-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
          <feOffset dx="0" dy="4" result="o" />
          <feFlood floodColor="rgba(0,0,0,0.25)" />
          <feComposite in2="o" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {charging && (
          <linearGradient id="energy" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        )}
      </defs>
      <path ref={pathRef} d={dims.d} stroke="#0f172a" strokeWidth={18} strokeLinecap="round" fill="none" filter="url(#cable-shadow)" style={{ strokeDasharray: L, strokeDashoffset: off, transition: "stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)" }} />
      {charging && <path d={dims.d} stroke="url(#energy)" strokeWidth={6} strokeLinecap="round" fill="none" strokeDasharray="12 20" style={{ animation: "dash 1.5s linear infinite" }} />}
      <style>{`@keyframes dash{from{stroke-dashoffset:0}to{stroke-dashoffset:-80}}`}</style>
    </svg>
  );
}

function ChargeDisplay({ soc, kw, kwh, elapsed, on, vehicleName }: { soc: number; kw: number; kwh: number; elapsed: string; on: boolean; vehicleName?: string }) {
  const dash = `${(soc / 100) * 251.2}, 251.2`;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-2 rounded-xl px-4 py-3 bg-white/85 backdrop-blur-md border border-slate-200 shadow-lg select-none" style={{ minWidth: 240 }}>
      {vehicleName && (
        <div className="text-xs text-slate-500 mb-1">{vehicleName}</div>
      )}
      <div className="flex items-center gap-4">
        <svg width="84" height="84" viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="40" fill="none" stroke="#e5e7eb" strokeWidth="8" />
          <circle cx="45" cy="45" r="40" fill="none" stroke={soc > 80 ? "#10b981" : soc > 20 ? "#3b82f6" : "#ef4444"} strokeWidth="8" strokeDasharray={dash} strokeLinecap="round" transform="rotate(-90 45 45)" style={{ transition: "stroke-dasharray .35s ease" }} />
          <text x="45" y="45" textAnchor="middle" dominantBaseline="middle" className="fill-slate-900">
            <tspan fontSize="24" fontWeight="bold">{Math.round(soc)}</tspan>
            <tspan fontSize="14" dy="14" x="45">%</tspan>
          </text>
        </svg>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold">{kw.toFixed(1)}</span>
            <span className="text-lg text-slate-600">kW</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold">{kwh.toFixed(2)}</span>
            <span className="text-sm text-slate-500">kWh</span>
          </div>
          <div className="text-sm text-slate-600 font-mono">
            {elapsed}
            {on && kw > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 animate-pulse">
                en charge
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mini graphique                                                             */
/* -------------------------------------------------------------------------- */

type Serie = Array<{ t: number; y: number }>;

function MiniChart({ seriesP, seriesSoc, maxKw = 50 }: { seriesP: Serie; seriesSoc: Serie; maxKw?: number }) {
  const W = 400;
  const H = 120;
  const pad = 10;

  const all = [...seriesP, ...seriesSoc];
  const tmin = all.length ? Math.min(...all.map(p => p.t)) : 0;
  const tmax = all.length ? Math.max(...all.map(p => p.t)) : 1;

  const xOf = (t: number) => pad + ((t - tmin) / Math.max(1, tmax - tmin)) * (W - pad * 2);
  const yOfP = (y: number) => H - pad - (clamp(y, 0, maxKw) / Math.max(1, maxKw)) * (H - pad * 2);
  const yOfS = (y: number) => H - pad - (clamp(y, 0, 100) / 100) * (H - pad * 2);

  const pathP = seriesP.map(p => `${xOf(p.t)},${yOfP(p.y)}`).join(" ");
  const pathS = seriesSoc.map(p => `${xOf(p.t)},${yOfS(p.y)}`).join(" ");

  return (
    <svg width={W} height={H} className="rounded border border-slate-200 bg-gradient-to-br from-white to-slate-50">
      <defs>
        <linearGradient id="gradP" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 25, 50, 75, 100].map(p => {
        const y = H - pad - (p / 100) * (H - pad * 2);
        return (
          <line key={p} x1={pad} y1={y} x2={W - pad} y2={y} stroke="#e5e7eb" strokeWidth={1} strokeDasharray={p === 0 ? "0" : "2 2"} />
        );
      })}

      {seriesP.length > 1 && (
        <>
          <path
            d={`M ${xOf(seriesP[0].t)},${yOfP(0)} L ${pathP} L ${xOf(seriesP[seriesP.length - 1].t)},${yOfP(0)} Z`}
            fill="url(#gradP)"
            opacity={0.3}
          />
          <polyline
            fill="none"
            stroke="#10b981"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pathP}
          />
        </>
      )}

      {seriesSoc.length > 1 && (
        <polyline
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 2"
          opacity={0.7}
          points={pathS}
        />
      )}

      <text x={W - pad - 20} y={H - 2} fill="#64748b" fontSize="10">kW</text>
      <text x={W - pad - 20} y={pad + 10} fill="#3b82f6" fontSize="10">SoC%</text>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Carte Session                                                              */
/* -------------------------------------------------------------------------- */

function SessionCard({
  s,
  onClosed,
  onStatsUpdate,
  expanded = false,
  onToggleExpand,
  vehicles
}: {
  s: SessionItem;
  onClosed: () => void;
  onStatsUpdate: (stats: SessionStats) => void;
  expanded?: boolean;
  onToggleExpand: () => void;
  vehicles: string[];
}) {
  const tnr = useTNR();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isParked, setIsParked] = useState(false);
  const [isPlugged, setIsPlugged] = useState(false);
  const [vehicle, setVehicle] = useState<string>(vehicles[0] || "Generic EV");
  const [maxA, setMaxA] = useState(32);
  const [evseType, setEvseType] = useState<"ac-mono" | "ac-bi" | "ac-tri" | "dc">("ac-mono");
  const [idTag, setIdTag] = useState("TAG-001");
  const [mvEvery, setMvEvery] = useState(10);
  const [socStart, setSocStart] = useState(20);
  const [socTarget, setSocTarget] = useState(80);
  const [showLogs, setShowLogs] = useState(false);

  // Données temps réel
  const pFilt = useRef<number | null>(0);
  const socFilt = useRef<number | null>(socStart);
  const lastMs = useRef<number | null>(null);
  const eFromP = useRef(0);
  const [seriesP, setSeriesP] = useState<Serie>([]);
  const [seriesSoc, setSeriesSoc] = useState<Serie>([]);
  const startMs = useRef<number | null>(null);

  // OCPP profiles
  const managerRef = useRef(new OCPPChargingProfilesManager({
    maxPowerW: 22000,
    defaultVoltage: DEFAULT_VOLTAGE,
    defaultPhases: DEFAULT_PHASES[evseType] ?? 3
  }));

  // Véhicule sélectionné
  const vehProfile = useMemo(() => getVehicleByName(vehicle), [vehicle]);

  // Update stats
  useEffect(() => {
    onStatsUpdate({
      powerKw: pFilt.current ?? 0,
      energyKwh: eFromP.current,
      soc: socFilt.current ?? socStart,
      startTime: startMs.current,
      vehicle
    });
  }, [seriesP, seriesSoc, vehicle, onStatsUpdate, socStart]);

  // Polling logs
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const arr: LogEntry[] = await j(`/api/simu/${s.id}/logs`);
        setLogs(arr.slice(-400));
      } catch {}
      setTimeout(tick, 1000);
    };
    tick();
    return () => { stop = true; };
  }, [s.id]);

  // Parse logs
  useEffect(() => {
    const recent = logs.slice(-80);
    if (!recent.length) return;
    const now = Date.now();

    recent.forEach((l) => {
      if (/MeterValues/i.test(l.line)) {
        const i1 = l.line.indexOf("{"), i2 = l.line.lastIndexOf("}");
        if (i1 !== -1 && i2 !== -1 && i2 > i1) {
          try {
            const payload = JSON.parse(l.line.slice(i1, i2 + 1));
            const mvs = payload?.meterValue ?? [];
            let paKw: number | undefined;
            let soc: number | undefined;
            mvs.forEach((mv: any) =>
              (mv.sampledValue ?? []).forEach((it: any) => {
                const meas = String(it?.measurand || "");
                const val = Number(it?.value);
                const unit = String(it?.unit || "");
                if (meas === "Power.Active.Import") paKw = unit === "W" ? val / 1000 : val;
                if (meas === "SoC") soc = val;
              })
            );
            if (paKw != null) {
              const last = lastMs.current;
              lastMs.current = now;
              if (last != null) eFromP.current += Math.max(0, paKw) * ((now - last) / 3600000);
              pFilt.current = ewma(pFilt.current, Math.max(0, paKw));
              setSeriesP((v) => [...v, { t: now, y: pFilt.current ?? 0 }].slice(-900));
            }
            if (soc != null) {
              socFilt.current = ewma(socFilt.current, clamp(soc, 0, 100));
              setSeriesSoc((v) => [...v, { t: now, y: socFilt.current ?? 0 }].slice(-900));
            }
          } catch {}
        }
      }
      if (/SetChargingProfile/i.test(l.line)) {
        const i1 = l.line.indexOf("{"), i2 = l.line.lastIndexOf("}");
        if (i1 !== -1 && i2 !== -1 && i2 > i1) {
          try {
            const payload = JSON.parse(l.line.slice(i1, i2 + 1));
            const prof = payload?.chargingProfile || payload?.csChargingProfiles;
            const connectorId = payload?.connectorId || 1;
            if (prof) managerRef.current.setChargingProfile(connectorId, prof);
          } catch {}
        }
      }
      if (/ClearChargingProfile/i.test(l.line)) {
        managerRef.current.clearChargingProfile();
      }
    });
  }, [logs]);

  const voltage = s.metrics?.voltage ?? DEFAULT_VOLTAGE;
  const phases = s.metrics?.phases ?? DEFAULT_PHASES[evseType] ?? 1;

  const physicalKw = useMemo(() => {
    const evseKw = (maxA * voltage * phases) / 1000;
    const vehKw = calcPower(vehicle, socFilt.current ?? socStart);
    const stationKw = s.metrics?.stationKwMax ?? Infinity;
    const backendKw = s.metrics?.backendKwMax ?? Infinity;
    return Math.min(evseKw, vehKw, stationKw, backendKw);
  }, [maxA, voltage, phases, s.metrics, vehicle, seriesSoc, socStart]);

  const profileState = managerRef.current.getConnectorState(1);
  const appliedKw = profileState.effectiveLimit.source === "profile"
    ? Math.min(profileState.effectiveLimit.limitW / 1000, physicalKw)
    : physicalKw;

  const containerRef = useRef<HTMLDivElement>(null);
  const portA = useRef<HTMLDivElement>(null);
  const portB = useRef<HTMLDivElement>(null);

  const powerNow = pFilt.current ?? 0;
  const kwh = eFromP.current;
  const socNow = socFilt.current ?? socStart;

  // Simulation loop
  useEffect(() => {
    if (s.status !== "started") return;
    startMs.current ??= Date.now();
    const id = setInterval(() => {
      const vehKw = calcPower(vehicle, socFilt.current ?? socStart);
      const target = Math.min(vehKw, appliedKw);
      pFilt.current = ewma(pFilt.current, target);
      const now = Date.now();
      setSeriesP((v) => [...v, { t: now, y: pFilt.current ?? 0 }].slice(-900));
      eFromP.current += Math.max(0, pFilt.current ?? 0) * (1 / 3600);
      const cap = getCapacity(vehicle);
      const eff = getEfficiency(vehicle);
      const dSoc = (((pFilt.current ?? 0) * (1 / 3600)) / cap) * 100 * eff;
      socFilt.current = clamp((socFilt.current ?? socStart) + dSoc, 0, 100);
      setSeriesSoc((v) => [...v, { t: now, y: socFilt.current ?? 0 }].slice(-900));
    }, 1000);
    return () => clearInterval(id);
  }, [s.status, appliedKw, vehicle, socStart]);

  const elapsed = useMemo(() => {
    if (!startMs.current || s.status !== "started") return "00:00:00";
    const sec = Math.floor((Date.now() - startMs.current) / 1000);
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return `${h}:${m}:${ss}`;
  }, [s.status, seriesP]);

  const remainingMinutes = useMemo(
    () => s.status === "started" ? estimateMinutes(vehicle, socNow, socTarget) : 0,
    [vehicle, socNow, socTarget, s.status]
  );

  // Actions
  const post = (p: string, body?: any) => j(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const onDisconnect = async () => {
    await j(`/api/simu/${s.id}`, { method: "DELETE" }).catch(() => {});
    onClosed();
  };
  const onPark = async () => {
    await post(`/api/simu/${s.id}/park`).catch(() => post(`/api/simu/${s.id}/status/park`));
    setIsParked(true);
  };
  const onLeave = async () => {
    if (s.status === "started" || isPlugged) return;
    await post(`/api/simu/${s.id}/leave`).catch(() => post(`/api/simu/${s.id}/status/unpark`));
    setIsParked(false);
  };
  const onPlug = async () => {
    if (!isParked || isPlugged) return;
    await post(`/api/simu/${s.id}/plug`).catch(() => post(`/api/simu/${s.id}/status/plug`));
    setIsPlugged(true);
  };
  const onUnplug = async () => {
    if (s.status === "started") return;
    await post(`/api/simu/${s.id}/unplug`).catch(() => post(`/api/simu/${s.id}/status/unplug`));
    setIsPlugged(false);
  };
  const onAuth = async () => {
    if (!isPlugged || s.status === "authorized" || s.status === "started") return;
    await post(`/api/simu/${s.id}/authorize`, { idTag });
    if (tnr.isRecording) await tnr.tapEvent("session", "Authorize", { idTag }, s.id);
  };
  const onStart = async () => {
    if (!isPlugged || s.status !== "authorized") return;
    await post(`/api/simu/${s.id}/startTx`, { connectorId: 1 });
    await post(`/api/simu/${s.id}/mv/start`, { periodSec: mvEvery }).catch(() => {});
    startMs.current = Date.now();
    if (tnr.isRecording) await tnr.tapEvent("session", "StartTransaction", { connectorId: 1, mvEvery }, s.id);
  };
  const onStop = async () => {
    if (s.status !== "started") return;
    await post(`/api/simu/${s.id}/mv/stop`).catch(() => {});
    await post(`/api/simu/${s.id}/stopTx`);
    if (tnr.isRecording) await tnr.tapEvent("session", "StopTransaction", {}, s.id);
  };

  return (
    <div className={`rounded-lg border ${expanded ? 'border-blue-400' : 'border-slate-200'} bg-white shadow-sm transition-all duration-300 ${expanded ? 'shadow-lg' : ''}`}>
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleExpand}
              className="p-1 hover:bg-slate-100 rounded transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <div>
              <div className="font-semibold">{s.cpId}</div>
              <div className="text-xs text-slate-500">
                Status: <span className={`font-medium ${s.status === 'started' ? 'text-emerald-600' : 'text-slate-600'}`}>{s.status}</span>
                {s.txId && <span> • Tx: {s.txId}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200"
            >
              Logs
            </button>
            <button onClick={onDisconnect} className="px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-500 text-sm">
              Fermer
            </button>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className={`p-3 ${expanded ? '' : 'hidden'}`}>
        <div className="grid grid-cols-12 gap-3">
          {/* Panneau de contrôle */}
          <div className="col-span-4">
            <div className="text-xs mb-1">Véhicule</div>
            <select className="w-full border rounded px-2 py-1" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              {vehicles.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs mb-1">Type EVSE</div>
                <select className="w-full border rounded px-2 py-1" value={evseType} onChange={(e) => setEvseType(e.target.value as any)}>
                  <option value="ac-mono">AC Mono</option>
                  <option value="ac-bi">AC Bi</option>
                  <option value="ac-tri">AC Tri</option>
                  <option value="dc">DC</option>
                </select>
              </div>
              <div>
                <div className="text-xs mb-1">Max (A)</div>
                <input type="number" className="w-full border rounded px-2 py-1" value={maxA} onChange={(e) => setMaxA(Number(e.target.value || 0))} />
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs mb-1">idTag</div>
                <input className="w-full border rounded px-2 py-1" value={idTag} onChange={(e) => setIdTag(e.target.value)} />
              </div>
              <div>
                <div className="text-xs mb-1">MV période (s)</div>
                <input type="number" min={1} className="w-full border rounded px-2 py-1" value={mvEvery} onChange={(e) => setMvEvery(Number(e.target.value || 1))} />
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs mb-1">SoC départ (%)</div>
                <input type="number" className="w-full border rounded px-2 py-1" value={socStart} onChange={(e) => setSocStart(clamp(Number(e.target.value || 0), 0, 100))} />
              </div>
              <div>
                <div className="text-xs mb-1">SoC cible (%)</div>
                <input type="number" className="w-full border rounded px-2 py-1" value={socTarget} onChange={(e) => setSocTarget(clamp(Number(e.target.value || 0), 0, 100))} />
              </div>
            </div>

            {/* Boutons */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded border p-2 bg-slate-50">
                <div className="text-xs text-slate-500 font-semibold mb-2">Borne</div>
                <div className="grid grid-cols-2 gap-2">
                  <button className={`px-2 py-1 rounded text-sm ${isParked && !isPlugged ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`} onClick={onPlug} disabled={!isParked || isPlugged}>
                    Plug
                  </button>
                  <button className={`px-2 py-1 rounded text-sm ${isPlugged && s.status !== "started" ? "bg-slate-700 text-white" : "bg-slate-200 text-slate-500"}`} onClick={onUnplug} disabled={!isPlugged || s.status === "started"}>
                    Unplug
                  </button>
                  <button className={`px-2 py-1 rounded text-sm ${(isPlugged && s.status !== "authorized" && s.status !== "started") ? "bg-sky-600 text-white" : "bg-sky-200 text-sky-600"}`} onClick={onAuth} disabled={!isPlugged || s.status === "authorized" || s.status === "started"}>
                    Auth
                  </button>
                  <button className={`px-2 py-1 rounded text-sm ${(isPlugged && s.status === "authorized") ? "bg-emerald-600 text-white" : "bg-emerald-200 text-emerald-700"}`} onClick={onStart} disabled={!isPlugged || s.status !== "authorized"}>
                    Start
                  </button>
                  <button className={`col-span-2 px-2 py-1 rounded text-sm ${s.status === "started" ? "bg-rose-600 text-white" : "bg-rose-200 text-rose-700"}`} onClick={onStop} disabled={s.status !== "started"}>
                    Stop
                  </button>
                </div>
              </div>
              <div className="rounded border p-2 bg-slate-50">
                <div className="text-xs text-slate-500 font-semibold mb-2">Véhicule</div>
                <div className="grid grid-cols-2 gap-2">
                  <button className={`px-2 py-1 rounded text-sm ${!isParked && !isPlugged ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`} onClick={onPark} disabled={isParked || isPlugged}>
                    Park
                  </button>
                  <button className={`px-2 py-1 rounded text-sm ${isParked && !isPlugged && s.status !== "started" ? "bg-orange-600 text-white" : "bg-slate-200 text-slate-500"}`} onClick={onLeave} disabled={!isParked || isPlugged || s.status === "started"}>
                    Leave
                  </button>
                </div>
              </div>
            </div>

            {/* Profils OCPP & Info véhicule */}
            <div className="mt-3 rounded border p-2 bg-slate-50 text-sm">
              <div className="text-xs font-semibold mb-1">Charging Profiles</div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Limite active:</span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">
                  {(profileState.effectiveLimit.limitW / 1000).toFixed(1)} kW
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-slate-600">Source:</span>
                <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                  {profileState.effectiveLimit.source === "profile" ? profileState.effectiveLimit.purpose : "Physique"}
                </span>
              </div>
            </div>

            {vehProfile && (
              <div className="mt-3 rounded border p-2 bg-blue-50 text-sm">
                <div className="text-xs font-semibold mb-1">Info véhicule</div>
                <div className="text-xs text-slate-600">
                  <div>Capacité: {vehProfile.capacityKWh} kWh</div>
                  <div>Max: {vehProfile.maxPowerKW} kW</div>
                  {remainingMinutes > 0 && (
                    <div className="mt-1 text-blue-700">
                      Temps restant: ~{Math.floor(remainingMinutes / 60)}h {remainingMinutes % 60}min
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Scène */}
          <div className="col-span-8">
            <div ref={containerRef} className="rounded-xl bg-gradient-to-br from-slate-100 via-white to-slate-50 p-4 relative overflow-hidden" style={{ minHeight: 320 }}>
              {/* Station */}
              <div className="relative select-none" style={{ width: 220, height: 260 }}>
                <img src={evseType === "dc" ? ASSETS.stationDC : ASSETS.stationAC} className="max-w-[95%] max-h-[95%] object-contain" />
                <div className="absolute" style={{ left: 176, top: 138, transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 31 }}>
                  <div ref={portA} className="absolute" style={{ left: "50%", top: "50%", width: 1, height: 1, transform: "translate(-50%,-50%)" }} />
                  <Connector side="left" glow={s.status === "started"} />
                </div>
                {s.status === "started" && <ChargeDisplay soc={socNow} kw={powerNow} kwh={kwh} elapsed={elapsed} on vehicleName={vehicle} />}
              </div>

              {/* Voiture */}
              {isParked && (
                <div className="absolute right-2 top-2 select-none" style={{ width: 760, height: 250 }}>
                  <img
                    src={vehProfile?.imageUrl || "/images/generic-ev.png"}
                    className="object-contain"
                    style={{ maxWidth: 720, maxHeight: 250 }}
                    onError={(e) => { (e.target as HTMLImageElement).src = "/images/generic-ev.png"; }}
                  />
                  <div className="absolute" style={{ left: 42, top: 122, transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 31 }}>
                    <div ref={portB} className="absolute" style={{ left: "50%", top: "50%", width: 1, height: 1, transform: "translate(-50%,-50%)" }} />
                    <Connector side="right" glow={s.status === "started"} />
                  </div>
                </div>
              )}

              {/* Câble */}
              {isParked && isPlugged && (
                <Cable containerRef={containerRef} aRef={portA} bRef={portB} show charging={s.status === "started"} sag={0.46} drop={26} />
              )}
            </div>

            {/* Graphique */}
            <div className="mt-3">
              <MiniChart seriesP={seriesP} seriesSoc={seriesSoc} maxKw={Math.ceil(physicalKw * 1.2)} />
            </div>

            {/* Métriques */}
            <div className="grid grid-cols-4 gap-3 mt-3">
              <div className="rounded border p-2 bg-emerald-50">
                <div className="text-xs text-emerald-700 mb-1">Énergie</div>
                <div className="text-lg font-semibold">{kwh.toFixed(2)} kWh</div>
              </div>
              <div className="rounded border p-2 bg-blue-50">
                <div className="text-xs text-blue-700 mb-1">Puissance</div>
                <div className="text-lg font-semibold">{powerNow.toFixed(1)} kW</div>
              </div>
              <div className="rounded border p-2 bg-amber-50">
                <div className="text-xs text-amber-700 mb-1">SoC</div>
                <div className="text-lg font-semibold">{socNow.toFixed(0)}%</div>
              </div>
              <div className="rounded border p-2 bg-slate-50">
                <div className="text-xs text-slate-600 mb-1">Limite</div>
                <div className="text-lg font-semibold">{appliedKw.toFixed(1)} kW</div>
              </div>
            </div>
          </div>
        </div>

        {/* Logs */}
        {showLogs && (
          <div className="mt-3 bg-[#0b1220] text-[#cde3ff] font-mono text-[11px] p-2 overflow-y-auto rounded" style={{ height: 200 }}>
            {logs.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                [{l.ts}] {l.line}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vue compacte */}
      {!expanded && (
        <div className="p-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center">
              <div className="text-xs text-slate-500">Puissance</div>
              <div className="text-lg font-semibold">{powerNow.toFixed(1)} kW</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">Énergie</div>
              <div className="text-lg font-semibold">{kwh.toFixed(2)} kWh</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">SoC</div>
              <div className="text-lg font-semibold">{socNow.toFixed(0)}%</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">Durée</div>
              <div className="text-lg font-semibold font-mono">{elapsed}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Composant principal                                                        */
/* -------------------------------------------------------------------------- */

export default function SimuEvseBoard() {
  const tnr = useTNR();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionStats, setSessionStats] = useState<Map<string, SessionStats>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState("wss://evse-test.total-ev-charge.com/ocpp/WebSocket");
  const [cpId, setCpId] = useState("POP-TEST-001");
  const [autoIncrement, setAutoIncrement] = useState(true);
  const [cpCounter, setCpCounter] = useState(1);
  const [vehicleNames, setVehicleNames] = useState<string[]>([]);

  // Charger les profils véhicules
  useEffect(() => {
    loadVehicleProfiles().then(() => {
      const names = getVehicleNames();
      setVehicleNames(names);
    });
  }, []);

  // Polling des sessions
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const list: SessionItem[] = await j("/api/simu");
        setSessions(list);
      } catch {}
      setTimeout(tick, 1200);
    };
    tick();
    return () => { stop = true; };
  }, []);

  // Créer une nouvelle session
  const onCreate = async () => {
    const finalCpId = autoIncrement ? `${cpId}-${String(cpCounter).padStart(3, '0')}` : cpId;
    const url = wsUrl.endsWith(`/${finalCpId}`) ? wsUrl : `${wsUrl}/${finalCpId}`;

    const res: any = await j("/api/simu/session", {
      method: "POST",
      body: JSON.stringify({
        url,
        cpId: finalCpId,
        idTag: `TAG-${String(cpCounter).padStart(3, '0')}`,
        auto: false,
        evseType: "ac-mono",
        maxA: 32
      }),
    }).catch(() => ({}));

    if (res?.id) {
      if (autoIncrement) setCpCounter(cpCounter + 1);
      setExpandedId(res.id);
      if (tnr.isRecording) {
        await tnr.tapEvent("session", "CREATE", { url, cpId: finalCpId }, res.id);
      }
    } else {
      alert("Erreur de création de session");
    }
  };

  const handleStatsUpdate = (id: string) => (stats: SessionStats) => {
    setSessionStats(prev => {
      const newMap = new Map(prev);
      newMap.set(id, stats);
      return newMap;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Dashboard global */}
      <GlobalDashboard sessions={sessions} stats={sessionStats} />

      {/* Créateur de session */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="font-semibold mb-3">Nouvelle session</div>
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-5">
            <div className="text-xs mb-1">OCPP WebSocket URL</div>
            <input
              className="w-full border rounded px-2 py-1"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="wss://..."
            />
          </div>
          <div className="col-span-3">
            <div className="text-xs mb-1">CP-ID {autoIncrement && `(base)`}</div>
            <input
              className="w-full border rounded px-2 py-1"
              value={cpId}
              onChange={(e) => setCpId(e.target.value)}
              placeholder="POP-TEST"
            />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoIncrement}
                onChange={(e) => setAutoIncrement(e.target.checked)}
              />
              Auto-increment
            </label>
          </div>
          <div className="col-span-2">
            <button
              className="w-full px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500 font-medium"
              onClick={onCreate}
            >
              Créer session
            </button>
          </div>
        </div>
      </div>

      {/* Liste des sessions */}
      <div className="space-y-4">
        {sessions.map((s) => (
          <SessionCard
            key={s.id}
            s={s}
            onClosed={() => {
              setSessions((x) => x.filter((i) => i.id !== s.id));
              setSessionStats(prev => {
                const newMap = new Map(prev);
                newMap.delete(s.id);
                return newMap;
              });
            }}
            onStatsUpdate={handleStatsUpdate(s.id)}
            expanded={expandedId === s.id}
            onToggleExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
            vehicles={vehicleNames}
          />
        ))}
        {!sessions.length && (
          <div className="rounded-lg border bg-white p-8 text-center text-slate-500">
            <div className="text-lg mb-2">Aucune session active</div>
            <div className="text-sm">Créez votre première session avec le formulaire ci-dessus</div>
          </div>
        )}
      </div>

      {/* Footer avec stats */}
      <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
        <div className="flex justify-between items-center">
          <div>
            Sessions max simultanées: {sessions.length} •
            Charges actives: {sessions.filter(s => s.status === "started").length}
          </div>
          <div>
            {tnr.isRecording && (
              <span className="inline-flex items-center gap-2 px-2 py-1 bg-rose-100 text-rose-700 rounded">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
                </span>
                Recording: {tnr.recEvents} events
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}