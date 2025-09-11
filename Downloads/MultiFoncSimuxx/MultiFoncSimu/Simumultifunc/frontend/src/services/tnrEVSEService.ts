// services/tnrEVSEService.ts
import { EventEmitter } from 'events';

interface Session {
    id: string;
    title: string;
    url: string;
    cpId: string;
    idTag: string;
    state: string;
    vehicleProfile: string;
    chargerType: string;
    maxCurrentA: number;
    soc: number;
    initialSoc: number;
    targetSoc: number;
    batteryCapacityKWh: number;
    maxChargingPowerKW: number;
}

interface SCPMessage {
    timestamp: number;
    sessionId: string;
    data: {
        transactionId?: number;
        connectorId: number;
        csChargingProfiles: {
            chargingProfileId: number;
            stackLevel: number;
            chargingProfilePurpose: string;
            chargingProfileKind: string;
            chargingSchedule: {
                duration?: number;
                startSchedule?: string;
                chargingRateUnit: string;
                chargingSchedulePeriod: Array<{
                    startPeriod: number;
                    limit: number;
                    numberPhases?: number;
                }>;
            };
        };
    };
}

interface TXPMessage {
    timestamp: number;
    sessionId: string;
    data: {
        transactionId: number;
        idTag: string;
        meterStart: number;
        meterStop?: number;
        timestamp: string;
        status: string;
        currentMeterValue: number;
        powerActiveImport: number;
        currentImport: number;
        voltage: number;
        soc?: number;
        energy: number;
    };
}

interface TXDPMessage {
    timestamp: number;
    sessionId: string;
    data: {
        transactionId: number;
        idTag: string;
        meterStart: number;
        meterStop: number;
        timestamp: string;
        reason: string;
        totalEnergy: number;
        totalDuration: number;
        totalCost?: number;
    };
}

export interface TNRRecording {
    id: string;
    name: string;
    description: string;
    startTime: number;
    endTime?: number;

    // Configuration initiale
    sessions: Map<string, Session>;

    // Événements capturés
    events: Array<{
        timestamp: number;
        type: string;
        sessionId: string;
        action: string;
        payload: any;
    }>;

    // Messages OCPP capturés
    scpMessages: SCPMessage[];
    txpMessages: TXPMessage[];
    txdpMessages: TXDPMessage[];

    // Signatures pour validation
    signatures?: {
        scp: string;
        txp: string;
        txdp: string;
        combined: string;
    };
}

export interface TNRComparison {
    scenarioId: string;
    executionId: string;
    timestamp: number;

    passed: boolean;

    scpComparison: {
        match: boolean;
        expectedCount: number;
        actualCount: number;
        expectedSignature: string;
        actualSignature: string;
        differences: Array<{
            index: number;
            field: string;
            expected: any;
            actual: any;
        }>;
    };

    txpComparison: {
        match: boolean;
        expectedCount: number;
        actualCount: number;
        expectedSignature: string;
        actualSignature: string;
        differences: Array<{
            index: number;
            field: string;
            expected: any;
            actual: any;
        }>;
    };

    txdpComparison: {
        match: boolean;
        expectedCount: number;
        actualCount: number;
        expectedSignature: string;
        actualSignature: string;
        differences: Array<{
            index: number;
            field: string;
            expected: any;
            actual: any;
        }>;
    };
}

class TNREVSEService extends EventEmitter {
    private recordings: Map<string, TNRRecording> = new Map();
    private activeRecording: TNRRecording | null = null;
    private isRecording: boolean = false;
    private isReplaying: boolean = false;

    private sessionWebSockets: Map<string, WebSocket> = new Map();
    private messageListeners: Map<string, Function> = new Map();

    constructor() {
        super();
        this.loadRecordings();
    }

    // Démarrer l'enregistrement
    startRecording(name: string, description: string, sessions: Session[]): string {
        if (this.isRecording) {
            throw new Error("Un enregistrement est déjà en cours");
        }

        const recordingId = `tnr_evse_${Date.now()}`;

        this.activeRecording = {
            id: recordingId,
            name,
            description,
            startTime: Date.now(),
            sessions: new Map(sessions.map(s => [s.id, { ...s }])),
            events: [],
            scpMessages: [],
            txpMessages: [],
            txdpMessages: []
        };

        this.isRecording = true;

        // Attacher les listeners sur les WebSockets existants
        this.attachListeners(sessions);

        this.emit('recordingStarted', { recordingId, name });

        return recordingId;
    }

