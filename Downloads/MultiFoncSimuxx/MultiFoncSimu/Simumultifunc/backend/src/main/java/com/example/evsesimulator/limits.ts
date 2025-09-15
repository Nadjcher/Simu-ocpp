// src/limits.ts

export type EvseType = "ac-mono" | "ac-bi" | "ac-tri" | "dc";
export type VehicleProfileFE = {
    id: string;
    name: string;
    maxChargingPowerAC?: number; // W
    maxChargingPowerDC?: number; // W
    maxChargingCurrentAC?: number; // A (par phase)
    phases?: 1 | 2 | 3;
    acPowerCurve?: { socFrom: number; socTo: number; kw: number }[];
    dcPowerCurve?: { socFrom: number; socTo: number; kw: number }[];
};
export type ActiveProfiles = {
    txProfileLimitW?: number | null;
    txProfileIsCurrent?: boolean;
    txDefaultLimitW?: number | null;
    txDefaultIsCurrent?: boolean;
    stationMaxLimitW?: number | null;
};
export type LimitInputs = {
    evseType: EvseType;
    maxAFrontend?: number | null;
    evVoltage?: number;
    vehicle: VehicleProfileFE;
    socPct: number;
    backendStationW?: number | null;
    profiles: ActiveProfiles;
    connectorPhases?: 1 | 2 | 3;
};
export type LimitsState = {
    physicalKw: number | null;
    appliedKw: number | null;
    debug: {
        vehKw: number;
        hwKw: number | null;
        stationKw: number | null;
        pickedProfileKw: number | null;
    };
};

// helpers internes
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const kw = (w: number) => w / 1000;

function acSystemVoltage(phases: 1 | 2 | 3 | undefined, evVoltage?: number) {
    return evVoltage && evVoltage > 0 ? evVoltage : 230;
}

function evCurveKw(vehicle: VehicleProfileFE, soc: number, dc: boolean) {
    const curve = dc ? vehicle.dcPowerCurve : vehicle.acPowerCurve;
    if (curve && curve.length) {
        const s = clamp(soc, 0, 100);
        const seg = curve.find((c) => s >= c.socFrom && s < c.socTo);
        if (seg) return seg.kw;
    }
    const maxW = dc
        ? vehicle.maxChargingPowerDC ?? Infinity
        : vehicle.maxChargingPowerAC ?? Infinity;
    return kw(maxW === Infinity ? 1e12 : maxW);
}

function acHardwareKw(inp: LimitInputs) {
    const phases =
        inp.connectorPhases ??
        (inp.evseType === "ac-tri" ? 3 : inp.evseType === "ac-bi" ? 2 : 1);
    const v = acSystemVoltage(phases as 1 | 2 | 3, inp.evVoltage);
    const evMaxA = inp.vehicle.maxChargingCurrentAC ?? Infinity;
    const uiMaxA = inp.maxAFrontend ?? Infinity;
    const currentA = Math.min(evMaxA, uiMaxA);
    if (!isFinite(currentA)) return Infinity;
    const pW = v * currentA * phases;
    return kw(pW);
}

function stationBackendKw(inp: LimitInputs) {
    const w = inp.backendStationW;
    return w && w > 0 ? kw(w) : Infinity;
}

function ocppAppliedKw(inp: LimitInputs): number | null {
    const phases =
        inp.connectorPhases ??
        (inp.evseType === "ac-tri" ? 3 : inp.evseType === "ac-bi" ? 2 : 1);
    const v = acSystemVoltage(phases as 1 | 2 | 3, inp.evVoltage);
    const pick = (valW?: number | null, isCurrent?: boolean): number | null => {
        if (!valW || valW <= 0) return null;
        if (inp.evseType === "dc") return kw(valW);
        if (!isCurrent) return kw(valW);
        const pW = v * valW * phases; // A → W
        return kw(pW);
    };
    const tx = pick(inp.profiles.txProfileLimitW, inp.profiles.txProfileIsCurrent);
    if (tx) return tx;
    const tdp = pick(
        inp.profiles.txDefaultLimitW,
        inp.profiles.txDefaultIsCurrent
    );
    if (tdp) return tdp;
    const st =
        inp.profiles.stationMaxLimitW && inp.profiles.stationMaxLimitW > 0
            ? kw(inp.profiles.stationMaxLimitW)
            : null;
    return st;
}

// fonction principale
export function computeLimits(inp: LimitInputs): LimitsState {
    const isDC = inp.evseType === "dc";
    const hwKw = isDC ? Infinity : acHardwareKw(inp);
    const stationKw = stationBackendKw(inp);
    const vehKw = evCurveKw(inp.vehicle, inp.socPct, isDC);
    const physicalKw = Math.min(hwKw, stationKw, vehKw);
    const appliedFromProfilesKw = ocppAppliedKw(inp);
    const appliedKw =
        appliedFromProfilesKw != null
            ? Math.max(0, Math.min(physicalKw, appliedFromProfilesKw))
            : physicalKw;
    return {
        physicalKw: isFinite(physicalKw) ? +physicalKw.toFixed(2) : null,
        appliedKw: isFinite(appliedKw) ? +appliedKw.toFixed(2) : null,
        debug: {
            vehKw: +vehKw.toFixed(2),
            hwKw: isFinite(hwKw) ? +hwKw.toFixed(2) : null,
            stationKw: isFinite(stationKw) ? +stationKw.toFixed(2) : null,
            pickedProfileKw:
                appliedFromProfilesKw != null
                    ? +appliedFromProfilesKw.toFixed(2)
                    : null,
        },
    };
}
