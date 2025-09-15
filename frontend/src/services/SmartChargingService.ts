// services/SmartChargingService.ts

export type ChargingProfilePurpose =
    | 'ChargePointMaxProfile'
    | 'TxDefaultProfile'
    | 'TxProfile';

export type ChargingProfileKind =
    | 'Absolute'
    | 'Recurring'
    | 'Relative';

export type RecurrencyKind =
    | 'Daily'
    | 'Weekly';

export type ChargingRateUnit = 'W' | 'A';

export interface ChargingSchedulePeriod {
    startPeriod: number; // Secondes depuis le début du schedule
    limit: number; // En Watts ou Ampères selon unit
    numberPhases?: number;
}

export interface ChargingSchedule {
    duration?: number; // Durée en secondes
    startSchedule?: string; // ISO 8601
    chargingRateUnit: ChargingRateUnit;
    chargingSchedulePeriod: ChargingSchedulePeriod[];
    minChargingRate?: number;
}

export interface ChargingProfile {
    chargingProfileId: number;
    transactionId?: number;
    stackLevel: number;
    chargingProfilePurpose: ChargingProfilePurpose;
    chargingProfileKind: ChargingProfileKind;
    recurrencyKind?: RecurrencyKind;
    validFrom?: string; // ISO 8601
    validTo?: string; // ISO 8601
    chargingSchedule: ChargingSchedule;
}

export interface SetChargingProfileRequest {
    connectorId: number;
    csChargingProfiles: ChargingProfile;
}

export interface ClearChargingProfileRequest {
    id?: number;
    connectorId?: number;
    chargingProfilePurpose?: ChargingProfilePurpose;
    stackLevel?: number;
}

export class SmartChargingService {
    private profiles: Map<number, ChargingProfile> = new Map();
    private profilesByConnector: Map<number, Set<number>> = new Map();
    private profilesByPurpose: Map<ChargingProfilePurpose, Set<number>> = new Map();
    private scheduleTimers: Map<number, NodeJS.Timer[]> = new Map();
    private onLimitChanged?: (limit: number, connectorId: number) => void;
    private bearerToken?: string;
    private evpId?: string;

    constructor(
        onLimitChanged?: (limit: number, connectorId: number) => void,
        bearerToken?: string,
        evpId?: string
    ) {
        this.onLimitChanged = onLimitChanged;
        this.bearerToken = bearerToken;
        this.evpId = evpId;

        // Initialiser les maps de purpose
        const purposes: ChargingProfilePurpose[] = ['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile'];
        purposes.forEach(purpose => this.profilesByPurpose.set(purpose, new Set()));
    }

    /**
     * Gère la requête SetChargingProfile
     */
    handleSetChargingProfile(request: SetChargingProfileRequest): 'Accepted' | 'Rejected' | 'NotSupported' {
        const { connectorId, csChargingProfiles } = request;

        // Validation du profil
        if (!this.validateProfile(csChargingProfiles)) {
            console.error('Invalid charging profile:', csChargingProfiles);
            return 'Rejected';
        }

        // Vérifier si on remplace un profil existant (même ID ou même stackLevel/purpose)
        const existingProfile = this.findExistingProfile(
            csChargingProfiles.chargingProfilePurpose,
            csChargingProfiles.stackLevel,
            connectorId
        );

        if (existingProfile) {
            this.removeProfile(existingProfile.chargingProfileId);
        }

        // Stocker le nouveau profil
        this.storeProfile(csChargingProfiles, connectorId);

        // Appliquer le profil
        this.applyProfiles(connectorId);

        // Si c'est un profil récurrent, planifier les changements
        if (csChargingProfiles.chargingProfileKind === 'Recurring') {
            this.scheduleRecurringProfile(csChargingProfiles, connectorId);
        }

        console.log(`SetChargingProfile accepted: ID=${csChargingProfiles.chargingProfileId}, Purpose=${csChargingProfiles.chargingProfilePurpose}, StackLevel=${csChargingProfiles.stackLevel}`);

        return 'Accepted';
    }