    // Arrêter l'enregistrement
    stopRecording(): TNRRecording | null {
        if (!this.isRecording || !this.activeRecording) {
            return null;
        }

        this.activeRecording.endTime = Date.now();

        // Calculer les signatures
        this.activeRecording.signatures = this.calculateSignatures(this.activeRecording);

        // Sauvegarder l'enregistrement
        this.recordings.set(this.activeRecording.id, this.activeRecording);
        this.saveRecordings();

        // Détacher les listeners
        this.detachListeners();

        const recording = this.activeRecording;
        this.activeRecording = null;
        this.isRecording = false;

        this.emit('recordingStopped', {
            recordingId: recording.id,
            eventCount: recording.events.length,
            scpCount: recording.scpMessages.length,
            txpCount: recording.txpMessages.length,
            txdpCount: recording.txdpMessages.length
        });

        return recording;
    }

    // Capturer un événement
    captureEvent(sessionId: string, type: string, action: string, payload: any): void {
        if (!this.isRecording || !this.activeRecording) return;

        this.activeRecording.events.push({
            timestamp: Date.now(),
            type,
            sessionId,
            action,
            payload
        });
    }

    // Capturer un message SCP
    captureSCP(sessionId: string, message: any): void {
        if (!this.isRecording || !this.activeRecording) return;

        const scpMessage: SCPMessage = {
            timestamp: Date.now(),
            sessionId,
            data: message
        };

        this.activeRecording.scpMessages.push(scpMessage);
        this.emit('scpCaptured', scpMessage);
    }

    // Capturer un message TXP
    captureTXP(sessionId: string, message: any): void {
        if (!this.isRecording || !this.activeRecording) return;

        const txpMessage: TXPMessage = {
            timestamp: Date.now(),
            sessionId,
            data: message
        };

        this.activeRecording.txpMessages.push(txpMessage);
        this.emit('txpCaptured', txpMessage);
    }

    // Capturer un message TXDP
    captureTXDP(sessionId: string, message: any): void {
        if (!this.isRecording || !this.activeRecording) return;

        const txdpMessage: TXDPMessage = {
            timestamp: Date.now(),
            sessionId,
            data: message
        };

        this.activeRecording.txdpMessages.push(txdpMessage);
        this.emit('txdpCaptured', txdpMessage);
    }

    // Rejouer un scénario
    async replayScenario(recordingId: string): Promise<TNRComparison> {
        const recording = this.recordings.get(recordingId);
        if (!recording) {
            throw new Error(`Scénario ${recordingId} non trouvé`);
        }

        if (this.isReplaying) {
            throw new Error("Un replay est déjà en cours");
        }

        this.isReplaying = true;
        this.emit('replayStarted', { recordingId });

        // Créer les sessions avec les mêmes configurations
        const replayedSessions = await this.recreateSessions(recording);

        // Capturer les nouveaux messages
        const capturedSCP: SCPMessage[] = [];
        const capturedTXP: TXPMessage[] = [];
        const capturedTXDP: TXDPMessage[] = [];

        // Attacher des listeners temporaires pour capturer les messages
        const tempListeners = this.attachTemporaryListeners(
            replayedSessions,
            capturedSCP,
            capturedTXP,
            capturedTXDP
        );

        // Rejouer les événements
        for (const event of recording.events) {
            const relativeTime = event.timestamp - recording.startTime;

            // Attendre le bon timing
            await this.delay(Math.min(relativeTime / 10, 100)); // Accéléré 10x, max 100ms

            // Exécuter l'événement
            await this.executeEvent(event, replayedSessions);

            this.emit('replayProgress', {
                current: recording.events.indexOf(event) + 1,
                total: recording.events.length
            });
        }

        // Attendre un peu pour capturer les derniers messages
        await this.delay(2000);

        // Détacher les listeners temporaires
        this.detachTemporaryListeners(tempListeners);

        // Comparer les résultats
        const comparison = this.compareResults(
            recording,
            capturedSCP,
            capturedTXP,
            capturedTXDP
        );

        this.isReplaying = false;
        this.emit('replayCompleted', comparison);

        return comparison;
    }

