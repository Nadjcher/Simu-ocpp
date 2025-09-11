// src/ocpp/OcppClient.ts
// Client OCPP 1.6 avec logs "style JavaFX" + suivi CALL/CALLRESULT/CALLERROR

export type OcppHooks = {
    onLog?: (line: string) => void;
    onOpen?: () => void;
    onClose?: (ev?: CloseEvent) => void;
    onCall?: (action: string, messageId: string, payload: any) => void;
    onResult?: (action: string, payload: any) => void;
    onError?: (action: string | undefined, code: string, description: string, details: any) => void;
};

export type OcppClientOptions = {
    url: string;   // ex: wss://.../ocpp/WebSocket
    cpId: string;  // ex: POP-...
    // Logs
    showRaw?: boolean;       // log de la trame JSON brute (par défaut true)
    javafxStyle?: boolean;   // timestamps ISO + phrasé JavaFX (par défaut true)
};

export class OcppClient {
    private opts: Required<OcppClientOptions>;
    private hooks: OcppHooks;
    private ws?: WebSocket;

    private pending = new Map<string, string>(); // msgId -> action
    private heartbeatTimer?: any;

    constructor(opts: OcppClientOptions, hooks: OcppHooks = {}) {
        this.opts = {
            url: opts.url,
            cpId: opts.cpId,
            showRaw: opts.showRaw ?? true,
            javafxStyle: opts.javafxStyle ?? true,
        };
        this.hooks = hooks;
    }

    /* ---------------- Utils log ---------------- */
    private nowIso() { return new Date().toISOString(); }
    private log(line: string) {
        this.hooks.onLog?.(this.opts.javafxStyle ? `[${this.nowIso()}] ${line}` : line);
    }

    /* ---------------- Connexion ---------------- */
    connect() {
        const { url, cpId } = this.opts;
        // NOTE: en navigateur on ne peut PAS désactiver TLS — côté serveur seulement.
        const full = url.endsWith('/') ? url + cpId : `${url}/${cpId}`;
        this.log(`→ WS ouvert sur ${full}`);

        const ws = new WebSocket(full, ['ocpp1.6']);
        this.ws = ws;

        ws.onopen = () => {
            this.log(`← WS ouvert (subproto=${ws.protocol || 'ocpp1.6'})`);
            this.hooks.onOpen?.();
        };

        ws.onerror = () => {
            this.log(`❌ WS erreur`);
        };

        ws.onclose = (ev) => {
            this.log(`← WS fermé: code=${ev.code} / raison=${ev.reason || ''}`);
            this.clearHeartbeat();
            this.hooks.onClose?.(ev);
        };

        ws.onmessage = (ev) => {
            const raw = String(ev.data || '');
            if (this.opts.showRaw) this.log(`← Reçu : ${raw}`);

            let data: any;
            try { data = JSON.parse(raw); } catch {
                this.log(`❌ Parse JSON`);
                return;
            }
            const t = data[0];
            if (t === 2) {               // CALL
                const [, messageId, action, payload] = data;
                this.hooks.onCall?.(action, messageId, payload);
            } else if (t === 3) {        // CALLRESULT
                const [, messageId, payload] = data;
                const action = this.pending.get(messageId);
                if (action) {
                    this.hooks.onResult?.(action, payload);
                    this.pending.delete(messageId);
                } else {
                    this.hooks.onResult?.(undefined as any, payload);
                }
            } else if (t === 4) {        // CALLERROR
                const [, messageId, code, desc, details] = data;
                const action = this.pending.get(messageId);
                this.hooks.onError?.(action, code, desc, details);
                if (action) this.pending.delete(messageId);
            }
        };
    }

    disconnect() {
        this.clearHeartbeat();
        this.ws?.close();
        this.ws = undefined;
    }

    /* ---------------- Heartbeat ---------------- */
    startHeartbeat(intervalSec: number) {
        this.clearHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.sendCall('Heartbeat', {});
        }, Math.max(1, intervalSec) * 1000);
    }
    private clearHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
    }

    /* ---------------- Envoi OCPP ---------------- */
    private nextId() {
        // msgId lisible comme en JavaFX (UUID si possible)
        const c: any = (globalThis as any).crypto;
        if (c?.randomUUID) return c.randomUUID();
        return `m-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    }

    sendCall(action: string, payload: any) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log(`❌ WS non connecté pour ${action}`);
            return;
        }
        const id = this.nextId();
        this.pending.set(id, action);
        const frame = [2, id, action, payload];
        this.log(`→ Sent ${action}(msgId=${id})`);
        if (this.opts.showRaw) this.log(`→ ${JSON.stringify(frame)}`);
        this.ws.send(JSON.stringify(frame));
    }

    sendCallResult(messageId: string, payload: any) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const frame = [3, messageId, payload ?? {}];
        if (this.opts.showRaw) this.log(`→ ${JSON.stringify(frame)}`);
        this.ws.send(JSON.stringify(frame));
        this.log(`→ Response sent [${messageId}]`);
    }

    sendCallError(messageId: string, code: string, description: string, details: any) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const frame = [4, messageId, code, description, details ?? {}];
        if (this.opts.showRaw) this.log(`→ ${JSON.stringify(frame)}`);
        this.ws.send(JSON.stringify(frame));
        this.log(`→ Error sent [${messageId}] ${code} ${description}`);
    }
}