    /**
     * Gère la requête ClearChargingProfile
     */
    handleClearChargingProfile(request?: ClearChargingProfileRequest): 'Accepted' | 'Unknown' {
        if (!request || Object.keys(request).length === 0) {
            // Clear all profiles
            this.clearAllProfiles();
            return 'Accepted';
        }

        const { id, connectorId, chargingProfilePurpose, stackLevel } = request;
        let cleared = false;

        // Clear par ID
        if (id !== undefined) {
            if (this.profiles.has(id)) {
                this.removeProfile(id);
                cleared = true;
            }
        }

        // Clear par critères
        const profilesToRemove: number[] = [];

        this.profiles.forEach((profile, profileId) => {
            let match = true;

            if (connectorId !== undefined) {
                const connectorProfiles = this.profilesByConnector.get(connectorId);
                if (!connectorProfiles || !connectorProfiles.has(profileId)) {
                    match = false;
                }
            }

            if (chargingProfilePurpose !== undefined && profile.chargingProfilePurpose !== chargingProfilePurpose) {
                match = false;
            }

            if (stackLevel !== undefined && profile.stackLevel !== stackLevel) {
                match = false;
            }

            if (match) {
                profilesToRemove.push(profileId);
            }
        });

        profilesToRemove.forEach(id => {
            this.removeProfile(id);
            cleared = true;
        });

        // Réappliquer les profils restants
        if (cleared) {
            // Réappliquer pour tous les connecteurs affectés
            const affectedConnectors = new Set<number>();
            if (connectorId !== undefined) {
                affectedConnectors.add(connectorId);
            } else {
                this.profilesByConnector.forEach((_, cId) => affectedConnectors.add(cId));
            }

            affectedConnectors.forEach(cId => this.applyProfiles(cId));
        }

        return cleared ? 'Accepted' : 'Unknown';
    }

    /**
     * Valide un profil de charge
     */
    private validateProfile(profile: ChargingProfile): boolean {
        // Validation de base
        if (!profile.chargingProfileId || profile.chargingProfileId < 0) return false;
        if (!profile.chargingProfilePurpose) return false;
        if (!profile.chargingProfileKind) return false;
        if (profile.stackLevel < 0) return false;
        if (!profile.chargingSchedule) return false;
        if (!profile.chargingSchedule.chargingRateUnit) return false;
        if (!profile.chargingSchedule.chargingSchedulePeriod ||
            profile.chargingSchedule.chargingSchedulePeriod.length === 0) return false;

        // Validation des périodes
        let lastStartPeriod = -1;
        for (const period of profile.chargingSchedule.chargingSchedulePeriod) {
            if (period.startPeriod < 0) return false;
            if (period.startPeriod <= lastStartPeriod) return false; // Doit être croissant
            if (period.limit < 0) return false;
            lastStartPeriod = period.startPeriod;
        }

        // Validation spécifique au type Recurring
        if (profile.chargingProfileKind === 'Recurring') {
            if (!profile.recurrencyKind) return false;
            if (!profile.validFrom || !profile.validTo) return false;
        }

        // Validation TxProfile
        if (profile.chargingProfilePurpose === 'TxProfile' && !profile.transactionId) {
            return false;
        }

        return true;
    }

    /**
     * Trouve un profil existant avec les mêmes caractéristiques
     */
    private findExistingProfile(
        purpose: ChargingProfilePurpose,
        stackLevel: number,
        connectorId: number
    ): ChargingProfile | undefined {
        const purposeProfiles = this.profilesByPurpose.get(purpose);
        if (!purposeProfiles) return undefined;

        for (const profileId of purposeProfiles) {
            const profile = this.profiles.get(profileId);
            if (profile && profile.stackLevel === stackLevel) {
                const connectorProfiles = this.profilesByConnector.get(connectorId);
                if (connectorProfiles && connectorProfiles.has(profileId)) {
                    return profile;
                }
            }
        }

        return undefined;
    }

    /**
     * Stocke un profil
     */
    private storeProfile(profile: ChargingProfile, connectorId: number): void {
        const profileId = profile.chargingProfileId;

        // Stocker le profil
        this.profiles.set(profileId, profile);

        // Indexer par connecteur
        if (!this.profilesByConnector.has(connectorId)) {
            this.profilesByConnector.set(connectorId, new Set());
        }
        this.profilesByConnector.get(connectorId)!.add(profileId);

        // Indexer par purpose
        this.profilesByPurpose.get(profile.chargingProfilePurpose)!.add(profileId);
    }

    /**
     * Supprime un profil
     */
    private removeProfile(profileId: number): void {
        const profile = this.profiles.get(profileId);
        if (!profile) return;

        // Supprimer des index
        this.profiles.delete(profileId);

        // Supprimer des index de connecteur
        this.profilesByConnector.forEach(profileIds => {
            profileIds.delete(profileId);
        });

        // Supprimer des index de purpose
        this.profilesByPurpose.get(profile.chargingProfilePurpose)?.delete(profileId);

        // Annuler les timers
        const timers = this.scheduleTimers.get(profileId);
        if (timers) {
            timers.forEach(timer => clearTimeout(timer));
            this.scheduleTimers.delete(profileId);
        }
    }

