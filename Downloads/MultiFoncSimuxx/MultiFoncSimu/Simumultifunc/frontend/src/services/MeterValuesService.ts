// frontend/src/services/MeterValuesService.ts
export interface MeterValue {
    timestamp: string;
    sampledValue: SampledValue[];
}

export interface SampledValue {
    value: string;
    context?: 'Sample.Periodic' | 'Sample.Clock' | 'Transaction.Begin' | 'Transaction.End' | 'Trigger';
    format?: 'Raw' | 'SignedData';
    measurand?: string;
    phase?: 'L1' | 'L2' | 'L3' | 'N' | 'L1-N' | 'L2-N' | 'L3-N' | 'L1-L2' | 'L2-L3' | 'L3-L1';
    location?: 'Cable' | 'EV' | 'Inlet' | 'Outlet' | 'Body';
    unit?: string;
}

export interface EVSession {
    connectorId: number;
    transactionId: number;

    // Etat batterie / énergie cumulée
    soc: number;            // %
    meterWh: number;        // Wh cumulés

    // Limites / mesures instantanées (valeurs de départ)
    offeredW: number;       // facultatif : si 0 on recalcule depuis V*I
    activeW: number;        // cible initiale (sera recalculée vs SoC)
    voltageV: number;       // 230 pour AC mono, 230 phase/phase pour tri (voir notes)
    maxCurrentA: number;    // courant max EVSE (par phase en AC)
    chargerType: 'AC_MONO' | 'AC_TRI' | 'DC';

    // Options d’envoi
    includeSoc: boolean;
    includeOffered: boolean;
    includeActive: boolean;

    // Facultatif : capacité batterie
    batteryCapacityWh?: number; // défaut 75_000 Wh
}

type TxId = number;

export class MeterValuesService {
    private sessions: Map<TxId, EVSession> = new Map();
    private intervals: Map<TxId, ReturnType<typeof setInterval>> = new Map();
    private intervalSeconds: Map<TxId, number> = new Map();
    private lastTickTs: Map<TxId, number> = new Map();
    private messageCallback?: (message: any) => void;

    constructor(onMessage?: (message: any) => void) {
        this.messageCallback = onMessage;
    }

    startMeterValues(session: EVSession, intervalSeconds: number = 60): void {
        this.stopMeterValues(session.transactionId);

        // enregistre et initialise le timestamp
        this.sessions.set(session.transactionId, session);
        this.intervalSeconds.set(session.transactionId, intervalSeconds);
        this.lastTickTs.set(session.transactionId, Date.now());

        const interval = setInterval(() => {
            this.sendMeterValues(session);
        }, intervalSeconds * 1000);

        this.intervals.set(session.transactionId, interval);

        // 1er envoi immédiat
        this.sendMeterValues(session);
    }

    stopMeterValues(transactionId: number): void {
        const itv = this.intervals.get(transactionId);
        if (itv) clearInterval(itv);
        this.intervals.delete(transactionId);
        this.sessions.delete(transactionId);
        this.intervalSeconds.delete(transactionId);
        this.lastTickTs.delete(transactionId);
    }

    // ---------------------------------------------------------------------------
    // Moteur réalisme : offered ≠ active et évolution SoC/Energie
    // ---------------------------------------------------------------------------

    /** renvoie [offeredW, activeW] en W */
    private computeOfferedAndActive(s: EVSession): [number, number] {
        const Vph = 230;
        const phases = s.chargerType === 'AC_TRI' ? 3 : s.chargerType === 'AC_MONO' ? 1 : 0;

        // Offered = limite EVSE (topologie + courant + éventuelle valeur s.offeredW)
        let offeredW: number;
        if (s.chargerType === 'DC') {
            // si offeredW renseigné on le respecte, sinon on approx depuis Imax
            offeredW = s.offeredW > 0 ? s.offeredW : (s.maxCurrentA * 1000);
        } else if (s.chargerType === 'AC_MONO') {
            const calc = Vph * s.maxCurrentA; // 230 * A
            offeredW = s.offeredW > 0 ? Math.min(s.offeredW, calc) : calc;
        } else {
            // AC TRI : approx 3 * 230 * Aphase (équivalent √3*400*I avec Vph=230)
            const calc = phases * Vph * s.maxCurrentA;
            offeredW = s.offeredW > 0 ? Math.min(s.offeredW, calc) : calc;
        }

        // Taper réaliste selon SoC (profil lissé)
        const soc = Math.max(0, Math.min(100, s.soc));
        const socFactor =
            soc < 40 ? 1.00 :
                soc < 60 ? 0.80 :
                    soc < 70 ? 0.60 :
                        soc < 80 ? 0.45 :
                            soc < 90 ? 0.30 :
                                soc < 97 ? 0.18 :
                                    0.08;

        // Active = min(offered, offered*socFactor) + petite variation (±2%)
        const targetActive = Math.min(offeredW, offeredW * socFactor);
        const jitter = 1 + (Math.random() - 0.5) * 0.04; // ±2%
        const activeW = Math.max(0, Math.round(targetActive * jitter));

        return [Math.round(offeredW), activeW];
    }