    // ➕ Comparer directement deux scénarios existants (sans replay)
    public compareScenarios(baseId: string, otherId: string): TNRComparison {
        const base = this.recordings.get(baseId);
        const other = this.recordings.get(otherId);
        if (!base) throw new Error(`Scénario ${baseId} non trouvé`);
        if (!other) throw new Error(`Scénario ${otherId} non trouvé`);

        const result: TNRComparison = {
            scenarioId: base.id,
            executionId: `vs_${other.id}_${Date.now()}`,
            timestamp: Date.now(),
            passed: false,
            scpComparison: this.compareMessages(base.scpMessages, other.scpMessages, 'SCP'),
            txpComparison: this.compareMessages(base.txpMessages, other.txpMessages, 'TXP'),
            txdpComparison: this.compareMessages(base.txdpMessages, other.txdpMessages, 'TXDP')
        };

        result.passed =
            result.scpComparison.match &&
            result.txpComparison.match &&
            result.txdpComparison.match;

        this.emit('scenarioCompared', result);
        return result;
    }

    // ➕ Comparer uniquement les signatures (rapide)
    public compareSignatures(baseId: string, otherId: string): {
        scpEqual: boolean;
        txpEqual: boolean;
        txdpEqual: boolean;
        combinedEqual: boolean;
        base: { scp: string; txp: string; txdp: string; combined: string };
        other: { scp: string; txp: string; txdp: string; combined: string };
    } {
        const base = this.recordings.get(baseId);
        const other = this.recordings.get(otherId);
        if (!base) throw new Error(`Scénario ${baseId} non trouvé`);
        if (!other) throw new Error(`Scénario ${otherId} non trouvé`);

        const baseSig = base.signatures ?? this.calculateSignatures(base);
        const otherSig = other.signatures ?? this.calculateSignatures(other);

        return {
            scpEqual: baseSig.scp === otherSig.scp,
            txpEqual: baseSig.txp === otherSig.txp,
            txdpEqual: baseSig.txdp === otherSig.txdp,
            combinedEqual: baseSig.combined === otherSig.combined,
            base: { scp: baseSig.scp, txp: baseSig.txp, txdp: baseSig.txdp, combined: baseSig.combined },
            other: { scp: otherSig.scp, txp: otherSig.txp, txdp: otherSig.txdp, combined: otherSig.combined }
        };
    }

    // Comparer les résultats
    private compareResults(
        expected: TNRRecording,
        actualSCP: SCPMessage[],
        actualTXP: TXPMessage[],
        actualTXDP: TXDPMessage[]
    ): TNRComparison {
        const comparison: TNRComparison = {
            scenarioId: expected.id,
            executionId: `exec_${Date.now()}`,
            timestamp: Date.now(),
            passed: false,
            scpComparison: this.compareMessages(expected.scpMessages, actualSCP, 'SCP'),
            txpComparison: this.compareMessages(expected.txpMessages, actualTXP, 'TXP'),
            txdpComparison: this.compareMessages(expected.txdpMessages, actualTXDP, 'TXDP')
        };

        comparison.passed =
            comparison.scpComparison.match &&
            comparison.txpComparison.match &&
            comparison.txdpComparison.match;

        return comparison;
    }

    // Comparer des messages
    private compareMessages(expected: any[], actual: any[], type: string): any {
        const expectedSignature = this.calculateHash(expected);
        const actualSignature = this.calculateHash(actual);

        const differences: any[] = [];

        // Comparer les longueurs
        if (expected.length !== actual.length) {
            differences.push({
                index: -1,
                field: 'count',
                expected: expected.length,
                actual: actual.length
            });
        }

        // Comparer message par message
        const maxLength = Math.max(expected.length, actual.length);
        for (let i = 0; i < maxLength; i++) {
            if (!expected[i] || !actual[i]) continue;

            const diff = this.deepCompare(expected[i].data, actual[i].data);
            if (diff.length > 0) {
                differences.push(...diff.map(d => ({ index: i, ...d })));
            }
        }

        return {
            match: differences.length === 0,
            expectedCount: expected.length,
            actualCount: actual.length,
            expectedSignature,
            actualSignature,
            differences
        };
    }

