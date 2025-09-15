// src/services/OCPPChargingProfilesManager.ts
// VERSION COMPLÈTE avec support Recurring, validFrom/To, minChargingRate

export type ChargingProfilePurposeType = "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile";
export type ChargingProfileKindType = "Absolute" | "Recurring" | "Relative";
export type RecurrencyKindType = "Daily" | "Weekly";
export type ChargingRateUnitType = "W" | "A";

export interface ChargingSchedulePeriod {
  startPeriod: number;
  limit: number;
  numberPhases?: number;
}

export interface ChargingSchedule {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: ChargingRateUnitType;
  chargingSchedulePeriod: ChargingSchedulePeriod[];
  minChargingRate?: number;
}

export interface ChargingProfile {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: ChargingProfilePurposeType;
  chargingProfileKind: ChargingProfileKindType;
  chargingSchedule: ChargingSchedule;
  recurrencyKind?: RecurrencyKindType;
  validFrom?: string;
  validTo?: string;
}

export interface ProfileApplication {
  profileId: number;
  purpose: ChargingProfilePurposeType;
  stackLevel: number;
  limitW: number;
  source: "profile" | "physical" | "default";
  timestamp: number;
  nextChangeIn?: number;
  profileDetails?: ChargingProfile;
}

export interface ConnectorConfig {
  voltage: number;
  phases: number;
}

const PURPOSE_PRIORITY: Record<ChargingProfilePurposeType, number> = {
  TxProfile: 3,
  TxDefaultProfile: 2,
  ChargePointMaxProfile: 1
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function msOrSecToSec(value?: number): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  return value > 7 * 24 * 3600 ? Math.round(value / 1000) : Math.round(value);
}

export class OCPPChargingProfilesManager {
  private maxPowerW: number;
  private connectors: Map<number, ConnectorConfig>;
  private profiles: Map<number, Map<number, ChargingProfile>>;
  private effective: Map<number, ProfileApplication>;
  private timers: Map<number, NodeJS.Timeout[]>;
  private lastAppliedLimit: Map<number, number>;
  private transactionStartTimes: Map<number, number>;

  public onLimitChange?: (connectorId: number, limitW: number, source: ProfileApplication) => void;
  public onProfileChange?: (event: any) => void;

  constructor(init?: {
    maxPowerW?: number;
    defaultVoltage?: number;
    defaultPhases?: number;
    onLimitChange?: (connectorId: number, limitW: number, source: ProfileApplication) => void;
    onProfileChange?: (event: any) => void;
  }) {
    this.maxPowerW = init?.maxPowerW || 22000;
    this.connectors = new Map();
    this.profiles = new Map();
    this.effective = new Map();
    this.timers = new Map();
    this.lastAppliedLimit = new Map();
    this.transactionStartTimes = new Map();

    this.onLimitChange = init?.onLimitChange;
    this.onProfileChange = init?.onProfileChange;

    const defaultVoltage = init?.defaultVoltage ?? 230;
    const defaultPhases = init?.defaultPhases ?? 1;
    this.updateConnectorConfig(1, { voltage: defaultVoltage, phases: defaultPhases });
  }

  updateConnectorConfig(connectorId: number, config: ConnectorConfig) {
    console.log(`[OCPPManager] Config connecteur ${connectorId}: ${config.voltage}V, ${config.phases} phase(s)`);
    this.connectors.set(connectorId, {
      voltage: config.voltage,
      phases: Math.max(1, Math.round(config.phases))
    });
    this.recalculate(connectorId);
  }

  markTransactionStart(connectorId: number) {
    this.transactionStartTimes.set(connectorId, Date.now());
    console.log(`[OCPPManager] Transaction démarrée sur connecteur ${connectorId}`);
  }

  markTransactionStop(connectorId: number) {
    this.transactionStartTimes.delete(connectorId);
    console.log(`[OCPPManager] Transaction arrêtée sur connecteur ${connectorId}`);
  }