    /**
     * Supprime tous les profils
     */
    private clearAllProfiles(): void {
        // Annuler tous les timers
        this.scheduleTimers.forEach(timers => {
            timers.forEach(timer => clearTimeout(timer));
        });
        this.scheduleTimers.clear();

        // Vider toutes les maps
        this.profiles.clear();
        this.profilesByConnector.clear();
        this.profilesByPurpose.forEach(set => set.clear());

        // Notifier limite par défaut pour tous les connecteurs
        this.profilesByConnector.forEach((_, connectorId) => {
            if (this.onLimitChanged) {
                this.onLimitChanged(Number.MAX_VALUE, connectorId);
            }
        });
    }

    /**
     * Applique les profils actifs pour un connecteur
     */
    private applyProfiles(connectorId: number): void {
        const now = new Date();
        const limit = this.calculateEffectiveLimit(connectorId, now);

        if (this.onLimitChanged) {
            this.onLimitChanged(limit, connectorId);
        }
    }

    /**
     * Calcule la limite effective pour un connecteur à un instant donné
     */
    calculateEffectiveLimit(connectorId: number, timestamp: Date): number {
        const applicableProfiles = this.getApplicableProfiles(connectorId, timestamp);

        if (applicableProfiles.length === 0) {
            return Number.MAX_VALUE; // Pas de limite
        }

        // Trier par priorité : TxProfile > TxDefaultProfile > ChargePointMaxProfile
        // Et par stackLevel décroissant
        applicableProfiles.sort((a, b) => {
            const purposeOrder = {
                'TxProfile': 3,
                'TxDefaultProfile': 2,
                'ChargePointMaxProfile': 1
            };

            const purposeDiff = purposeOrder[b.chargingProfilePurpose] - purposeOrder[a.chargingProfilePurpose];
            if (purposeDiff !== 0) return purposeDiff;

            return b.stackLevel - a.stackLevel;
        });

        // Prendre le profil avec la plus haute priorité
        const profile = applicableProfiles[0];
        const limit = this.getProfileLimitAtTime(profile, timestamp);

        // Pour les profils Relative, ajouter à la limite physique
        if (profile.chargingProfileKind === 'Relative') {
            const physicalLimit = this.getPhysicalLimit(connectorId);
            return Math.max(0, physicalLimit + limit);
        }

        return limit;
    }

    /**
     * Obtient les profils applicables pour un connecteur
     */
    private getApplicableProfiles(connectorId: number, timestamp: Date): ChargingProfile[] {
        const connectorProfiles = this.profilesByConnector.get(connectorId);
        if (!connectorProfiles) return [];

        const applicable: ChargingProfile[] = [];

        for (const profileId of connectorProfiles) {
            const profile = this.profiles.get(profileId);
            if (!profile) continue;

            // Vérifier la validité temporelle
            if (profile.validFrom && new Date(profile.validFrom) > timestamp) continue;
            if (profile.validTo && new Date(profile.validTo) < timestamp) continue;

            // Pour les profils récurrents, vérifier si on est dans la bonne période
            if (profile.chargingProfileKind === 'Recurring') {
                if (!this.isInRecurringPeriod(profile, timestamp)) continue;
            }

            applicable.push(profile);
        }

        return applicable;
    }

    /**
     * Vérifie si on est dans la période d'un profil récurrent
     */
    private isInRecurringPeriod(profile: ChargingProfile, timestamp: Date): boolean {
        if (!profile.recurrencyKind) return false;

        const startSchedule = profile.chargingSchedule.startSchedule
            ? new Date(profile.chargingSchedule.startSchedule)
            : new Date(profile.validFrom!);

        if (profile.recurrencyKind === 'Daily') {
            // Vérifier si on est dans la même période de la journée
            const startTime = startSchedule.getHours() * 3600 + startSchedule.getMinutes() * 60 + startSchedule.getSeconds();
            const currentTime = timestamp.getHours() * 3600 + timestamp.getMinutes() * 60 + timestamp.getSeconds();
            const duration = profile.chargingSchedule.duration || 86400; // 24h par défaut

            return currentTime >= startTime && currentTime < startTime + duration;
        }

        if (profile.recurrencyKind === 'Weekly') {
            // Vérifier jour de la semaine et heure
            const startDay = startSchedule.getDay();
            const currentDay = timestamp.getDay();

            if (startDay !== currentDay) return false;

            // Même vérification que Daily pour l'heure
            const startTime = startSchedule.getHours() * 3600 + startSchedule.getMinutes() * 60 + startSchedule.getSeconds();
            const currentTime = timestamp.getHours() * 3600 + timestamp.getMinutes() * 60 + timestamp.getSeconds();
            const duration = profile.chargingSchedule.duration || 86400;

            return currentTime >= startTime && currentTime < startTime + duration;
        }

        return false;
    }

