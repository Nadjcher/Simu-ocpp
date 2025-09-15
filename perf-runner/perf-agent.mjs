// perf-agent.mjs  (Node 18+, ESM)  — fixe: double StartTx + MV + hold long
// npm i ws
//
// Exemples :
//   node perf-agent.mjs --url=wss://host/ocpp/WebSocket --csv=perf_sessions.csv --total=1 --concurrent=1 --hold=300 --mv=5 --debug
//
// Options:
//   --url=...            Base WS (ex: .../ocpp/WebSocket)
//   --csv=...            CSV "cpId,idTag" sans header
//   --total=1000         Nombre total de sessions à lancer
//   --concurrent=200     Connexions simultanées max
//   --ramp=5             ms entre lancements
//   --hold=20            secondes entre StartTx et StopTx
//   --mv=0               secondes entre MeterValues (0 = off)
//   --noAuth / --noStart / --noStop
//   --debug
//   --proto=ocpp1.6
//   --insecure           (TLS self-signed)
//   --noAppendCpId
//   --grep=regex         filtre sur cpId
//   --offset=N           ignorer N lignes CSV

import fs from 'fs';
import WebSocket from 'ws';

// ---------- args ----------
function parseArgs(argv) {
    const out = {
        url: '',
        csv: 'perf_sessions.csv',
        total: 100,
        concurrent: 20,
        ramp: 5,
        hold: 20,
        mv: 0,
        noAuth: false,
        noStart: false,
        noStop: false,
        debug: false,
        proto: 'ocpp1.6',
        insecure: false,
        noAppendCpId: false,
        grep: null,
        offset: 0
    };
    for (const a of argv.slice(2)) {
        if (!a.startsWith('--')) continue;
        const [k, vRaw] = a.split('=');
        const key = k.replace(/^--/, '');
        const v = vRaw ?? 'true';
        switch (key) {
            case 'url': out.url = v; break;
            case 'csv': out.csv = v; break;
            case 'total': out.total = Number(v); break;
            case 'concurrent': out.concurrent = Number(v); break;
            case 'ramp': out.ramp = Number(v); break;
            case 'hold': out.hold = Number(v); break;
            case 'mv': out.mv = Number(v); break;
            case 'noAuth': out.noAuth = v === 'true'; break;
            case 'noStart': out.noStart = v === 'true'; break;
            case 'noStop': out.noStop = v === 'true'; break;
            case 'debug': out.debug = v === 'true'; break;
            case 'proto': out.proto = v; break;
            case 'insecure': out.insecure = v === 'true'; break;
            case 'noAppendCpId': out.noAppendCpId = v === 'true'; break;
            case 'grep': out.grep = v; break;
            case 'offset': out.offset = Number(v); break;
        }
    }
    return out;
}

const opt = parseArgs(process.argv);
if (!opt.url) { console.error('Missing --url'); process.exit(1); }
if (opt.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ---------- csv ----------
function loadCsv(file, { grep, offset }) {
    const txt = fs.readFileSync(file, 'utf8');
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
        const [cpId, idTag] = line.split(',').map(s => (s ?? '').trim());
        if (!cpId) continue;
        if (grep) {
            try { const re = new RegExp(grep); if (!re.test(cpId)) continue; } catch {}
        }
        out.push({ cpId, idTag: idTag || 'TEST-TAG' });
    }
    return out.slice(offset);
}

// ---------- helpers ----------
const CALL = 2, CALLRESULT = 3, CALLERROR = 4;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ---------- Session ----------
class Session {
    constructor(agent, row, index) {
        this.agent = agent;
        this.cpId = row.cpId;
        this.idTag = row.idTag;
        this.index = index;

        this.ws = null;
        this.seq = 1;
        this.pending = new Map();

        this.txId = null;
        this.meterWh = 0;
        this.mvTimer = null;

        // gardes anti-doublon
        this.startRequested = false;  // StartTransaction envoyé ?
        this.startedOnce    = false;  // StartTransaction accepté/traité ?
        this.stopScheduled  = false;  // StopTransaction programmé ?
        this.stopSent       = false;  // StopTransaction envoyé ?

        this.flags = {
            noAuth: agent.flags.noAuth,
            noStart: agent.flags.noStart,
            noStop: agent.flags.noStop
        };

        this.debug = agent.debug;
        this.mvPeriodSec = agent.mvPeriodSec;
        this.holdSec = agent.holdSec;
        this.baseUrl = agent.url;
        this.appendCpId = agent.appendCpId;
        this.proto = agent.proto;

        this.done = false;
    }

