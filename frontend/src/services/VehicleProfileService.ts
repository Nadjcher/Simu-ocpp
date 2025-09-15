// frontend/src/services/VehicleProfileService.ts

export interface VehicleProfile {
    id: string;
    manufacturer: string;
    model: string;
    variant: string;
    capacityKWh: number;
    maxCurrentA: number;
    maxPowerKW: number;
    chargingCurve: ChargingPoint[];
    efficiency: number;
    connectorType: 'Type2' | 'CCS' | 'CHAdeMO';
}

export interface ChargingPoint {
    soc: number;
    powerKW: number;
}

export class VehicleProfileService {
    private profiles: Map<string, VehicleProfile> = new Map();

    constructor() {
        this.initializeProfiles();
    }

    private initializeProfiles(): void {
        const profiles: VehicleProfile[] = [
            {
                id: 'tesla_model3_lr',
                manufacturer: 'Tesla',
                model: 'Model 3',
                variant: 'Long Range',
                capacityKWh: 75,
                maxCurrentA: 250,
                maxPowerKW: 250,
                efficiency: 0.95,
                connectorType: 'CCS',
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
                ]
            },
            {
                id: 'renault_zoe_ze50',
                manufacturer: 'Renault',
                model: 'ZOE',
                variant: 'ZE50',
                capacityKWh: 52,
                maxCurrentA: 50,
                maxPowerKW: 50,
                efficiency: 0.90,
                connectorType: 'Type2',
                chargingCurve: [
                    { soc: 0, powerKW: 46 },
                    { soc: 20, powerKW: 46 },
                    { soc: 40, powerKW: 45 },
                    { soc: 60, powerKW: 40 },
                    { soc: 80, powerKW: 25 },
                    { soc: 90, powerKW: 15 },
                    { soc: 100, powerKW: 0 }
                ]
            },
            {
                id: 'nissan_leaf_62',
                manufacturer: 'Nissan',
                model: 'Leaf',
                variant: '62kWh',
                capacityKWh: 62,
                maxCurrentA: 50,
                maxPowerKW: 50,
                efficiency: 0.88,
                connectorType: 'CHAdeMO',
                chargingCurve: [
                    { soc: 0, powerKW: 50 },
                    { soc: 30, powerKW: 50 },
                    { soc: 50, powerKW: 45 },
                    { soc: 70, powerKW: 35 },
                    { soc: 80, powerKW: 20 },
                    { soc: 90, powerKW: 10 },
                    { soc: 100, powerKW: 0 }
                ]
            },
            {
                id: 'hyundai_kona_ev',
                manufacturer: 'Hyundai',
                model: 'Kona Electric',
                variant: '64kWh',
                capacityKWh: 64,
                maxCurrentA: 77,
                maxPowerKW: 77,
                efficiency: 0.92,
                connectorType: 'CCS',
                chargingCurve: [
                    { soc: 0, powerKW: 77 },
                    { soc: 20, powerKW: 77 },
                    { soc: 40, powerKW: 75 },
                    { soc: 60, powerKW: 65 },
                    { soc: 80, powerKW: 40 },
                    { soc: 90, powerKW: 20 },
                    { soc: 100, powerKW: 0 }
                ]
            },
            {
                id: 'bmw_i3',
                manufacturer: 'BMW',
                model: 'i3',
                variant: '42kWh',
                capacityKWh: 42.2,
                maxCurrentA: 50,
                maxPowerKW: 50,
                efficiency: 0.93,
                connectorType: 'CCS',
                chargingCurve: [
                    { soc: 0, powerKW: 50 },
                    { soc: 30, powerKW: 50 },
                    { soc: 50, powerKW: 48 },
                    { soc: 70, powerKW: 40 },
                    { soc: 80, powerKW: 25 },
                    { soc: 90, powerKW: 12 },
                    { soc: 100, powerKW: 0 }
                ]
            },
            {
                id: 'audi_etron',
                manufacturer: 'Audi',
                model: 'e-tron',
                variant: '55 quattro',
                capacityKWh: 95,
                maxCurrentA: 150,
                maxPowerKW: 150,
                efficiency: 0.91,
                connectorType: 'CCS',
                chargingCurve: [
                    { soc: 0, powerKW: 150 },
                    { soc: 20, powerKW: 150 },
                    { soc: 40, powerKW: 145 },
                    { soc: 60, powerKW: 120 },
                    { soc: 80, powerKW: 80 },
                    { soc: 90, powerKW: 40 },
                    { soc: 100, powerKW: 0 }
                ]
            }
        ];

        profiles.forEach(profile => {
            this.profiles.set(profile.id, profile);
        });
    }

    public getAllProfiles(): VehicleProfile[] {
        return Array.from(this.profiles.values());
    }

    public getProfile(id: string): VehicleProfile | undefined {
        return this.profiles.get(id);
    }

    public calculateChargingPower(profileId: string, soc: number): number {
        const profile = this.profiles.get(profileId);
        if (!profile) return 0;

        const curve = profile.chargingCurve;

        // Interpolation linéaire entre les points
        for (let i = 0; i < curve.length - 1; i++) {
            if (soc >= curve[i].soc && soc <= curve[i + 1].soc) {
                const x1 = curve[i].soc;
                const y1 = curve[i].powerKW;
                const x2 = curve[i + 1].soc;
                const y2 = curve[i + 1].powerKW;

                const power = y1 + ((soc - x1) * (y2 - y1)) / (x2 - x1);
                return Math.max(0, power * 1000); // Convertir en watts
            }
        }

        return 0;
    }

    public getVoltageAtSoc(profileId: string, soc: number): number {
        const profile = this.profiles.get(profileId);
        if (!profile) return 400;

        // Calcul simplifié de la tension selon le type de connecteur
        if (profile.connectorType === 'Type2') {
            return 230; // AC monophasé
        }

        // Pour DC (CCS, CHAdeMO)
        // Tension typique qui varie avec le SoC
        const baseVoltage = 400;
        const voltageVariation = 50; // ±50V
        const socFactor = soc / 100;

        return baseVoltage + (voltageVariation * socFactor);
    }

    public calculateChargingTime(profileId: string, currentSoc: number, targetSoc: number): number {
        const profile = this.profiles.get(profileId);
        if (!profile || currentSoc >= targetSoc) return 0;

        let totalTime = 0;
        let soc = currentSoc;
        const increment = 1; // Incrément de 1%

        while (soc < targetSoc) {
            const power = this.calculateChargingPower(profileId, soc) / 1000; // En kW
            if (power === 0) break;

            const energyNeeded = (profile.capacityKWh * increment) / 100;
            const timeForIncrement = (energyNeeded / power) * 3600; // En secondes

            totalTime += timeForIncrement;
            soc += increment;
        }

        return Math.round(totalTime / 60); // Retourner en minutes
    }
}