    private integrateEnergyAndSoc(s: EVSession, activeW: number, dtSec: number): void {
        const addWh = (activeW * dtSec) / 3600;
        s.meterWh = Math.max(0, s.meterWh + addWh);

        const capWh = s.batteryCapacityWh ?? 75_000; // défaut 75 kWh
        const addPct = (addWh / capWh) * 100;
        s.soc = Math.max(0, Math.min(100, s.soc + addPct));
    }

    // ---------------------------------------------------------------------------

    private sendMeterValues(session: EVSession): void {
        // calcule dt réel pour lisser correctement
        const now = Date.now();
        const last = this.lastTickTs.get(session.transactionId) ?? now;
        const dtSec = Math.max(1, (now - last) / 1000);
        this.lastTickTs.set(session.transactionId, now);

        // offered/active réalistes
        const [offeredW, activeW] = this.computeOfferedAndActive(session);
        session.offeredW = offeredW;
        session.activeW = activeW;

        // intègre énergie + SoC
        this.integrateEnergyAndSoc(session, activeW, dtSec);

        const meterValue = this.generateMeterValue(session);
        const message = [
            2,
            this.generateMessageId(),
            "MeterValues",
            {
                connectorId: session.connectorId,
                transactionId: session.transactionId,
                meterValue: [meterValue]
            }
        ];

        this.messageCallback?.(message);
    }

    private generateMeterValue(session: EVSession): MeterValue {
        const ts = new Date().toISOString();
        const out: SampledValue[] = [];

        // --- Energie cumulée (agrégé, indispensable pour la conso) ---
        out.push({
            value: session.meterWh.toFixed(1),
            context: 'Sample.Periodic',
            measurand: 'Energy.Active.Import.Register',
            unit: 'Wh',
            location: 'Outlet'
        });

        // --- Puissances agrégées (SANS phase) -> tes graphes les lisent directement ---
        if (session.includeActive) {
            out.push({
                value: session.activeW.toFixed(1),
                context: 'Sample.Periodic',
                measurand: 'Power.Active.Import',
                unit: 'W',
                location: 'Outlet'
            });
        }
        if (session.includeOffered) {
            out.push({
                value: session.offeredW.toFixed(1),
                context: 'Sample.Periodic',
                measurand: 'Power.Offered',
                unit: 'W',
                location: 'Outlet'
            });
        }

        // --- Déclinaisons selon topologie ---
        if (session.chargerType === 'DC') {
            this.addDCMeasurands(out, session);
        } else if (session.chargerType === 'AC_MONO') {
            const I = session.maxCurrentA;
            const V = session.voltageV || 230;
            const perPhaseActive = session.activeW;
            const perPhaseOffered = session.offeredW;
            const perPhaseCurrent = V > 0 ? perPhaseActive / V : 0;
            this.addMonophaseMeasurands(out, session, perPhaseOffered, perPhaseActive, perPhaseCurrent, V);
        } else {
            // TRI : réparti avec un léger déséquilibre
            const V = session.voltageV || 230;
            const phases: Array<'L1' | 'L2' | 'L3'> = ['L1', 'L2', 'L3'];
            let sumActive = 0, sumOffered = 0;
            phases.forEach((ph) => {
                const k = 1 + (Math.random() - 0.5) * 0.06; // ±3% par phase
                const pActive = (session.activeW / 3) * k;
                const pOffered = (session.offeredW / 3) * k;
                sumActive += pActive; sumOffered += pOffered;
                const I = V > 0 ? pActive / V : 0;

                if (session.includeOffered) {
                    out.push({
                        value: pOffered.toFixed(1),
                        context: 'Sample.Periodic',
                        measurand: 'Power.Offered',
                        unit: 'W',
                        phase: ph,
                        location: 'Outlet'
                    });
                }
                if (session.includeActive) {
                    out.push({
                        value: pActive.toFixed(1),
                        context: 'Sample.Periodic',
                        measurand: 'Power.Active.Import',
                        unit: 'W',
                        phase: ph,
                        location: 'Outlet'
                    });
                }
                out.push({
                    value: I.toFixed(3),
                    context: 'Sample.Periodic',
                    measurand: 'Current.Import',
                    unit: 'A',
                    phase: ph,
                    location: 'Outlet'
                });
                out.push({
                    value: V.toFixed(0),
                    context: 'Sample.Periodic',
                    measurand: 'Voltage',
                    unit: 'V',
                    phase: ph,
                    location: 'Outlet'
                });
            });

            // neutre / fréquence / facteur de puissance
            out.push({
                value: (Math.random() * 0.6).toFixed(3),
                context: 'Sample.Periodic',
                measurand: 'Current.Import',
                unit: 'A',
                phase: 'N',
                location: 'Outlet'
            });
            out.push({
                value: (50 + (Math.random() - 0.5) * 0.10).toFixed(2),
                context: 'Sample.Periodic',
                measurand: 'Frequency',
                unit: 'Hz',
                location: 'Outlet'
            });
            out.push({
                value: (0.96 + Math.random() * 0.03).toFixed(2),
                context: 'Sample.Periodic',
                measurand: 'Power.Factor',
                location: 'Outlet'
            });
        }

        if (session.includeSoc) {
            out.push({
                value: session.soc.toFixed(1),
                context: 'Sample.Periodic',
                measurand: 'SoC',
                unit: 'Percent',
                location: 'EV'
            });
        }

        // Un petit extra "inoffensif" pour la page de logs
        out.push({
            value: (20 + Math.random() * 10).toFixed(1),
            context: 'Sample.Periodic',
            measurand: 'Temperature',
            unit: 'Celsius',
            location: 'Body'
        });

        return { timestamp: ts, sampledValue: out };
    }

