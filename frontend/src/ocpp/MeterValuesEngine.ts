// src/ocpp/MeterValuesEngine.ts
import { OcppClient } from './OcppClient';

export type MVConfig = {
    connectorId: number;
    periodSec: number;
    includeSoc: boolean;
    includePower: boolean;
    includeEnergy: boolean;
};

export type EngineHooks = {
    onLog?: (line: string) => void;
    onLocalUpdate?: (patch: { currentPower: number; meterValue: number; soc: number }) => void;
};

export type EngineOptions = {
    // puissance "physique" max côté borne (W) — déjà limitée par phases & courant max
    basePhysicalW: number;
    // bruit de puissance (W)
    powerJitterW?: number;
    // capacité batterie simulée (kWh) pour convertir puissance -> SoC
    batteryKWh?: number;
};

export class MeterValuesEngine {
    private client: OcppClient;
    private hooks: EngineHooks;
    private cfg: MVConfig;
    private opt: Required<EngineOptions>;
    private timer?: any;

    private transactionId?: number;
    private meterWh = 0;
    private soc = 20; // %
    private startedAt = 0;

    // limites dynamiques fournies par l'app (SCP/Vehicle/Fuzzy)
    private limitFn: () => number; // retourne la limite "appliquée" (W)

    constructor(
        client: OcppClient,
        hooks: EngineHooks,
        cfg: MVConfig,
        opt: EngineOptions,
        limitFn: () => number
    ) {
        this.client = client;
        this.hooks = hooks;
        this.cfg = cfg;
        this.opt = {
            basePhysicalW: Math.max(0, opt.basePhysicalW),
            powerJitterW: opt.powerJitterW ?? 0,
            batteryKWh: opt.batteryKWh ?? 75,
        };
        this.limitFn = limitFn;
    }

    setConfig(next: Partial<MVConfig>) {
        this.cfg = { ...this.cfg, ...next };
        if (next.periodSec && this.timer) {
            this.stop();
            this.start(); // redémarre au nouveau pas
        }
    }

    setTransactionId(txId?: number) {
        this.transactionId = txId;
    }

    setInitialState(socPct: number, meterWh: number) {
        this.soc = Math.max(0, Math.min(100, socPct));
        this.meterWh = Math.max(0, meterWh);
    }

    sendInitialMV() {
        this._sendOneMV(this.opt.basePhysicalW); // preview
        this.hooks.onLog?.('⚡ Envoi MV initial');
    }

    start() {
        if (this.timer) return;
        this.startedAt = Date.now();
        const tick = async () => {
            const allowedW = Math.max(0, this.limitFn()); // limite appliquée (W)
            // puissance brute côté borne
            let pW = this.opt.basePhysicalW;
            if (this.opt.powerJitterW > 0) {
                const j = (Math.random() * 2 - 1) * this.opt.powerJitterW;
                pW = Math.max(0, pW + j);
            }
            // puissance active réellement délivrée
            const activeW = Math.max(0, Math.min(pW, allowedW));

            // met à jour énergie & SoC avec la puissance active
            const dt_h = this.cfg.periodSec / 3600;
            const dWh = activeW * dt_h;
            this.meterWh += dWh;

            const kWhDelivered = dWh / 1000;
            const socDelta = (kWhDelivered / this.opt.batteryKWh) * 100;
            this.soc = Math.min(100, this.soc + socDelta);

            // envoi MV
            await this._sendOneMV(activeW);

            // callback local pour l'UI
            this.hooks.onLocalUpdate?.({
                currentPower: activeW,
                meterValue: this.meterWh,
                soc: this.soc,
            });

            if (this.soc >= 100) this.stop();
        };

        this.timer = setInterval(tick, this.cfg.periodSec * 1000);
        this.hooks.onLog?.(`⏱️ Démarrage MeterValues (${this.cfg.periodSec}s)`);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.hooks.onLog?.('⏹️ Arrêt MeterValues');
    }

    private async _sendOneMV(activeW: number) {
        if (!this.transactionId) return;

        const sampledValue: any[] = [];
        if (this.cfg.includeEnergy) {
            sampledValue.push({
                value: Math.round(this.meterWh).toString(),
                context: 'Sample.Periodic',
                measurand: 'Energy.Active.Import.Register',
                unit: 'Wh',
            });
        }
        if (this.cfg.includePower) {
            sampledValue.push({
                value: Math.round(activeW).toString(),
                context: 'Sample.Periodic',
                measurand: 'Power.Active.Import',
                unit: 'W',
            });
        }
        if (this.cfg.includeSoc) {
            sampledValue.push({
                value: this.soc.toFixed(1),
                context: 'Sample.Periodic',
                measurand: 'SoC',
                unit: 'Percent',
            });
        }

        const payload = {
            connectorId: this.cfg.connectorId,
            transactionId: this.transactionId,
            meterValue: [
                {
                    timestamp: new Date().toISOString(),
                    sampledValue,
                },
            ],
        };
        this.client.sendCall('MeterValues', payload);
    }
}
