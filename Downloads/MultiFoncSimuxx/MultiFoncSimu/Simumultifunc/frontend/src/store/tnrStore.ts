// frontend/src/store/tnrStore.ts
import { create } from 'zustand';
import { api } from '../services/api';

interface TNRScenario {
    id: string;
    name: string;
    description: string;
    createdAt: Date;
    sessions: any[];
    events: any[];
    validationRules: any[];
}

interface TNRStore {
    scenarios: TNRScenario[];
    isRecording: boolean;
    isReplaying: boolean;
    recordingEvents: number;
    currentRecordingId: string | null;

    loadScenarios: () => Promise<void>;
    startRecording: (name: string) => Promise<void>;
    stopRecording: (name: string, description: string) => Promise<void>;
    cancelRecording: () => Promise<void>;
    replayScenario: (scenarioId: string) => Promise<void>;
    deleteScenario: (scenarioId: string) => Promise<void>;
}

export const useTNRStore = create<TNRStore>((set) => ({
    scenarios: [],
    isRecording: false,
    isReplaying: false,
    recordingEvents: 0,
    currentRecordingId: null,

    loadScenarios: async () => {
        try {
            const scenarios = await api.getTNRScenarios();
            set({ scenarios });
        } catch (error) {
            console.error('Failed to load TNR scenarios:', error);
        }
    },

    startRecording: async (name: string) => {
        try {
            const result = await api.startTNRRecording({ name });
            set({
                isRecording: true,
                recordingEvents: 0,
                currentRecordingId: result.recordingId
            });
        } catch (error) {
            console.error('Failed to start recording:', error);
        }
    },

    stopRecording: async (name: string, description: string) => {
        try {
            const scenario = await api.stopTNRRecording({ name, description });
            set(state => ({
                scenarios: [...state.scenarios, scenario],
                isRecording: false,
                recordingEvents: 0,
                currentRecordingId: null
            }));
        } catch (error) {
            console.error('Failed to stop recording:', error);
        }
    },

    cancelRecording: async () => {
        try {
            await api.cancelTNRRecording();
            set({
                isRecording: false,
                recordingEvents: 0,
                currentRecordingId: null
            });
        } catch (error) {
            console.error('Failed to cancel recording:', error);
        }
    },

    replayScenario: async (scenarioId: string) => {
        try {
            set({ isReplaying: true });
            await api.replayTNRScenario(scenarioId);
            // Le replay continue en arrière-plan
            setTimeout(() => set({ isReplaying: false }), 10000);
        } catch (error) {
            console.error('Failed to replay scenario:', error);
            set({ isReplaying: false });
        }
    },

    deleteScenario: async (scenarioId: string) => {
        try {
            await api.deleteTNRScenario(scenarioId);
            set(state => ({
                scenarios: state.scenarios.filter(s => s.id !== scenarioId)
            }));
        } catch (error) {
            console.error('Failed to delete scenario:', error);
        }
    }
}));