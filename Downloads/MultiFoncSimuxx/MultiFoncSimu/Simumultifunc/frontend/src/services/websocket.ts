// frontend/src/services/websocket.ts
import { useAppStore } from '@/store/useAppStore';

class WebSocketService {
    private ws: WebSocket | null = null;
    private reconnectInterval: number = 5000;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private url: string;
    private isIntentionallyClosed: boolean = false;

    constructor(url: string = 'ws://localhost:8080/ws') {
        this.url = url;
    }

    connect(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.isIntentionallyClosed = false;

        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.scheduleReconnect();
        }
    }

    private handleMessage(data: any): void {
        const store = useAppStore.getState();

        switch (data.type) {
            case 'SESSION_UPDATE':
                if (data.data) {
                    store.updateSession(data.data.id, data.data);
                }
                break;

            case 'OCPP_MESSAGE':
                if (data.data) {
                    store.addOCPPMessage({
                        sessionId: data.data.sessionId,
                        direction: data.data.direction,
                        action: data.data.action,
                        payload: data.data.payload,
                        timestamp: data.data.timestamp || new Date().toISOString()
                    });
                }
                break;

            case 'PERFORMANCE_METRICS':
                if (data.data) {
                    store.setPerformanceMetrics(data.data);
                }
                break;

            case 'CHART_UPDATE':
                // À implémenter si nécessaire
                break;

            case 'LOG_ENTRY':
                // À implémenter si nécessaire
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectTimer = setTimeout(() => {
            console.log('Attempting to reconnect WebSocket...');
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectInterval);
    }

    disconnect(): void {
        this.isIntentionallyClosed = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    send(message: any): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket is not connected');
        }
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Instance singleton
let wsService: WebSocketService | null = null;

export function subscribeToWebSocket(): () => void {
    if (!wsService) {
        wsService = new WebSocketService();
    }

    wsService.connect();

    // Retourne une fonction de nettoyage
    return () => {
        if (wsService) {
            wsService.disconnect();
        }
    };
}

export function getWebSocketService(): WebSocketService {
    if (!wsService) {
        wsService = new WebSocketService();
    }
    return wsService;
}