  private toWatts(
      limit: number,
      unit: ChargingRateUnitType,
      periodPhases: number | undefined,
      connectorId: number
  ): number {
    if (unit === "W") return limit;

    const config = this.connectors.get(connectorId) || { voltage: 230, phases: 1 };
    const phases = periodPhases || config.phases || 1;
    const watts = limit * config.voltage * phases;

    console.log(`[OCPPManager] Conversion A->W: ${limit}A * ${config.voltage}V * ${phases}ph = ${watts}W`);
    return watts;
  }

  // Créer un profil depuis des paramètres UI
  createProfile(params: {
    connectorId?: number;
    chargingProfileId?: number;
    stackLevel?: number;
    purpose?: ChargingProfilePurposeType;
    kind?: ChargingProfileKindType;
    recurrencyKind?: RecurrencyKindType;
    validFrom?: string;
    validTo?: string;
    chargingRateUnit?: ChargingRateUnitType;
    minChargingRate?: number;
    periods?: Array<{ startPeriod: number; limit: number; numberPhases?: number }>;
  }): ChargingProfile {
    const now = new Date().toISOString();

    return {
      chargingProfileId: params.chargingProfileId || Date.now() % 10000,
      stackLevel: params.stackLevel ?? 0,
      chargingProfilePurpose: params.purpose || "TxProfile",
      chargingProfileKind: params.kind || "Absolute",
      recurrencyKind: params.kind === "Recurring" ? params.recurrencyKind : undefined,
      validFrom: params.kind === "Recurring" ? params.validFrom : undefined,
      validTo: params.kind === "Recurring" ? params.validTo : undefined,
      chargingSchedule: {
        startSchedule: params.kind === "Absolute" ? now : undefined,
        chargingRateUnit: params.chargingRateUnit || "W",
        minChargingRate: params.minChargingRate,
        chargingSchedulePeriod: params.periods || [{ startPeriod: 0, limit: 11000 }]
      }
    };
  }

  // Construire le payload OCPP pour SetChargingProfile
  buildSetChargingProfilePayload(connectorId: number, profile: ChargingProfile): any {
    return {
      connectorId,
      csChargingProfiles: {
        chargingProfileId: profile.chargingProfileId,
        transactionId: profile.transactionId,
        stackLevel: profile.stackLevel,
        chargingProfilePurpose: profile.chargingProfilePurpose,
        chargingProfileKind: profile.chargingProfileKind,
        recurrencyKind: profile.recurrencyKind,
        validFrom: profile.validFrom,
        validTo: profile.validTo,
        chargingSchedule: {
          duration: profile.chargingSchedule.duration,
          startSchedule: profile.chargingSchedule.startSchedule || new Date().toISOString(),
          chargingRateUnit: profile.chargingSchedule.chargingRateUnit,
          minChargingRate: profile.chargingSchedule.minChargingRate,
          chargingSchedulePeriod: profile.chargingSchedule.chargingSchedulePeriod
        }
      }
    };
  }

  // Construire le payload OCPP pour ClearChargingProfile
  buildClearChargingProfilePayload(criteria?: {
    id?: number;
    connectorId?: number;
    chargingProfilePurpose?: ChargingProfilePurposeType;
    stackLevel?: number;
  }): any {
    const payload: any = {};
    if (criteria?.id !== undefined) payload.id = criteria.id;
    if (criteria?.connectorId !== undefined) payload.connectorId = criteria.connectorId;
    if (criteria?.chargingProfilePurpose) payload.chargingProfilePurpose = criteria.chargingProfilePurpose;
    if (criteria?.stackLevel !== undefined) payload.stackLevel = criteria.stackLevel;
    return payload;
  }

