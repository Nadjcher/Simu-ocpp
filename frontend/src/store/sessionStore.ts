// frontend/src/store/sessionStore.ts
import { create } from 'zustand';
import { api } from '../services/api';

interface Session {
    id: string;
    title: string;
    url: string;
    cpId: string;
    state: string;
    vehicleProfile: string;
    chargerType: string;
    maxCurrentA: number;
    soc: number;
    initialSoc: number;
    targetSoc: number;
    currentPowerW: number;
    offeredPowerW: number;
    activePowerW: number;
    meterWh: number;
    transactionId?: number;
    lastIdTag?: string;
    bearerToken?: string;
    fuzzyEnabled: boolean;
    fuzzyIntensity: number;
    includeSoc: boolean;
    includeOffered: boolean;
    includeActive: boolean;
    physicalLimitW?: number;
    appliedLimitW?: number;
    txpLimit?: string;
    txdpLimit?: string;
    logs: LogEntry[];
    socData: ChartData[];
    powerData: ChartData[];
    hidden: boolean;
    startTime?: Date;
    lastMeterValueSent?: Date;
    meterValueCount: number;
}

interface LogEntry {
    timestamp: Date;
    message: string;
    type: string;
    payload?: any;
}

interface ChartData {
    time: number;
    soc?: number;
    offered?: number;
    active?: number;
    setpoint?: number;
}

interface SessionStore {
    sessions: Session[];
    activeSessionId: string | null;

    loadSessions: () => Promise<void>;
    createSession: (title: string) => Promise<void>;
    updateSession: (id: string, updates: Partial<Session>) => Promise<void>;
    deleteSession: (id: string) => Promise<void>;
    setActiveSessionId: (id: string | null) => void;
    addLog: (sessionId: string, log: LogEntry) => void;
    updateSessionFromWebSocket: (update: any) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
    sessions: [],
    activeSessionId: null,

    loadSessions: async () => {
        try {
            const sessions = await api.getSessions();
            set({ sessions });
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    },

    createSession: async (title: string) => {
        try {
            const session = await api.createSession(title);
            set(state => ({
                sessions: [...state.sessions, session],
                activeSessionId: session.id
            }));
        } catch (error) {
            console.error('Failed to create session:', error);
        }
    },

    updateSession: async (id: string, updates: Partial<Session>) => {
        try {
            const updated = await api.updateSession(id, updates);
            set(state => ({
                sessions: state.sessions.map(s => s.id === id ? { ...s, ...updated } : s)
            }));
        } catch (error) {
            console.error('Failed to update session:', error);
        }
    },

    deleteSession: async (id: string) => {
        try {
            await api.deleteSession(id);
            set(state => ({
                sessions: state.sessions.filter(s => s.id !== id),
                activeSessionId: state.activeSessionId === id ? null : state.activeSessionId
            }));
        } catch (error) {
            console.error('Failed to delete session:', error);
        }
    },

    setActiveSessionId: (id: string | null) => {
        set({ activeSessionId: id });
    },

    addLog: (sessionId: string, log: LogEntry) => {
        set(state => ({
            sessions: state.sessions.map(s => {
                if (s.id === sessionId) {
                    const logs = [...s.logs, log].slice(-1000); // Keep last 1000 logs
                    return { ...s, logs };
                }
                return s;
            })
        }));
    },

    updateSessionFromWebSocket: (update: any) => {
        set(state => ({
            sessions: state.sessions.map(s => {
                if (s.id === update.sessionId) {
                    return { ...s, ...update.data };
                }
                return s;
            })
        }));
    }
}));