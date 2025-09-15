// frontend/src/hooks/useWebSocket.ts
import { useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useTNRStore } from '../store/tnrStore';

export function useWebSocket() {
    const { updateSessionFromWebSocket, addLog } = useSessionStore();
    const tnrStore = useTNRStore();

    useEffect(() => {
        // Utiliser le bon port (8081 au lieu de 8080)
        const ws = new WebSocket('ws://localhost:8081/ws');

        ws.onopen = () => {
            console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'SESSION_UPDATE':
                        updateSessionFromWebSocket(data);
                        break;

                    case 'OCPP_MESSAGE':
                        if (data.data) {
                            addLog(data.data.sessionId, {
                                timestamp: new Date(data.data.timestamp),
                                message: `${data.data.direction === 'SENT' ? '→' : '←'} ${data.data.action}`,
                                type: data.data.direction.toLowerCase(),
                                payload: data.data.payload
                            });
                        }
                        break;

                    case 'TNR_EVENT':
                        if (tnrStore.isRecording) {
                            tnrStore.recordingEvents++;
                        }
                        break;

                    case 'PERFORMANCE_METRICS':
                        // Handle performance metrics
                        break;

                    default:
                        console.log('Unknown WebSocket message type:', data.type);
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            // Reconnect after 5 seconds
            setTimeout(() => {
                console.log('Attempting to reconnect WebSocket...');
            }, 5000);
        };

        return () => {
            ws.close();
        };
    }, []);
}