// frontend/src/hooks/useOCPPWebSocket.ts

import { useState, useCallback, useRef, useEffect } from 'react';

export interface OCPPMessage {
    messageTypeId: number;
    uniqueId: string;
    action?: string;
    payload?: any;
    errorCode?: string;
    errorDescription?: string;
}

export interface OCPPSession {
    id: string;
    cpId: string;
    url: string;
    state: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'AUTHORIZED' | 'CHARGING';
    transactionId?: number;
    idTag?: string;
    meterValue?: number;
    soc?: number;
    startTime?: number;
    stopTime?: number;
    logs: string[];
}

interface UseOCPPWebSocketOptions {
    url: string;
    cpId: string;
    autoReconnect?: boolean;
    reconnectInterval?: number;
    heartbeatInterval?: number;
    onMessage?: (message: OCPPMessage) => void;
    onError?: (error: Event) => void;
    onOpen?: () => void;
    onClose?: () => void;
}

export const useOCPPWebSocket = (options: UseOCPPWebSocketOptions) => {
    const {
        url,
        cpId,
        autoReconnect = true,
        reconnectInterval = 5000,
        heartbeatInterval = 60000,
        onMessage,
        onError,
        onOpen,
        onClose
    } = options;

    const [isConnected, setIsConnected] = useState(false);
    const [connectionState, setConnectionState] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
    const [session, setSession] = useState<OCPPSession>({
        id: Date.now().toString(),
        cpId,
        url,
        state: 'DISCONNECTED',
        logs: []
    });

    const ws = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const messageIdCounter = useRef(1);
    const pendingRequests = useRef<Map<string, { resolve: Function; reject: Function }>>(new Map());
    const meterValuesInterval = useRef<NodeJS.Timeout | null>(null);

    // Logging helper
    const addLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setSession(prev => ({
            ...prev,
            logs: [...prev.logs, `[${timestamp}] ${message}`]
        }));
    }, []);

    // Generate unique message ID
    const generateMessageId = useCallback(() => {
        return `msg-${cpId}-${messageIdCounter.current++}`;
    }, [cpId]);

    // Send OCPP message
    const sendOCPPMessage = useCallback((action: string, payload: any = {}): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const messageId = generateMessageId();
            const message: OCPPMessage = {
                messageTypeId: 2, // CALL
                uniqueId: messageId,
                action,
                payload
            };

            const ocppMessage = [message.messageTypeId, message.uniqueId, message.action, message.payload];

            pendingRequests.current.set(messageId, { resolve, reject });

            ws.current.send(JSON.stringify(ocppMessage));
            addLog(`→ ${action}`);

            // Timeout for response
            setTimeout(() => {
                if (pendingRequests.current.has(messageId)) {
                    pendingRequests.current.delete(messageId);
                    reject(new Error(`Timeout waiting for response to ${action}`));
                }
            }, 30000);
        });
    }, [addLog, generateMessageId]);

    // Handle incoming messages
    const handleMessage = useCallback((event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            const [messageTypeId, uniqueId, ...rest] = data;

            addLog(`← Message Type ${messageTypeId}`);

            switch (messageTypeId) {
                case 2: // CALL
                    const [action, payload] = rest;
                    handleIncomingCall(uniqueId, action, payload);
                    break;

                case 3: // CALLRESULT
                    const [resultPayload] = rest;
                    handleCallResult(uniqueId, resultPayload);
                    break;

                case 4: // CALLERROR
                    const [errorCode, errorDescription, errorDetails] = rest;
                    handleCallError(uniqueId, errorCode, errorDescription);
                    break;
            }

            if (onMessage) {
                onMessage({ messageTypeId, uniqueId, action: rest[0], payload: rest[1] });
            }
        } catch (error) {
            console.error('Failed to parse OCPP message:', error);
        }
    }, [addLog, onMessage]);

    // Handle incoming CALL messages
    const handleIncomingCall = useCallback((messageId: string, action: string, payload: any) => {
        addLog(`← ${action}`);

        // Respond to server requests
        switch (action) {
            case 'RemoteStartTransaction':
                sendCallResult(messageId, { status: 'Accepted' });
                break;

            case 'RemoteStopTransaction':
                sendCallResult(messageId, { status: 'Accepted' });
                break;

            case 'SetChargingProfile':
                sendCallResult(messageId, { status: 'Accepted' });
                break;

            case 'ClearChargingProfile':
                sendCallResult(messageId, { status: 'Accepted' });
                break;

            case 'GetConfiguration':
                sendCallResult(messageId, {
                    configurationKey: [],
                    unknownKey: []
                });
                break;

            case 'ChangeConfiguration':
                sendCallResult(messageId, { status: 'Accepted' });
                break;

            case 'Reset':
                sendCallResult(messageId, { status: 'Accepted' });
                break;

            default:
                sendCallError(messageId, 'NotImplemented', `Action ${action} not implemented`);
        }
    }, [addLog]);

    // Handle CALLRESULT messages
    const handleCallResult = useCallback((messageId: string, payload: any) => {
        const pending = pendingRequests.current.get(messageId);
        if (pending) {
            pending.resolve(payload);
            pendingRequests.current.delete(messageId);
        }
    }, []);

    // Handle CALLERROR messages
    const handleCallError = useCallback((messageId: string, errorCode: string, errorDescription: string) => {
        const pending = pendingRequests.current.get(messageId);
        if (pending) {
            pending.reject(new Error(`${errorCode}: ${errorDescription}`));
            pendingRequests.current.delete(messageId);
        }
    }, []);

    // Send CALLRESULT
    const sendCallResult = useCallback((messageId: string, payload: any) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            const message = [3, messageId, payload];
            ws.current.send(JSON.stringify(message));
            addLog(`→ CallResult for ${messageId}`);
        }
    }, [addLog]);

    // Send CALLERROR
    const sendCallError = useCallback((messageId: string, errorCode: string, errorDescription: string) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            const message = [4, messageId, errorCode, errorDescription, {}];
            ws.current.send(JSON.stringify(message));
            addLog(`→ CallError for ${messageId}: ${errorCode}`);
        }
    }, [addLog]);

    // Connect to WebSocket
    const connect = useCallback(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            return;
        }

        setConnectionState('CONNECTING');
        addLog('Connecting...');

        try {
            const wsUrl = `${url}/${cpId}`;
            ws.current = new WebSocket(wsUrl, ['ocpp1.6']);

            ws.current.onopen = () => {
                setIsConnected(true);
                setConnectionState('CONNECTED');
                setSession(prev => ({ ...prev, state: 'CONNECTED' }));
                addLog('Connected');

                // Send BootNotification
                sendBootNotification();

                // Start heartbeat
                startHeartbeat();

                if (onOpen) onOpen();
            };

            ws.current.onmessage = handleMessage;

            ws.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                addLog('Connection error');
                if (onError) onError(error);
            };

            ws.current.onclose = () => {
                setIsConnected(false);
                setConnectionState('DISCONNECTED');
                setSession(prev => ({ ...prev, state: 'DISCONNECTED' }));
                addLog('Disconnected');

                stopHeartbeat();
                stopMeterValues();

                if (onClose) onClose();

                // Auto-reconnect
                if (autoReconnect && !reconnectTimeoutRef.current) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        reconnectTimeoutRef.current = null;
                        connect();
                    }, reconnectInterval);
                }
            };
        } catch (error) {
            console.error('Failed to connect:', error);
            setConnectionState('DISCONNECTED');
            addLog(`Connection failed: ${error}`);
        }
    }, [url, cpId, autoReconnect, reconnectInterval, addLog, handleMessage, onOpen, onError, onClose]);

    // Disconnect from WebSocket
    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        stopHeartbeat();
        stopMeterValues();

        if (ws.current) {
            ws.current.close();
            ws.current = null;
        }

        setIsConnected(false);
        setConnectionState('DISCONNECTED');
        setSession(prev => ({ ...prev, state: 'DISCONNECTED' }));
        addLog('Disconnected manually');
    }, [addLog]);

    // Start heartbeat
    const startHeartbeat = useCallback(() => {
        stopHeartbeat();
        heartbeatIntervalRef.current = setInterval(() => {
            sendOCPPMessage('Heartbeat', {}).catch(console.error);
        }, heartbeatInterval);
    }, [heartbeatInterval, sendOCPPMessage]);

    // Stop heartbeat
    const stopHeartbeat = useCallback(() => {
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }
    }, []);

    // OCPP Actions
    const sendBootNotification = useCallback(async () => {
        try {
            const response = await sendOCPPMessage('BootNotification', {
                chargePointVendor: 'EVSE Simulator',
                chargePointModel: 'Virtual CP',
                chargePointSerialNumber: cpId,
                chargeBoxSerialNumber: cpId,
                firmwareVersion: '1.0.0',
                iccid: '',
                imsi: '',
                meterType: 'AC',
                meterSerialNumber: `METER-${cpId}`
            });

            addLog(`BootNotification accepted: ${response.status}`);
            return response;
        } catch (error) {
            addLog(`BootNotification failed: ${error}`);
            throw error;
        }
    }, [cpId, sendOCPPMessage, addLog]);

    const authorize = useCallback(async (idTag: string) => {
        try {
            const response = await sendOCPPMessage('Authorize', { idTag });

            if (response.idTagInfo?.status === 'Accepted') {
                setSession(prev => ({
                    ...prev,
                    state: 'AUTHORIZED',
                    idTag
                }));
                addLog(`Authorization accepted for ${idTag}`);
            } else {
                addLog(`Authorization rejected for ${idTag}`);
            }

            return response;
        } catch (error) {
            addLog(`Authorization failed: ${error}`);
            throw error;
        }
    }, [sendOCPPMessage, addLog]);

    const startTransaction = useCallback(async () => {
        if (!session.idTag) {
            throw new Error('No idTag available');
        }

        try {
            const response = await sendOCPPMessage('StartTransaction', {
                connectorId: 1,
                idTag: session.idTag,
                meterStart: session.meterValue || 0,
                timestamp: new Date().toISOString()
            });

            if (response.idTagInfo?.status === 'Accepted' && response.transactionId) {
                setSession(prev => ({
                    ...prev,
                    state: 'CHARGING',
                    transactionId: response.transactionId,
                    startTime: Date.now()
                }));
                addLog(`Transaction started: ${response.transactionId}`);

                // Start sending meter values
                startMeterValues();
            }

            return response;
        } catch (error) {
            addLog(`Start transaction failed: ${error}`);
            throw error;
        }
    }, [session.idTag, session.meterValue, sendOCPPMessage, addLog]);

    const stopTransaction = useCallback(async () => {
        if (!session.transactionId) {
            throw new Error('No active transaction');
        }

        stopMeterValues();

        try {
            const response = await sendOCPPMessage('StopTransaction', {
                transactionId: session.transactionId,
                meterStop: session.meterValue || 0,
                timestamp: new Date().toISOString(),
                reason: 'Local'
            });

            setSession(prev => ({
                ...prev,
                state: 'AUTHORIZED',
                transactionId: undefined,
                stopTime: Date.now()
            }));
            addLog(`Transaction stopped`);

            return response;
        } catch (error) {
            addLog(`Stop transaction failed: ${error}`);
            throw error;
        }
    }, [session.transactionId, session.meterValue, sendOCPPMessage, addLog]);

    const sendMeterValues = useCallback(async () => {
        if (!session.transactionId) {
            return;
        }

        const meterValue = (session.meterValue || 0) + Math.random() * 100;
        const soc = Math.min(100, (session.soc || 20) + Math.random() * 2);

        try {
            await sendOCPPMessage('MeterValues', {
                connectorId: 1,
                transactionId: session.transactionId,
                meterValue: [{
                    timestamp: new Date().toISOString(),
                    sampledValue: [
                        {
                            value: meterValue.toFixed(2),
                            context: 'Sample.Periodic',
                            measurand: 'Energy.Active.Import.Register',
                            unit: 'Wh'
                        },
                        {
                            value: soc.toFixed(1),
                            context: 'Sample.Periodic',
                            measurand: 'SoC',
                            unit: 'Percent'
                        }
                    ]
                }]
            });

            setSession(prev => ({
                ...prev,
                meterValue,
                soc
            }));
        } catch (error) {
            console.error('Failed to send meter values:', error);
        }
    }, [session.transactionId, session.meterValue, session.soc, sendOCPPMessage]);

    const startMeterValues = useCallback(() => {
        stopMeterValues();
        meterValuesInterval.current = setInterval(sendMeterValues, 60000); // Every minute
        sendMeterValues(); // Send immediately
    }, [sendMeterValues]);

    const stopMeterValues = useCallback(() => {
        if (meterValuesInterval.current) {
            clearInterval(meterValuesInterval.current);
            meterValuesInterval.current = null;
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disconnect();
        };
    }, [disconnect]);

    return {
        // Connection state
        isConnected,
        connectionState,
        session,

        // Connection actions
        connect,
        disconnect,

        // OCPP actions
        sendBootNotification,
        authorize,
        startTransaction,
        stopTransaction,
        sendMeterValues,

        // Generic message sending
        sendOCPPMessage,

        // Logs
        logs: session.logs
    };
};