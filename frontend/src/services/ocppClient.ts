// frontend/src/services/ocppClient.ts
export class OCPPClient {
    private ws: WebSocket | null = null;
    private url: string;
    private cpId: string;
    private transactionId: number | null = null;
    private lastIdTag: string = '';
    private pendingRequests: Map<string, (response: any) => void> = new Map();

    // Callbacks
    private onOpen?: () => void;
    private onClose?: () => void;
    private onBootAccepted?: () => void;
    private onAuthorizeAccepted?: (accepted: boolean) => void;
    private onStartAccepted?: (txId: number) => void;
    private onStopAccepted?: () => void;
    private onStatusUpdate?: (status: string) => void;
    private onLog?: (message: string) => void;
    private onMeterValues?: (values: any) => void;
    private onChargingProfile?: (profile: any) => void;

    constructor(
        url: string,
        cpId: string,
        callbacks: {
            onOpen?: () => void;
            onClose?: () => void;
            onBootAccepted?: () => void;
            onAuthorizeAccepted?: (accepted: boolean) => void;
            onStartAccepted?: (txId: number) => void;
            onStopAccepted?: () => void;
            onStatusUpdate?: (status: string) => void;
            onLog?: (message: string) => void;
            onMeterValues?: (values: any) => void;
            onChargingProfile?: (profile: any) => void;
        }
    ) {
        this.url = url;
        this.cpId = cpId;
        Object.assign(this, callbacks);
    }

    connect() {
        const fullUrl = `${this.url}/${this.cpId}`;
        this.log(`→ Connexion à ${fullUrl}`);

        this.ws = new WebSocket(fullUrl, ['ocpp1.6']);

        this.ws.onopen = () => {
            this.log('← WebSocket ouvert');
            this.onOpen?.();
            this.sendBootNotification();
        };

        this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
            this.log(`!! Erreur WebSocket: ${error}`);
        };

        this.ws.onclose = () => {
            this.log('← WebSocket fermé');
            this.onClose?.();
        };
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    private handleMessage(data: string) {
        this.log(`← Reçu: ${data}`);

        try {
            const message = JSON.parse(data);
            const [messageType, messageId, ...rest] = message;

            // Type 2 = CALL (requête du serveur)
            if (messageType === 2) {
                const [action, payload] = rest;
                this.handleCall(messageId, action, payload);
            }
            // Type 3 = CALLRESULT (réponse à notre requête)
            else if (messageType === 3) {
                const [payload] = rest;
                this.handleCallResult(messageId, payload);
            }
            // Type 4 = CALLERROR
            else if (messageType === 4) {
                const [errorCode, errorDescription, errorDetails] = rest;
                this.log(`!! Erreur OCPP: ${errorCode} - ${errorDescription}`);
            }
        } catch (e) {
            this.log(`!! Erreur parsing: ${e}`);
        }
    }

    private handleCall(messageId: string, action: string, payload: any) {
        switch (action) {
            case 'SetChargingProfile':
                this.handleSetChargingProfile(messageId, payload);
                break;
            case 'ClearChargingProfile':
                this.handleClearChargingProfile(messageId, payload);
                break;
            case 'RemoteStartTransaction':
                this.sendCallResult(messageId, { status: 'Accepted' });
                this.sendAuthorize(payload.idTag);
                break;
            case 'RemoteStopTransaction':
                this.sendCallResult(messageId, { status: 'Accepted' });
                this.stopTransaction();
                break;
            default:
                this.log(`Action non gérée: ${action}`);
        }
    }

    private handleCallResult(messageId: string, payload: any) {
        const pendingRequest = this.pendingRequests.get(messageId);
        if (pendingRequest) {
            pendingRequest(payload);
            this.pendingRequests.delete(messageId);
        }

        // Gérer les réponses spécifiques
        if (payload.status === 'Accepted' && payload.currentTime) {
            // BootNotification accepté
            this.onBootAccepted?.();
            this.sendStatusNotification('Available');
        } else if (payload.idTagInfo) {
            // Authorize response
            const accepted = payload.idTagInfo.status === 'Accepted';
            this.onAuthorizeAccepted?.(accepted);
        } else if (payload.transactionId) {
            // StartTransaction response
            this.transactionId = payload.transactionId;
            this.onStartAccepted?.(payload.transactionId);
            this.sendStatusNotification('Charging');
        }
    }