  setChargingProfile(connectorId: number, profileOrPayload: ChargingProfile | any): { status: "Accepted" | "Rejected" } {
    let profile: ChargingProfile | null;

    if (profileOrPayload.chargingSchedule && profileOrPayload.chargingProfileId) {
      profile = profileOrPayload as ChargingProfile;
    } else {
      const parsed = this.parseChargingProfileMessage(profileOrPayload);
      connectorId = parsed.connectorId;
      profile = parsed.profile;
    }

    if (!profile) {
      console.log("[OCPPManager] Profil rejeté - parsing échoué");
      return { status: "Rejected" };
    }

    console.log(`[OCPPManager] Réception profil #${profile.chargingProfileId} pour connecteur ${connectorId}`, profile);

    // Pour un profil Relative, marquer le début si pas déjà fait
    if (profile.chargingProfileKind === "Relative" && !this.transactionStartTimes.has(connectorId)) {
      this.markTransactionStart(connectorId);
    }

    if (!this.profiles.has(connectorId)) {
      this.profiles.set(connectorId, new Map());
    }

    const connectorProfiles = this.profiles.get(connectorId)!;

    // Supprimer les profils de même purpose avec stackLevel <= au nouveau
    for (const [id, existingProfile] of connectorProfiles) {
      if (existingProfile.chargingProfilePurpose === profile.chargingProfilePurpose &&
          existingProfile.stackLevel <= profile.stackLevel) {
        console.log(`[OCPPManager] Suppression profil #${id} (remplacé par #${profile.chargingProfileId})`);
        connectorProfiles.delete(id);
        this.clearTimersForProfile(connectorId, id);
      }
    }

    connectorProfiles.set(profile.chargingProfileId, profile);
    this.scheduleRecalculation(connectorId, profile);

    this.onProfileChange?.({
      type: "SET",
      connectorId,
      profileId: profile.chargingProfileId,
      purpose: profile.chargingProfilePurpose,
      stackLevel: profile.stackLevel,
      profile
    });

    this.recalculate(connectorId);
    return { status: "Accepted" };
  }

  private parseChargingProfileMessage(payload: any): {
    connectorId: number;
    profile: ChargingProfile | null;
  } {
    if (!payload) {
      return { connectorId: 1, profile: null };
    }

    if (Array.isArray(payload) && payload.length >= 4) {
      payload = payload[3];
    }

    const connectorId = Number(payload.connectorId || 1);
    let profile: any = null;

    if (payload.csChargingProfiles) {
      profile = payload.csChargingProfiles;
    } else if (payload.chargingProfile) {
      profile = payload.chargingProfile;
    } else if (payload.chargingProfileId && payload.chargingSchedule) {
      profile = payload;
    }

    if (!profile || !profile.chargingSchedule) {
      console.log("[OCPPManager] Profil invalide - structure non reconnue");
      return { connectorId, profile: null };
    }

    const normalizedProfile: ChargingProfile = {
      chargingProfileId: Number(profile.chargingProfileId || 1),
      transactionId: profile.transactionId,
      stackLevel: Number(profile.stackLevel || 0),
      chargingProfilePurpose: profile.chargingProfilePurpose || "TxProfile",
      chargingProfileKind: profile.chargingProfileKind || "Absolute",
      chargingSchedule: {
        duration: msOrSecToSec(profile.chargingSchedule.duration),
        startSchedule: profile.chargingSchedule.startSchedule,
        chargingRateUnit: profile.chargingSchedule.chargingRateUnit || "W",
        chargingSchedulePeriod: (profile.chargingSchedule.chargingSchedulePeriod || []).map((p: any) => ({
          startPeriod: Number(p.startPeriod || 0),
          limit: Number(p.limit || 0),
          numberPhases: p.numberPhases ? Number(p.numberPhases) : undefined
        })),
        minChargingRate: profile.chargingSchedule.minChargingRate
      },
      recurrencyKind: profile.recurrencyKind as RecurrencyKindType,
      validFrom: profile.validFrom,
      validTo: profile.validTo
    };

    return { connectorId, profile: normalizedProfile };
  }