    private addDCMeasurands(out: SampledValue[], s: EVSession): void {
        const I = s.voltageV > 0 ? s.activeW / s.voltageV : 0;

        out.push({
            value: I.toFixed(3),
            context: 'Sample.Periodic',
            measurand: 'Current.Import',
            unit: 'A',
            location: 'Outlet'
        });
        out.push({
            value: s.voltageV.toFixed(0),
            context: 'Sample.Periodic',
            measurand: 'Voltage',
            unit: 'V',
            location: 'Outlet'
        });
    }

    private addMonophaseMeasurands(
        out: SampledValue[],
        s: EVSession,
        offeredW: number,
        activeW: number,
        currentA: number,
        V: number
    ): void {
        if (s.includeOffered) {
            out.push({
                value: offeredW.toFixed(1),
                context: 'Sample.Periodic',
                measurand: 'Power.Offered',
                unit: 'W',
                phase: 'L1',
                location: 'Outlet'
            });
        }
        if (s.includeActive) {
            out.push({
                value: activeW.toFixed(1),
                context: 'Sample.Periodic',
                measurand: 'Power.Active.Import',
                unit: 'W',
                phase: 'L1',
                location: 'Outlet'
            });
        }
        out.push({
            value: currentA.toFixed(3),
            context: 'Sample.Periodic',
            measurand: 'Current.Import',
            unit: 'A',
            phase: 'L1',
            location: 'Outlet'
        });
        out.push({
            value: V.toFixed(0),
            context: 'Sample.Periodic',
            measurand: 'Voltage',
            unit: 'V',
            phase: 'L1',
            location: 'Outlet'
        });
        out.push({
            value: (activeW * 0.1).toFixed(1),
            context: 'Sample.Periodic',
            measurand: 'Power.Reactive.Import',
            unit: 'var',
            phase: 'L1',
            location: 'Outlet'
        });
        out.push({
            value: '0.96',
            context: 'Sample.Periodic',
            measurand: 'Power.Factor',
            location: 'Outlet'
        });
    }

    private generateMessageId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    cleanup(): void {
        this.intervals.forEach(itv => clearInterval(itv));
        this.intervals.clear();
        this.sessions.clear();
        this.intervalSeconds.clear();
        this.lastTickTs.clear();
    }
}