    log(...args) { console.log(...args); }

    open() {
        const url = this.appendCpId ? `${this.baseUrl.replace(/\/$/, '')}/${this.cpId}` : this.baseUrl;
        if (this.debug) this.log(`[${this.cpId}] OPEN ${url} stop:0ms`);
        this.ws = new WebSocket(url, this.proto ? [this.proto] : undefined, { perMessageDeflate: false });
        this.ws.on('open',    () => this.onOpen());
        this.ws.on('message', (d) => this.onMessage(d));
        this.ws.on('error',   (e) => this.onError(e));
        this.ws.on('close',   (c, r) => this.onClose(c, r));
    }

    close() { try { this.ws?.close(1000, 'perf-end'); } catch {} }

    send(action, payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const msgId = `${this.cpId}-${Date.now()}-${this.seq++}`;
        const frame = [CALL, msgId, action, payload ?? {}];
        this.pending.set(msgId, { action, sentAt: Date.now() });
        try {
            this.ws.send(JSON.stringify(frame));
            if (this.debug) this.log(`[${this.cpId}] → ${action} ${JSON.stringify(payload, null, 2)}`);
            else this.log(`[${this.cpId}] → ${action}`);
        } catch (e) {
            this.agent.onError();
            if (this.debug) this.log(`[${this.cpId}] SEND ERROR ${action}: ${e?.message || e}`);
        }
    }

