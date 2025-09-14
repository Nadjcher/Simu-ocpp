// frontend/src/store/mlStore.ts
import { create } from 'zustand';

interface MLAnomaly {
    id: string;
    timestamp: string;
    nodeId: string;
    type: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    score: number;
    description: string;
    recommendation?: string;
    features: Record<string, any>;
}

interface MLStore {
    anomalies: MLAnomaly[];
    maxAnomalies: number;
    addAnomaly: (anomaly: MLAnomaly) => void;
    clearAnomalies: () => void;
    getAnomaliesBySeverity: (severity: string) => MLAnomaly[];
}

export const useMLStore = create<MLStore>((set, get) => ({
    anomalies: [],
    maxAnomalies: 100,

    addAnomaly: (anomaly) => set(state => ({
        anomalies: [anomaly, ...state.anomalies].slice(0, state.maxAnomalies)
    })),

    clearAnomalies: () => set({ anomalies: [] }),

    getAnomaliesBySeverity: (severity) => {
        return get().anomalies.filter(a => a.severity === severity);
    }
}));