    // Comparaison profonde d'objets
    private deepCompare(expected: any, actual: any, path: string = ''): any[] {
        const differences: any[] = [];

        if (typeof expected !== typeof actual) {
            differences.push({
                field: path || 'root',
                expected: typeof expected,
                actual: typeof actual
            });
            return differences;
        }

        if (expected === null || actual === null || typeof expected !== 'object') {
            if (expected !== actual) {
                // Ignorer certains champs qui peuvent varier (timestamps, IDs)
                const ignoredFields = ['timestamp', 'transactionId', 'messageId'];
                const fieldName = path.split('.').pop() || '';

                if (!ignoredFields.includes(fieldName)) {
                    differences.push({
                        field: path || 'value',
                        expected,
                        actual
                    });
                }
            }
            return differences;
        }

        // Comparer les clés
        const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);

        for (const key of allKeys) {
            const newPath = path ? `${path}.${key}` : key;

            if (!(key in expected)) {
                differences.push({
                    field: newPath,
                    expected: undefined,
                    actual: (actual as any)[key]
                });
            } else if (!(key in actual)) {
                differences.push({
                    field: newPath,
                    expected: (expected as any)[key],
                    actual: undefined
                });
            } else {
                differences.push(...this.deepCompare((expected as any)[key], (actual as any)[key], newPath));
            }
        }

