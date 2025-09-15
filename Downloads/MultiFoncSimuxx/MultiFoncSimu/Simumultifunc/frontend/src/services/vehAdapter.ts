// src/services/vehAdapter.ts
// Adaptateur robuste pour VehicleProfileService (sans imports qui cassent Vite)

export type ChargingPoint = { soc: number; powerKW: number };

export type VehicleProfile = {
  id: string;
  manufacturer?: string;
  model?: string;
  variant?: string;
  name?: string;
  capacityKWh: number;
  maxCurrentA?: number;
  maxPowerKW?: number;
  efficiency?: number;
  connectorType?: 'Type2' | 'CCS' | 'CHAdeMO' | string;
  imageUrl?: string;
  chargingCurve?: ChargingPoint[];
  curve?: ChargingPoint[];
};

let loaded = false;
let profiles: VehicleProfile[] = [];

/** Normalise differents formats de service vers VehicleProfile[] */
function normalize(input: any): VehicleProfile[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : Object.values(input);

  return arr.map((v: any) => {
    const curve = (v.chargingCurve ?? v.curve ?? []).map((p: any) => ({
      soc: Number(p.soc ?? p.socFrom ?? p.socTo ?? 0),
      powerKW: Number(p.powerKW ?? p.kw ?? p.power ?? 0),
    })).sort((a: ChargingPoint, b: ChargingPoint) => a.soc - b.soc);

    const name = (v.name ?? `${v.manufacturer ?? ''} ${v.model ?? ''} ${v.variant ?? ''}`.trim()) || 'EV';

    return {
      id: String(v.id ?? v.key ?? name.toLowerCase().replace(/\s+/g, '_')),
      manufacturer: v.manufacturer ?? v.make,
      model: v.model,
      variant: v.variant,
      name,
      capacityKWh: Number(v.capacityKWh ?? v.capacity ?? 60),
      maxCurrentA: v.maxCurrentA,
      maxPowerKW: Number(v.maxPowerKW ?? v.maxPower ?? (Math.max(...curve.map((c: ChargingPoint) => c.powerKW), 22) || 22)),
      efficiency: Number(v.efficiency ?? 0.92),
      connectorType: v.connectorType,
      imageUrl: v.imageUrl ?? v.image,
      chargingCurve: curve,
      curve
    } as VehicleProfile;
  });
}

/** Interpolation lineaire sur la courbe */
export function calcPowerFromCurve(v: VehicleProfile, soc: number): number {
  const curve = v.chargingCurve ?? v.curve ?? [];
  if (!curve.length) return v.maxPowerKW ?? 22;

  const x = Math.max(0, Math.min(100, soc));

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (x >= a.soc && x <= b.soc) {
      const t = (x - a.soc) / Math.max(1e-6, (b.soc - a.soc));
      return a.powerKW + t * (b.powerKW - a.powerKW);
    }
  }
  return curve[curve.length - 1].powerKW ?? 0;
}