    reply(msgId, body) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const frame = [CALLRESULT, msgId, body ?? {}];
        try {
            this.ws.send(JSON.stringify(frame));
            if (this.debug) this.log(`[${this.cpId}] → Response ${msgId} ${JSON.stringify(body)}`);
        } catch (e) {
            if (this.debug) this.log(`[${this.cpId}] RESPONSE ERROR: ${e?.message}`);
        }
    }

    onOpen() {
        this.agent.onActive(+1);
        this.send('BootNotification', {
            chargePointVendor: 'EVSE Simulator',
            chargePointModel: 'PerfAgent',
            chargePointSerialNumber: this.cpId,
            chargeBoxSerialNumber: this.cpId,
            firmwareVersion: 'perf',
            meterType: 'AC',
            meterSerialNumber: `METER-${this.cpId}`
        });
    }

    // envoi StartTx protégé (une seule fois)
    maybeStartTx() {
        if (this.flags.noStart) return;
        if (this.startRequested || this.txId != null) return;
        this.startRequested = true;
        this.send('StartTransaction', {
            connectorId: 1, idTag: this.idTag, meterStart: Math.round(this.meterWh), timestamp: nowIso()
        });
    }

    // après StartTx accepté : lancer MV + programmer StopTx (une seule fois)
    afterStartTx = (payload) => {
        if (this.startedOnce) return;
        this.startedOnce = true;

        this.txId = payload?.transactionId ?? this.txId;
        if (this.debug) this.log(`[${this.cpId}] StartTx accepted txId=${this.txId}`);
        this.agent.onStartAccepted();

        // MV
        if (this.mvPeriodSec > 0 && !this.mvTimer) {
            const periodMs = this.mvPeriodSec * 1000;
            this.mvTimer = setInterval(() => {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.txId == null) return;
                const powerW = Math.max(1000, Math.round(11000 * (1 + (Math.random() - 0.5) * 0.1)));
                const deltaWh = (powerW * this.mvPeriodSec) / 3600;
                this.meterWh += deltaWh;
                this.send('MeterValues', {
                    connectorId: 1,
                    transactionId: this.txId,
                    meterValue: [{
                        timestamp: nowIso(),
                        sampledValue: [
                            { context: 'Sample.Periodic', measurand: 'Energy.Active.Import.Register', value: String(Math.round(this.meterWh)), unit: 'Wh' },
                            { context: 'Sample.Periodic', measurand: 'Power.Active.Import', value: String(powerW), unit: 'W' }
                        ]
                    }]
                });
                if (this.debug) this.log(`[${this.cpId}] → MV ${(powerW/1000).toFixed(1)}kW, meter=${Math.round(this.meterWh)}Wh`);
            }, periodMs);
        }

        // StopTx programmé une seule fois
        if (!this.flags.noStop && !this.stopScheduled) {
            this.stopScheduled = true;
            const holdMs = (this.holdSec || 10) * 1000;
            setTimeout(() => this.maybeStopTx(), holdMs);
        }
    };

    maybeStopTx() {
        if (this.flags.noStop) return;
        if (this.stopSent) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.txId == null) return;

        this.stopSent = true;
        if (this.mvTimer) { clearInterval(this.mvTimer); this.mvTimer = null; }
        this.send('StopTransaction', {
            transactionId: this.txId,
            meterStop: Math.round(this.meterWh || 0),
            timestamp: nowIso(),
            reason: 'Local'
        });
        if (this.debug) this.log(`[${this.cpId}] → StopTransaction txId=${this.txId}`);
    }

    onMessage(raw) {
        let data;
        try { data = JSON.parse(raw); } catch { if (this.debug) this.log(`[${this.cpId}] PARSE ERROR: ${raw}`); return; }
        const type = data[0];

        if (type === CALLRESULT) {
            const [, msgId, payload] = data;
            const pend = this.pending.get(msgId);
            if (!pend) return;
            if (this.debug) this.log(`[${this.cpId}] ← RESULT ${pend.action} ${JSON.stringify(payload, null, 2)}`);

            const rt = Date.now() - (pend.sentAt || Date.now());
            switch (pend.action) {
                case 'BootNotification': {
                    this.agent.addBootTime(rt);
                    const status = payload?.status;
                    if (status === 'Accepted') {
                        if (!this.flags.noAuth) {
                            this.send('Authorize', { idTag: this.idTag });
                        } else {
                            this.maybeStartTx();
                        }
                    } else {
                        if (this.debug) this.log(`[${this.cpId}] Boot rejected`);
                        this.safeDone();
                    }
                    break;
                }
                case 'Authorize': {
                    this.agent.addAuthTime(rt);
                    this.maybeStartTx();
                    break;
                }
                case 'StartTransaction': {
                    this.agent.addStartTime(rt);
                    this.afterStartTx(payload);
                    break;
                }
                case 'StopTransaction': {
                    this.agent.addStopTime(rt);
                    setTimeout(() => this.safeDone(), 200);
                    break;
                }
                default: break;
            }
            this.pending.delete(msgId);
        }

        else if (type === CALL) {
            const [, msgId, action, payload] = data;
            if (!msgId || !action) return;
            if (!this.debug) this.log(`[${this.cpId}] ← CALL ${action}`);
            else this.log(`[${this.cpId}] ← CALL ${action} ${JSON.stringify(payload)}`);

            switch (action) {
                case 'GetConfiguration':
                    this.reply(msgId, {
                        configurationKey: [
                            { key: 'HeartbeatInterval', readonly: false, value: '300' },
                            { key: 'MeterValueSampleInterval', readonly: false, value: String(this.mvPeriodSec || 0) },
                            { key: 'NumberOfConnectors', readonly: true, value: '1' }
                        ],
                        unknownKey: []
                    });
                    break;
                case 'Reset':
                    this.reply(msgId, { status: 'Accepted' });
                    setTimeout(() => this.close(), 200);
                    break;
                case 'ChangeAvailability':
                case 'ChangeConfiguration':
                case 'SetChargingProfile':
                case 'ClearChargingProfile':
                case 'UnlockConnector':
                case 'RemoteStartTransaction':
                case 'RemoteStopTransaction':
                case 'TriggerMessage':
                case 'DataTransfer':
                case 'UpdateFirmware':
                case 'GetDiagnostics':
                case 'DiagnosticsStatusNotification':
                case 'FirmwareStatusNotification':
                default:
                    this.reply(msgId, { status: 'Accepted' });
            }
        }

        else if (type === CALLERROR) {
            const [, msgId, code, desc] = data;
            const pend = this.pending.get(msgId);
            this.agent.onError();
            if (this.debug) this.log(`[${this.cpId}] ❌ ERROR ${pend?.action || ''}: ${code} – ${desc}`);
            this.pending.delete(msgId);
        }
    }

    onError(err) { this.agent.onError(); if (this.debug) this.log(`[${this.cpId}] WS ERROR: ${err?.message || err}`); }

    onClose(code, reason) {
        if (this.debug) this.log(`[${this.cpId}] CLOSE ${code} ${reason || ''}`);
        this.safeDone();
    }

    safeDone() {
        if (this.done) return;
        this.done = true;
        if (this.mvTimer) { clearInterval(this.mvTimer); this.mvTimer = null; }
        this.agent.onActive(-1);
        this.agent.onClosed();
    }
}