  private computeLimitForProfile(
      connectorId: number,
      profile: ChargingProfile,
      now = Date.now()
  ): number | null {
    const schedule = profile.chargingSchedule;

    // Vérifier validFrom/validTo pour les profils Recurring
    if (profile.chargingProfileKind === "Recurring") {
      if (profile.validFrom && Date.parse(profile.validFrom) > now) {
        return null; // Pas encore valide
      }
      if (profile.validTo && Date.parse(profile.validTo) < now) {
        return null; // Plus valide
      }
    }

    let startMs: number;

    if (profile.chargingProfileKind === "Relative") {
      const txStart = this.transactionStartTimes.get(connectorId);
      if (!txStart) {
        console.log(`[OCPPManager] Profil Relative sans transaction active`);
        return null;
      }
      startMs = txStart;
    } else if (profile.chargingProfileKind === "Recurring") {
      // Pour Recurring, calculer le début de la période courante
      const scheduleStart = schedule.startSchedule ? Date.parse(schedule.startSchedule) : now;
      if (profile.recurrencyKind === "Daily") {
        // Aligner sur le début du jour courant
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const scheduleTime = new Date(scheduleStart);
        startOfDay.setHours(scheduleTime.getHours(), scheduleTime.getMinutes(), scheduleTime.getSeconds());
        startMs = startOfDay.getTime();

        // Si on est avant l'heure de début aujourd'hui, prendre hier
        if (startMs > now) {
          startMs -= 24 * 60 * 60 * 1000;
        }
      } else if (profile.recurrencyKind === "Weekly") {
        // Aligner sur le début de la semaine courante
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Lundi
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);
        const scheduleTime = new Date(scheduleStart);
        startOfWeek.setHours(scheduleTime.getHours(), scheduleTime.getMinutes(), scheduleTime.getSeconds());
        startMs = startOfWeek.getTime();

        // Si on est avant le début cette semaine, prendre la semaine dernière
        if (startMs > now) {
          startMs -= 7 * 24 * 60 * 60 * 1000;
        }
      } else {
        startMs = schedule.startSchedule ? Date.parse(schedule.startSchedule) : now - 1000;
      }
    } else {
      startMs = schedule.startSchedule ? Date.parse(schedule.startSchedule) : now - 1000;
    }