        return differences;
    }

    // Calculer les signatures
    private calculateSignatures(recording: TNRRecording): any {
        return {
            scp: this.calculateHash(recording.scpMessages),
            txp: this.calculateHash(recording.txpMessages),
            txdp: this.calculateHash(recording.txdpMessages),
            combined: this.calculateHash({
                scp: recording.scpMessages,
                txp: recording.txpMessages,
                txdp: recording.txdpMessages
            })
        };
    }

    // Calculer un hash simple
    private calculateHash(data: any): string {
        const json = JSON.stringify(data, this.jsonReplacer);
        let hash = 0;
        for (let i = 0; i < json.length; i++) {
            const char = json.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    // Replacer pour JSON.stringify (ignore les champs variables)
    private jsonReplacer(key: string, value: any): any {
        const ignoredKeys = ['timestamp', 'transactionId', 'messageId', 'id'];
        if (ignoredKeys.includes(key)) {
            return undefined;
        }
        return value;
    }

    // Attacher les listeners WebSocket
    private attachListeners(sessions: Session[]): void {
        for (const session of sessions) {
            // Ici, vous devez récupérer le WebSocket réel de la session
            // Pour la démo, on simule
            const ws = this.getSessionWebSocket(session.id);
            if (ws) {
                const listener = (event: MessageEvent) => {
                    this.handleWebSocketMessage(session.id, event);
                };

                ws.addEventListener('message', listener);
                this.messageListeners.set(session.id, listener);
            }
        }
    }

    // Détacher les listeners
    private detachListeners(): void {
        for (const [sessionId, listener] of this.messageListeners) {
            const ws = this.sessionWebSockets.get(sessionId);
            if (ws) {
                ws.removeEventListener('message', listener as any);
            }
        }
        this.messageListeners.clear();
    }

    // Gérer les messages WebSocket
    private handleWebSocketMessage(sessionId: string, event: MessageEvent): void {
        try {
            const message = JSON.parse((event as any).data);

            // Identifier le type de message
            if (message[0] === 2) { // CALL
                const [, messageId, action, payload] = message;

                // Capturer selon le type d'action
                switch (action) {
                    case 'SetChargingProfile':
                        this.captureSCP(sessionId, payload);
                        break;

                    case 'MeterValues':
                        // Analyser les meter values pour TXP
                        if (payload.transactionId) {
                            this.captureTXP(sessionId, {
                                transactionId: payload.transactionId,
                                ...payload
                            });
                        }
                        break;

                    case 'StopTransaction':
                        // Capturer TXDP
                        this.captureTXDP(sessionId, payload);
                        break;
                }

                // Capturer l'événement générique
                this.captureEvent(sessionId, 'ocpp', action, payload);
            }
        } catch (error) {
            console.error('Erreur parsing message WebSocket:', error);
        }
    }

    // Obtenir le WebSocket d'une session (à implémenter avec votre système)
    private getSessionWebSocket(sessionId: string): WebSocket | null {
        // Ici, vous devez retourner le vrai WebSocket de la session
        // Pour la démo, on retourne null
        return this.sessionWebSockets.get(sessionId) || null;
    }

    // Recréer les sessions pour le replay
    private async recreateSessions(recording: TNRRecording): Promise<Session[]> {
        const sessions: Session[] = [];

        for (const [id, session] of recording.sessions) {
            // Ici, vous devez créer réellement les sessions avec votre API
            // Pour la démo, on retourne les sessions telles quelles
            sessions.push(session);
        }

        return sessions;
    }

    // Exécuter un événement
    private async executeEvent(event: any, sessions: Session[]): Promise<void> {
        const session = sessions.find(s => s.id === event.sessionId);
        if (!session) return;

        // Ici, vous devez exécuter réellement l'événement sur la session
        // Par exemple, appeler les méthodes OCPP appropriées

        switch (event.action) {
            case 'BootNotification':
                // await ocppService.bootNotification(session.id);
                break;

            case 'Authorize':
                // await ocppService.authorize(session.id, event.payload.idTag);
                break;

            case 'StartTransaction':
                // await ocppService.startTransaction(session.id, event.payload);
                break;

            case 'StopTransaction':
                // await ocppService.stopTransaction(session.id);
                break;
        }
    }

    // Attacher des listeners temporaires pour le replay
    private attachTemporaryListeners(
        sessions: Session[],
        scpBuffer: SCPMessage[],
        txpBuffer: TXPMessage[],
        txdpBuffer: TXDPMessage[]
    ): Map<string, Function> {
        const listeners = new Map<string, Function>();

        // Implémenter l'attachement des listeners temporaires
        // qui capturent dans les buffers fournis

        return listeners;
    }

    // Détacher les listeners temporaires
    private detachTemporaryListeners(listeners: Map<string, Function>): void {
        // Implémenter le détachement
    }

    // Utilitaires
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Persistance
    private saveRecordings(): void {
        try {
            const data = Array.from(this.recordings.entries()).map(([id, recording]) => ({
                id,
                ...recording,
                sessions: Array.from(recording.sessions.entries())
            }));
            localStorage.setItem('tnr_evse_recordings', JSON.stringify(data));
        } catch (error) {
            console.error('Erreur sauvegarde recordings TNR:', error);
        }
    }

    private loadRecordings(): void {
        try {
            const data = localStorage.getItem('tnr_evse_recordings');
            if (data) {
                const parsed = JSON.parse(data);
                for (const item of parsed) {
                    const recording = {
                        ...item,
                        sessions: new Map(item.sessions)
                    };
                    // Casting pour satisfaire le type Map<string, Session>
                    (recording as any).sessions = new Map(item.sessions);
                    this.recordings.set((recording as any).id, recording as any);
                }
            }
        } catch (error) {
            console.error('Erreur chargement recordings TNR:', error);
        }
    }

    // Getters
    getRecordings(): TNRRecording[] {
        return Array.from(this.recordings.values());
    }

    getRecording(id: string): TNRRecording | undefined {
        return this.recordings.get(id);
    }

    deleteRecording(id: string): boolean {
        const deleted = this.recordings.delete(id);
        if (deleted) {
            this.saveRecordings();
        }
        return deleted;
    }

    isCurrentlyRecording(): boolean {
        return this.isRecording;
    }

    isCurrentlyReplaying(): boolean {
        return this.isReplaying;
    }

    getCurrentRecording(): TNRRecording | null {
        return this.activeRecording;
    }
}

// Export singleton
export const tnrEVSEService = new TNREVSEService();
export default tnrEVSEService;