// ---------- Agent ----------
class Agent {
    constructor(opt) {
        this.url = opt.url;
        this.csvFile = opt.csv;
        this.total = opt.total;
        this.concurrent = Math.max(1, opt.concurrent);
        this.rampMs = Math.max(0, opt.ramp);
        this.holdSec = Math.max(0, opt.hold);
        this.mvPeriodSec = Math.max(0, opt.mv);
        this.debug = !!opt.debug;
        this.proto = opt.proto || 'ocpp1.6';
        this.appendCpId = !opt.noAppendCpId;
        this.flags = { noAuth: !!opt.noAuth, noStart: !!opt.noStart, noStop: !!opt.noStop };

        this.rows = loadCsv(this.csvFile, { grep: opt.grep, offset: opt.offset });

        this.launchIdx = 0;
        this.active = 0;
        this.launched = 0;
        this.startedTx = 0; // StartTransaction acceptés
        this.closed = 0;
        this.errors = 0;

        this.tBoot = [];
        this.tAuth = [];
        this.tStart = [];
        this.tStop = [];

        this.printTimer = null;
    }

    avg(arr) { return arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0; }
    addBootTime(ms){ this.tBoot.push(ms); }
    addAuthTime(ms){ this.tAuth.push(ms); }
    addStartTime(ms){ this.tStart.push(ms); }
    addStopTime(ms){ this.tStop.push(ms); }

    onStartAccepted(){ this.startedTx++; }
    onLaunched(){ this.launched++; }
    onActive(delta){ this.active += delta; }
    onClosed(){ this.closed++; }
    onError(){ this.errors++; }

    async run() {
        console.log(`Perf-agent:
  url=${this.url}
  csv=${this.csvFile} (rows=${this.rows.length})
  total=${this.total} concurrent=${this.concurrent} ramp=${this.rampMs}ms hold=${this.holdSec}s mv=${this.mvPeriodSec}s
  flags: noAuth=${this.flags.noAuth} noStart=${this.flags.noStart} noStop=${this.flags.noStop}
  time=${nowIso()}
`);

        this.printTimer = setInterval(() => {
            process.stdout.write(
                `Launched:${this.launched} Active:${this.active} StartedTx:${this.startedTx} Closed:${this.closed} Errors:${this.errors} | ` +
                `avg boot:${this.avg(this.tBoot)}ms auth:${this.avg(this.tAuth)}ms start:${this.avg(this.tStart)}ms stop:${this.avg(this.tStop)}ms     \r`
            );
        }, 500);

        const max = Math.min(this.total, this.rows.length);
        const queue = this.rows.slice(0, max);

        let inFlight = 0;
        const next = async () => {
            while (this.launchIdx < max && inFlight < this.concurrent) {
                const row = queue[this.launchIdx++];
                inFlight++;
                const s = new Session(this, row, this.launchIdx);
                this.onLaunched();
                s.open();

                await sleep(this.rampMs);

                const chk = setInterval(() => {
                    if (s.done) {
                        inFlight--;
                        clearInterval(chk);
                        if (this.launchIdx < max) next();
                        else if (inFlight === 0) this.finish();
                    }
                }, 100);
            }
        };

        for (let i = 0; i < Math.min(this.concurrent, max); i++) next();
    }

    finish() {
        if (this.printTimer) { clearInterval(this.printTimer); this.printTimer = null; }
        console.log(
            `Launched:${this.launched} Active:${this.active} StartedTx:${this.startedTx} Closed:${this.closed} Errors:${this.errors} | ` +
            `avg boot:${this.avg(this.tBoot)}ms auth:${this.avg(this.tAuth)}ms start:${this.avg(this.tStart)}ms stop:${this.avg(this.tStop)}ms`
        );
        console.log('DONE');
        process.exit(0);
    }
}

// ---------- start ----------
const agent = new Agent(opt);
agent.run().catch(e => { console.error('Agent failed:', e); process.exit(1); });