/** Charge les profils vehicules en utilisant import.meta.glob (safe pour Vite) */
export async function loadVehicleProfiles(): Promise<VehicleProfile[]> {
  if (loaded) return profiles;

  // Recherche de fichiers avec glob (ne casse pas si absent)
  const candidates = import.meta.glob([
    '/src/services/VehicleProfileService.{ts,tsx,js}',
    '/src/ocpp/VehicleProfileService.{ts,tsx,js}',
    '/src/**/VehicleProfileService.{ts,tsx,js}',
  ]);

  // Essaye chaque module trouve
  for (const [path, loader] of Object.entries(candidates)) {
    try {
      const mod: any = await loader();

      // Style 1: export async function getVehicleProfiles()
      if (typeof mod.getVehicleProfiles === 'function') {
        const arr = await mod.getVehicleProfiles();
        profiles = normalize(arr);
        loaded = profiles.length > 0;
        if (loaded) return profiles;
      }

      // Style 2: export default class VehicleProfileService
      if (mod.default && typeof mod.default === 'function') {
        const svc = new mod.default();
        const arr = await (svc.getVehicleProfiles?.() ?? svc.getAllProfiles?.() ?? svc.getProfiles?.());
        if (arr) {
          profiles = normalize(arr);
          loaded = profiles.length > 0;
          if (loaded) return profiles;
        }
      }

      // Style 3: export const VEHICLES ou vehicleProfiles
      const bag = mod.VEHICLES ?? mod.vehicleProfiles ?? mod.profiles ?? mod.default?.VEHICLES;
      if (bag) {
        profiles = normalize(bag);
        loaded = profiles.length > 0;
        if (loaded) return profiles;
      }
    } catch (e) {
      console.warn('[vehAdapter] Failed to load', path, e);
    }
  }

  // Fallback complet si aucun service trouve
  profiles = normalize([
    {
      id: 'tesla_model3_lr',
      manufacturer: 'Tesla',
      model: 'Model 3',
      variant: 'Long Range',
      capacityKWh: 75,
      efficiency: 0.95,
      maxPowerKW: 250,
      imageUrl: '/images/tesla-model3 white.png',
      chargingCurve: [
        { soc: 0, powerKW: 250 },
        { soc: 10, powerKW: 250 },
        { soc: 20, powerKW: 240 },
        { soc: 30, powerKW: 220 },
        { soc: 40, powerKW: 190 },
        { soc: 50, powerKW: 160 },
        { soc: 60, powerKW: 130 },
        { soc: 70, powerKW: 100 },
        { soc: 80, powerKW: 70 },
        { soc: 90, powerKW: 40 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'tesla_model_y',
      manufacturer: 'Tesla',
      model: 'Model Y',
      variant: 'Long Range',
      capacityKWh: 82,
      efficiency: 0.94,
      maxPowerKW: 250,
      chargingCurve: [
        { soc: 0, powerKW: 250 },
        { soc: 25, powerKW: 230 },
        { soc: 40, powerKW: 200 },
        { soc: 55, powerKW: 150 },
        { soc: 70, powerKW: 110 },
        { soc: 85, powerKW: 60 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'renault_zoe_ze50',
      manufacturer: 'Renault',
      model: 'ZOE',
      variant: 'ZE50',
      capacityKWh: 52,
      efficiency: 0.90,
      maxPowerKW: 46,
      imageUrl: '/images/renault-zoe-silver.jpg',
      chargingCurve: [
        { soc: 0, powerKW: 46 },
        { soc: 20, powerKW: 46 },
        { soc: 40, powerKW: 45 },
        { soc: 60, powerKW: 40 },
        { soc: 80, powerKW: 25 },
        { soc: 90, powerKW: 15 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'nissan_leaf_62',
      manufacturer: 'Nissan',
      model: 'Leaf',
      variant: '62kWh',
      capacityKWh: 62,
      efficiency: 0.88,
      maxPowerKW: 50,
      chargingCurve: [
        { soc: 0, powerKW: 50 },
        { soc: 30, powerKW: 50 },
        { soc: 50, powerKW: 45 },
        { soc: 70, powerKW: 35 },
        { soc: 80, powerKW: 20 },
        { soc: 90, powerKW: 10 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'hyundai_kona_electric',
      manufacturer: 'Hyundai',
      model: 'Kona Electric',
      variant: '64kWh',
      capacityKWh: 64,
      efficiency: 0.92,
      maxPowerKW: 77,
      chargingCurve: [
        { soc: 0, powerKW: 77 },
        { soc: 20, powerKW: 77 },
        { soc: 40, powerKW: 75 },
        { soc: 60, powerKW: 65 },
        { soc: 80, powerKW: 40 },
        { soc: 90, powerKW: 20 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'bmw_i3',
      manufacturer: 'BMW',
      model: 'i3',
      variant: '42kWh',
      capacityKWh: 42.2,
      efficiency: 0.93,
      maxPowerKW: 50,
      chargingCurve: [
        { soc: 0, powerKW: 50 },
        { soc: 30, powerKW: 50 },
        { soc: 50, powerKW: 48 },
        { soc: 70, powerKW: 40 },
        { soc: 80, powerKW: 25 },
        { soc: 90, powerKW: 12 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'vw_id3',
      manufacturer: 'Volkswagen',
      model: 'ID.3',
      variant: 'Pro',
      capacityKWh: 58,
      efficiency: 0.92,
      maxPowerKW: 120,
      chargingCurve: [
        { soc: 0, powerKW: 120 },
        { soc: 30, powerKW: 120 },
        { soc: 50, powerKW: 100 },
        { soc: 70, powerKW: 70 },
        { soc: 85, powerKW: 40 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'audi_e_tron',
      manufacturer: 'Audi',
      model: 'e-tron',
      variant: '55 quattro',
      capacityKWh: 95,
      efficiency: 0.91,
      maxPowerKW: 150,
      chargingCurve: [
        { soc: 0, powerKW: 150 },
        { soc: 20, powerKW: 150 },
        { soc: 40, powerKW: 145 },
        { soc: 60, powerKW: 120 },
        { soc: 80, powerKW: 80 },
        { soc: 90, powerKW: 40 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'porsche_taycan',
      manufacturer: 'Porsche',
      model: 'Taycan',
      variant: 'Turbo',
      capacityKWh: 93.4,
      efficiency: 0.94,
      maxPowerKW: 270,
      chargingCurve: [
        { soc: 0, powerKW: 270 },
        { soc: 5, powerKW: 270 },
        { soc: 20, powerKW: 260 },
        { soc: 35, powerKW: 230 },
        { soc: 50, powerKW: 180 },
        { soc: 65, powerKW: 130 },
        { soc: 80, powerKW: 80 },
        { soc: 95, powerKW: 35 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'mercedes_eqc',
      manufacturer: 'Mercedes-Benz',
      model: 'EQC',
      variant: '400',
      capacityKWh: 80,
      efficiency: 0.90,
      maxPowerKW: 110,
      chargingCurve: [
        { soc: 0, powerKW: 110 },
        { soc: 25, powerKW: 110 },
        { soc: 45, powerKW: 105 },
        { soc: 65, powerKW: 85 },
        { soc: 80, powerKW: 55 },
        { soc: 95, powerKW: 25 },
        { soc: 100, powerKW: 0 }
      ],
    },
    {
      id: 'generic_ev',
      manufacturer: 'Generic',
      model: 'EV',
      variant: 'Standard',
      capacityKWh: 60,
      efficiency: 0.92,
      maxPowerKW: 22,
      chargingCurve: [
        { soc: 0, powerKW: 22 },
        { soc: 40, powerKW: 22 },
        { soc: 60, powerKW: 18 },
        { soc: 80, powerKW: 11 },
        { soc: 100, powerKW: 0 }
      ],
    }
  ]);

  loaded = true;
  return profiles;
}

export function getAllVehicles(): VehicleProfile[] {
  return profiles;
}

export function getVehicle(id: string): VehicleProfile | undefined {
  return profiles.find(v => v.id === id);
}

export function getVehicleNames(): string[] {
  return profiles.map(v => v.name || v.id);
}

export function getVehicleByName(name: string): VehicleProfile | undefined {
  return profiles.find(v => v.name === name || v.id === name);
}

export function calcPower(idOrName: string, soc: number): number {
  const v = getVehicle(idOrName) || getVehicleByName(idOrName);
  return v ? calcPowerFromCurve(v, soc) : 22;
}

export function getCapacity(idOrName: string): number {
  const v = getVehicle(idOrName) || getVehicleByName(idOrName);
  return v?.capacityKWh || 60;
}

export function getEfficiency(idOrName: string): number {
  const v = getVehicle(idOrName) || getVehicleByName(idOrName);
  return v?.efficiency || 0.92;
}

/** Estimation en minutes pour aller de currentSoc a targetSoc */
export function estimateMinutes(idOrName: string, currentSoc: number, targetSoc: number): number {
  const v = getVehicle(idOrName) || getVehicleByName(idOrName);
  if (!v || currentSoc >= targetSoc) return 0;

  let mins = 0;
  let s = currentSoc;
  const step = 1;

  while (s < targetSoc) {
    const p = Math.max(0, calcPowerFromCurve(v, s));
    if (p <= 0.01) break;
    const energyKWh = (v.capacityKWh * step) / 100;
    mins += (energyKWh / p) * 60;
    s += step;
  }
  return Math.round(mins);
}