    const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));

    // Pour Recurring, utiliser modulo pour la répétition
    let effectiveElapsedSec = elapsedSec;
    if (profile.chargingProfileKind === "Recurring" && schedule.duration) {
      effectiveElapsedSec = elapsedSec % schedule.duration;
    } else if (schedule.duration && elapsedSec > schedule.duration) {
      return null; // Profil expiré
    }

    const periods = schedule.chargingSchedulePeriod || [];
    if (periods.length === 0) {
      return null;
    }

    // Trouver la période active
    let activePeriod = null;
    let nextPeriod = null;

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const nextP = periods[i + 1];

      if (effectiveElapsedSec >= period.startPeriod) {
        if (nextP && effectiveElapsedSec < nextP.startPeriod) {
          activePeriod = period;
          nextPeriod = nextP;
          break;
        } else if (!nextP) {
          activePeriod = period;
          break;
        }
      }
    }

    if (!activePeriod) {
      return null;
    }

    // Ignorer les périodes courtes avec limit=0
    if (activePeriod.limit === 0 && nextPeriod) {
      const periodDuration = nextPeriod.startPeriod - activePeriod.startPeriod;
      if (periodDuration < 10 && effectiveElapsedSec >= activePeriod.startPeriod) {
        console.log(`[OCPPManager] Saut de la période 0A courte, application de ${nextPeriod.limit}${schedule.chargingRateUnit}`);
        activePeriod = nextPeriod;
      }
    }

    // Convertir la limite en Watts
    let limitW = this.toWatts(
        activePeriod.limit,
        schedule.chargingRateUnit,
        activePeriod.numberPhases,
        connectorId
    );

    // Appliquer minChargingRate si défini
    if (schedule.minChargingRate !== undefined) {
      const minW = this.toWatts(
          schedule.minChargingRate,
          schedule.chargingRateUnit,
          activePeriod.numberPhases,
          connectorId
      );
      limitW = Math.max(limitW, minW);
    }

    console.log(`[OCPPManager] Profil #${profile.chargingProfileId}: ${activePeriod.limit}${schedule.chargingRateUnit} = ${limitW}W (elapsed: ${effectiveElapsedSec}s)`);

    return clamp(limitW, 0, this.maxPowerW);
  }

  private pickEffectiveProfile(connectorId: number, now = Date.now()): ProfileApplication {
    const connectorProfiles = this.profiles.get(connectorId);

    if (!connectorProfiles || connectorProfiles.size === 0) {
      return {
        profileId: -1,
        purpose: "ChargePointMaxProfile",
        stackLevel: -1,
        limitW: this.maxPowerW,
        source: "default",
        timestamp: now
      };
    }

    // Trier les profils par priorité
    const sortedProfiles = Array.from(connectorProfiles.values()).sort((a, b) => {
      const purposeDiff = PURPOSE_PRIORITY[b.chargingProfilePurpose] - PURPOSE_PRIORITY[a.chargingProfilePurpose];
      if (purposeDiff !== 0) return purposeDiff;
      return b.stackLevel - a.stackLevel;
    });

    // Chercher le premier profil actif
    for (const profile of sortedProfiles) {
      const limitW = this.computeLimitForProfile(connectorId, profile, now);
      if (limitW != null) {
        // Calculer le temps avant le prochain changement
        let nextChangeIn: number | undefined;
        const schedule = profile.chargingSchedule;
        const periods = schedule.chargingSchedulePeriod || [];

        if (periods.length > 1) {
          let startMs: number;

          if (profile.chargingProfileKind === "Relative") {
            startMs = this.transactionStartTimes.get(connectorId) || now;
          } else {
            startMs = schedule.startSchedule ? Date.parse(schedule.startSchedule) : now;
          }

          const elapsedSec = Math.floor((now - startMs) / 1000);
          for (const period of periods) {
            if (period.startPeriod > elapsedSec) {
              nextChangeIn = period.startPeriod - elapsedSec;
              break;
            }
          }
        }

        console.log(`[OCPPManager] Profil actif: #${profile.chargingProfileId} (${profile.chargingProfilePurpose}) = ${limitW}W`);
        return {
          profileId: profile.chargingProfileId,
          purpose: profile.chargingProfilePurpose,
          stackLevel: profile.stackLevel,
          limitW,
          source: "profile",
          timestamp: now,
          nextChangeIn,
          profileDetails: profile
        };
      }
    }

    console.log(`[OCPPManager] Aucun profil actif, limite physique = ${this.maxPowerW}W`);
    return {
      profileId: -1,
      purpose: "ChargePointMaxProfile",
      stackLevel: -1,
      limitW: this.maxPowerW,
      source: "physical",
      timestamp: now
    };
  }

  private recalculate(connectorId: number) {
    const previous = this.lastAppliedLimit.get(connectorId);
    const current = this.pickEffectiveProfile(connectorId);

    this.effective.set(connectorId, current);

    if (previous !== current.limitW) {
      console.log(`[OCPPManager] Limite changée: ${previous}W -> ${current.limitW}W`);
      this.lastAppliedLimit.set(connectorId, current.limitW);
      this.onLimitChange?.(connectorId, current.limitW, current);
    }
  }

  private scheduleRecalculation(connectorId: number, profile: ChargingProfile) {
    const schedule = profile.chargingSchedule;
    const now = Date.now();

    this.clearTimersForProfile(connectorId, profile.chargingProfileId);

    const timers: NodeJS.Timeout[] = [];

    if (profile.chargingProfileKind === "Relative") {
      const txStart = this.transactionStartTimes.get(connectorId) || now;

      for (const period of schedule.chargingSchedulePeriod) {
        const changeTime = txStart + period.startPeriod * 1000;
        if (changeTime > now) {
          const delay = changeTime - now;
          console.log(`[OCPPManager] Timer période dans ${delay}ms pour limite ${period.limit}${schedule.chargingRateUnit}`);
          timers.push(
              setTimeout(() => {
                console.log(`[OCPPManager] Changement période: ${period.limit}${schedule.chargingRateUnit}`);
                this.recalculate(connectorId);
              }, delay)
          );
        }
      }
    } else if (profile.chargingProfileKind === "Recurring") {
      // Pour Recurring, recalculer périodiquement
      const recalcInterval = profile.recurrencyKind === "Daily" ? 60000 : 300000; // 1min ou 5min
      timers.push(
          setInterval(() => {
            this.recalculate(connectorId);
          }, recalcInterval) as any
      );
    }

    if (timers.length > 0) {
      if (!this.timers.has(connectorId)) {
        this.timers.set(connectorId, []);
      }
      this.timers.get(connectorId)!.push(...timers);
    }
  }

  private clearTimersForProfile(connectorId: number, profileId: number) {
    const connectorTimers = this.timers.get(connectorId);
    if (connectorTimers) {
      connectorTimers.forEach(timer => clearTimeout(timer));
      this.timers.set(connectorId, []);
    }
  }

  clearChargingProfile(criteria?: {
    id?: number;
    chargingProfilePurpose?: ChargingProfilePurposeType;
    stackLevel?: number;
    connectorId?: number;
  } | any): { status: "Accepted" | "Unknown"; cleared: number[] } {
    let parsedCriteria = criteria;
    if (criteria && typeof criteria === 'object') {
      parsedCriteria = {
        id: criteria.id || criteria.chargingProfileId,
        chargingProfilePurpose: criteria.chargingProfilePurpose,
        stackLevel: criteria.stackLevel,
        connectorId: criteria.connectorId
      };
    }

    console.log("[OCPPManager] Clear profils avec critères:", parsedCriteria);
    const cleared: number[] = [];

    const connectorsToProcess = parsedCriteria?.connectorId
        ? [parsedCriteria.connectorId]
        : Array.from(this.profiles.keys());

    for (const connectorId of connectorsToProcess) {
      const connectorProfiles = this.profiles.get(connectorId);
      if (!connectorProfiles) continue;

      for (const [profileId, profile] of connectorProfiles) {
        let shouldClear = !parsedCriteria;

        if (parsedCriteria) {
          shouldClear = true;

          if (parsedCriteria.id != null && profileId !== parsedCriteria.id) {
            shouldClear = false;
          }
          if (parsedCriteria.chargingProfilePurpose &&
              profile.chargingProfilePurpose !== parsedCriteria.chargingProfilePurpose) {
            shouldClear = false;
          }
          if (parsedCriteria.stackLevel != null &&
              profile.stackLevel !== parsedCriteria.stackLevel) {
            shouldClear = false;
          }
        }

        if (shouldClear) {
          connectorProfiles.delete(profileId);
          this.clearTimersForProfile(connectorId, profileId);
          cleared.push(profileId);
          console.log(`[OCPPManager] Profil #${profileId} supprimé`);
        }
      }

      this.recalculate(connectorId);
    }

    this.onProfileChange?.({ type: "CLEAR", cleared });

    return {
      status: cleared.length > 0 ? "Accepted" : "Unknown",
      cleared
    };
  }

  reset() {
    console.log("[OCPPManager] Reset complet");

    for (const timers of this.timers.values()) {
      timers.forEach(timer => clearTimeout(timer));
    }

    this.profiles.clear();
    this.effective.clear();
    this.timers.clear();
    this.lastAppliedLimit.clear();
    this.transactionStartTimes.clear();

    for (const connectorId of this.connectors.keys()) {
      this.recalculate(connectorId);
    }
  }

  getConnectorState(connectorId: number): {
    profiles: ChargingProfile[];
    effectiveLimit: ProfileApplication;
  } {
    const effectiveLimit = this.effective.get(connectorId) || this.pickEffectiveProfile(connectorId);
    const profiles = Array.from(this.profiles.get(connectorId)?.values() || []);

    return {
      profiles,
      effectiveLimit
    };
  }

  getCurrentLimitW(connectorId: number = 1): number {
    const state = this.getConnectorState(connectorId);
    return state.effectiveLimit.limitW;
  }

  getAllProfiles(): ChargingProfile[] {
    const allProfiles: ChargingProfile[] = [];
    for (const profilesMap of this.profiles.values()) {
      allProfiles.push(...profilesMap.values());
    }
    return allProfiles;
  }

  exportState() {
    const state: any = {
      maxPowerW: this.maxPowerW,
      connectors: {},
      profiles: {},
      effective: {},
      transactionStartTimes: {}
    };

    for (const [id, config] of this.connectors) {
      state.connectors[id] = config;
    }

    for (const [connectorId, profilesMap] of this.profiles) {
      state.profiles[connectorId] = Array.from(profilesMap.values());
    }

    for (const [connectorId, limit] of this.effective) {
      state.effective[connectorId] = limit;
    }

    for (const [connectorId, time] of this.transactionStartTimes) {
      state.transactionStartTimes[connectorId] = time;
    }

    return state;
  }
}