    private handleSetChargingProfile(messageId: string, payload: any) {
        this.log('← SetChargingProfile reçu');
        this.onChargingProfile?.(payload.csChargingProfiles);
        this.sendCallResult(messageId, { status: 'Accepted' });
    }

    private handleClearChargingProfile(messageId: string, payload: any) {
        this.log('← ClearChargingProfile reçu');
        this.sendCallResult(messageId, { status: 'Accepted' });
    }

    // Méthodes d'envoi OCPP
    sendBootNotification() {
        const payload = {
            chargePointVendor: 'SimCorp',
            chargePointModel: 'React Simulator',
            chargeBoxSerialNumber: this.cpId,
            firmwareVersion: '1.0.0'
        };
        this.sendCall('BootNotification', payload);
    }

    sendStatusNotification(status: string, connectorId: number = 1) {
        const payload = {
            connectorId,
            errorCode: 'NoError',
            status,
            timestamp: new Date().toISOString()
        };
        this.sendCall('StatusNotification', payload);
        this.onStatusUpdate?.(status);
    }

    sendAuthorize(idTag: string) {
        this.lastIdTag = idTag;
        const payload = { idTag };
        this.sendCall('Authorize', payload);
    }

    sendStartTransaction(idTag?: string) {
        const payload = {
            connectorId: 1,
            idTag: idTag || this.lastIdTag,
            meterStart: 0,
            timestamp: new Date().toISOString()
        };
        this.sendCall('StartTransaction', payload);
    }

    stopTransaction() {
        if (!this.transactionId) {
            this.log('!! Pas de transaction en cours');
            return;
        }

        const payload = {
            transactionId: this.transactionId,
            meterStop: Math.floor(Math.random() * 10000),
            timestamp: new Date().toISOString()
        };
        this.sendCall('StopTransaction', payload);
        this.transactionId = null;
        this.onStopAccepted?.();
    }

    sendMeterValues(
        transactionId: number,
        values: {
            soc?: number;
            power?: number;
            energy?: number;
            current?: number;
            voltage?: number;
        }
    ) {
        const sampledValue = [];

        if (values.energy !== undefined) {
            sampledValue.push({
                value: values.energy.toString(),
                context: 'Sample.Periodic',
                measurand: 'Energy.Active.Import.Register',
                unit: 'Wh'
            });
        }

        if (values.power !== undefined) {
            sampledValue.push({
                value: values.power.toString(),
                context: 'Sample.Periodic',
                measurand: 'Power.Active.Import',
                unit: 'W'
            });
        }

        if (values.soc !== undefined) {
            sampledValue.push({
                value: values.soc.toString(),
                context: 'Sample.Periodic',
                measurand: 'SoC',
                unit: 'Percent'
            });
        }

        const payload = {
            connectorId: 1,
            transactionId,
            meterValue: [{
                timestamp: new Date().toISOString(),
                sampledValue
            }]
        };

        this.sendCall('MeterValues', payload);
    }

    private sendCall(action: string, payload: any): string {
        const messageId = this.generateMessageId();
        const message = [2, messageId, action, payload];
        this.send(JSON.stringify(message));
        this.log(`→ Envoyé ${action}`);
        return messageId;
    }

    private sendCallResult(messageId: string, payload: any) {
        const message = [3, messageId, payload];
        this.send(JSON.stringify(message));
    }

    private send(message: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        } else {
            this.log('!! WebSocket non connecté');
        }
    }

    private generateMessageId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private log(message: string) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
        this.onLog?.(`[${timestamp}] ${message}`);
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}