    /**
     * Obtient la limite d'un profil à un instant donné
     */
    private getProfileLimitAtTime(profile: ChargingProfile, timestamp: Date): number {
        const schedule = profile.chargingSchedule;
        const periods = schedule.chargingSchedulePeriod;

        // Calculer le temps écoulé depuis le début du schedule
        let elapsedSeconds = 0;

        if (schedule.startSchedule) {
            elapsedSeconds = Math.floor((timestamp.getTime() - new Date(schedule.startSchedule).getTime()) / 1000);
        } else if (profile.chargingProfileKind === 'Relative') {
            // Pour Relative, le début est au moment de l'application
            elapsedSeconds = 0;
        }

        // Trouver la période applicable
        let applicablePeriod = periods[0];

        for (let i = periods.length - 1; i >= 0; i--) {
            if (elapsedSeconds >= periods[i].startPeriod) {
                applicablePeriod = periods[i];
                break;
            }
        }

        // Convertir en Watts si nécessaire
        let limitW = applicablePeriod.limit;

        if (schedule.chargingRateUnit === 'A') {
            const voltage = this.getVoltage(applicablePeriod.numberPhases || 1);
            const phases = applicablePeriod.numberPhases || 1;
            limitW = applicablePeriod.limit * voltage * phases;
        }

        return limitW;
    }

    /**
     * Planifie les changements pour un profil récurrent
     */
    private scheduleRecurringProfile(profile: ChargingProfile, connectorId: number): void {
        const timers: NodeJS.Timer[] = [];

        // Calculer les prochaines occurrences
        const now = new Date();
        const schedule = profile.chargingSchedule;

        // Planifier les changements de période
        schedule.chargingSchedulePeriod.forEach((period, index) => {
            if (index === 0) return; // La première période est appliquée immédiatement

            const timer = setTimeout(() => {
                this.applyProfiles(connectorId);
            }, period.startPeriod * 1000);

            timers.push(timer);
        });

        // Stocker les timers
        this.scheduleTimers.set(profile.chargingProfileId, timers);
    }

    /**
     * Obtient la limite physique d'un connecteur
     */
    private getPhysicalLimit(connectorId: number): number {
        // À implémenter selon votre configuration
        // Par défaut, retourner une valeur typique
        return 22000; // 22 kW
    }

    /**
     * Obtient la tension selon le nombre de phases
     */
    private getVoltage(phases: number): number {
        return phases === 3 ? 400 : 230;
    }

    /**
     * Envoie le profil via CentralTask HTTP
     */
    async sendCentralTask(profile: ChargingProfile, connectorId: number): Promise<void> {
        if (!this.bearerToken || !this.evpId) {
            throw new Error('Bearer token and evpId required for CentralTask');
        }

        const payload = {
            targets: [`evse/${this.evpId}`],
            operation: 'SET_CHARGING_PROFILE',
            params: {
                connectorId,
                csChargingProfiles: profile
            }
        };

        try {
            const response = await fetch('https://pp.total-ev-charge.com/g2smart/api/task', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.bearerToken}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`CentralTask failed: ${response.status}`);
            }

            const result = await response.json();
            console.log('CentralTask response:', result);
        } catch (error) {
            console.error('CentralTask error:', error);
            throw error;
        }
    }

    /**
     * Obtient tous les profils actifs
     */
    getAllProfiles(): ChargingProfile[] {
        return Array.from(this.profiles.values());
    }

    /**
     * Obtient les profils d'un connecteur
     */
    getConnectorProfiles(connectorId: number): ChargingProfile[] {
        const profileIds = this.profilesByConnector.get(connectorId);
        if (!profileIds) return [];

        const profiles: ChargingProfile[] = [];
        for (const id of profileIds) {
            const profile = this.profiles.get(id);
            if (profile) profiles.push(profile);
        }

        return profiles;
    }

    /**
     * Nettoie le service
     */
    cleanup(): void {
        this.scheduleTimers.forEach(timers => {
            timers.forEach(timer => clearTimeout(timer));
        });
        this.scheduleTimers.clear();
        this.profiles.clear();
        this.profilesByConnector.clear();
        this.profilesByPurpose.forEach(set => set.clear());
    }
}