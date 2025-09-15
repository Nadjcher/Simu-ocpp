// frontend/src/store/useAppStore.ts
import { create } from 'zustand';
import { api } from '@/services/api';

export interface Session {
    id: string;
    title: string;
    chargePointId: string;
    ocppUrl: string;
    idTag?: string;
    connectorId: number;
    state: string;
    connected: boolean;
    authorized: boolean;
    charging: boolean;
    transactionId?: string;
    soc: number;
    targetSoc: number;
    batteryCapacity: number;
    activePower: number;
    offeredPower: number;
    sessionEnergy: number;
    sessionDuration: number;
    physicalLimit: number;
    scpLimit: number;
    fuzzyEnabled: boolean;
    fuzzyVariation: number;
    vehicleProfile?: any;
    startTime?: string;
}

export interface OCPPMessage {
    sessionId: string;
    direction: 'SENT' | 'RECEIVED';
    action: string;
    payload: any;
    timestamp: string;
}

export interface PerformanceMetrics {
    activeSessions: number;
    totalSessions: number;
    cpuUsage: number;
    memoryUsage: number;
    messagesPerSecond: number;
    totalMessages: number;
    errors: number;
    averageLatency: number;
    throughput: number;
    timestamp: string;
}

interface AppState {
    sessions: Session[];
    ocppMessages: OCPPMessage[];
    performanceMetrics: PerformanceMetrics | null;
    selectedSessionId: string | null;
}

interface AppActions {
    loadSessions: () => Promise<void>;
    createSession: (title: string) => Promise<void>;
    updateSession: (id: string, updates: Partial<Session>) => Promise<void>;
    deleteSession: (id: string) => Promise<void>;
    selectSession: (id: string | null) => void;
    addOCPPMessage: (message: OCPPMessage) => void;
    setPerformanceMetrics: (metrics: PerformanceMetrics) => void;
}

export const useAppStore = create<AppState & AppActions>((set) => ({
    sessions: [],
    ocppMessages: [],
    performanceMetrics: null,
    selectedSessionId: null,

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
            set((state) => ({ sessions: [...state.sessions, session] }));
        } catch (error) {
            console.error('Failed to create session:', error);
        }
    },

    updateSession: async (id: string, updates: Partial<Session>) => {
        try {
            const updated = await api.updateSession(id, updates);
            set((state) => ({
                sessions: state.sessions.map((s) => (s.id === id ? updated : s)),
            }));
        } catch (error) {
            console.error('Failed to update session:', error);
        }
    },

    deleteSession: async (id: string) => {
        try {
            await api.deleteSession(id);
            set((state) => ({
                sessions: state.sessions.filter((s) => s.id !== id),
            }));
        } catch (error) {
            console.error('Failed to delete session:', error);
        }
    },

    selectSession: (id: string | null) => {
        set({ selectedSessionId: id });
    },

    addOCPPMessage: (message: OCPPMessage) => {
        set((state) => ({
            ocppMessages: [...state.ocppMessages.slice(-99), message],
        }));
    },

    setPerformanceMetrics: (metrics: PerformanceMetrics) => {
        set({ performanceMetrics: metrics });
    },
}));