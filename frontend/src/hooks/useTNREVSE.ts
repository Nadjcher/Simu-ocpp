// hooks/useTNREVSE.ts
import { useState, useEffect, useCallback } from 'react';
import tnrEVSEService, { TNRRecording, TNRComparison } from '../services/tnrEVSEService';

export interface TNRStats {
    totalRecordings: number;
    totalEvents: number;
    totalSCP: number;
    totalTXP: number;
    totalTXDP: number;
    lastRecordingDate?: string;
}

export interface TNRHookState {
    // État
    isRecording: boolean;
    isReplaying: boolean;
    recordings: TNRRecording[];
    currentRecording: TNRRecording | null;
    lastComparison: TNRComparison | null;
    stats: TNRStats;
    replayProgress: number;

    // Actions
    startRecording: (name: string, description: string, sessions: any[]) => void;
    stopRecording: () => void;
    replayScenario: (recordingId: string) => Promise<TNRComparison>;
    compareScenarios: (baseId: string, otherId: string) => Promise<TNRComparison>; // ➕
    deleteRecording: (recordingId: string) => void;
    exportRecording: (recordingId: string) => void;
    importRecording: (file: File) => Promise<void>;

    // Capture manuelle
    captureEvent: (sessionId: string, type: string, action: string, payload: any) => void;
    captureSCP: (sessionId: string, data: any) => void;
    captureTXP: (sessionId: string, data: any) => void;
    captureTXDP: (sessionId: string, data: any) => void;
}

export function useTNREVSE(): TNRHookState {
    const [isRecording, setIsRecording] = useState(false);
    const [isReplaying, setIsReplaying] = useState(false);
    const [recordings, setRecordings] = useState<TNRRecording[]>([]);
    const [currentRecording, setCurrentRecording] = useState<TNRRecording | null>(null);
    const [lastComparison, setLastComparison] = useState<TNRComparison | null>(null);
    const [replayProgress, setReplayProgress] = useState(0);

    // Calculer les statistiques
    const stats: TNRStats = {
        totalRecordings: recordings.length,
        totalEvents: recordings.reduce((sum, r) => sum + r.events.length, 0),
        totalSCP: recordings.reduce((sum, r) => sum + r.scpMessages.length, 0),
        totalTXP: recordings.reduce((sum, r) => sum + r.txpMessages.length, 0),
        totalTXDP: recordings.reduce((sum, r) => sum + r.txdpMessages.length, 0),
        lastRecordingDate: recordings.length > 0
            ? new Date(Math.max(...recordings.map(r => r.startTime))).toISOString()
            : undefined
    };

    // Charger les recordings au montage
    useEffect(() => {
        setRecordings(tnrEVSEService.getRecordings());
        setIsRecording(tnrEVSEService.isCurrentlyRecording());
        setIsReplaying(tnrEVSEService.isCurrentlyReplaying());
        setCurrentRecording(tnrEVSEService.getCurrentRecording());
    }, []);

    // Écouter les événements du service
    useEffect(() => {
        const handleRecordingStarted = (data: any) => {
            setIsRecording(true);
            setCurrentRecording(tnrEVSEService.getCurrentRecording());
        };

        const handleRecordingStopped = (data: any) => {
            setIsRecording(false);
            setCurrentRecording(null);
            setRecordings(tnrEVSEService.getRecordings());
        };

        const handleReplayStarted = (data: any) => {
            setIsReplaying(true);
            setReplayProgress(0);
        };

        const handleReplayProgress = (data: any) => {
            setReplayProgress((data.current / data.total) * 100);
        };

        const handleReplayCompleted = (comparison: TNRComparison) => {
            setIsReplaying(false);
            setReplayProgress(100);
            setLastComparison(comparison);
        };

        const handleSCPCaptured = (data: any) => {
            // Mettre à jour l'état si nécessaire
            if (currentRecording) {
                setCurrentRecording(tnrEVSEService.getCurrentRecording());
            }
        };

        const handleScenarioCompared = (comparison: TNRComparison) => {
            setLastComparison(comparison);
        };

        tnrEVSEService.on('recordingStarted', handleRecordingStarted);
        tnrEVSEService.on('recordingStopped', handleRecordingStopped);
        tnrEVSEService.on('replayStarted', handleReplayStarted);
        tnrEVSEService.on('replayProgress', handleReplayProgress);
        tnrEVSEService.on('replayCompleted', handleReplayCompleted);
        tnrEVSEService.on('scpCaptured', handleSCPCaptured);
        tnrEVSEService.on('txpCaptured', handleSCPCaptured);
        tnrEVSEService.on('txdpCaptured', handleSCPCaptured);
        tnrEVSEService.on('scenarioCompared', handleScenarioCompared);

        return () => {
            tnrEVSEService.off('recordingStarted', handleRecordingStarted);
            tnrEVSEService.off('recordingStopped', handleRecordingStopped);
            tnrEVSEService.off('replayStarted', handleReplayStarted);
            tnrEVSEService.off('replayProgress', handleReplayProgress);
            tnrEVSEService.off('replayCompleted', handleReplayCompleted);
            tnrEVSEService.off('scpCaptured', handleSCPCaptured);
            tnrEVSEService.off('txpCaptured', handleSCPCaptured);
            tnrEVSEService.off('txdpCaptured', handleSCPCaptured);
            tnrEVSEService.off('scenarioCompared', handleScenarioCompared);
        };
    }, [currentRecording]);

    // Actions
    const startRecording = useCallback((name: string, description: string, sessions: any[]) => {
        try {
            tnrEVSEService.startRecording(name, description, sessions);
        } catch (error: any) {
            console.error('Erreur démarrage enregistrement:', error);
            alert(error.message);
        }
    }, []);

    const stopRecording = useCallback(() => {
        const recording = tnrEVSEService.stopRecording();
        if (recording) {
            console.log('Enregistrement terminé:', recording.id);
        }
    }, []);

    const replayScenario = useCallback(async (recordingId: string): Promise<TNRComparison> => {
        try {
            const comparison = await tnrEVSEService.replayScenario(recordingId);
            return comparison;
        } catch (error: any) {
            console.error('Erreur replay:', error);
            throw error;
        }
    }, []);

    const compareScenarios = useCallback(async (baseId: string, otherId: string): Promise<TNRComparison> => {
        try {
            const comparison: TNRComparison = (tnrEVSEService as any).compareScenarios(baseId, otherId);
            setLastComparison(comparison);
            return comparison;
        } catch (error: any) {
            console.error('Erreur comparaison scénarios:', error);
            throw error;
        }
    }, []);

    const deleteRecording = useCallback((recordingId: string) => {
        if (confirm('Supprimer cet enregistrement ?')) {
            tnrEVSEService.deleteRecording(recordingId);
            setRecordings(tnrEVSEService.getRecordings());
        }
    }, []);

    const exportRecording = useCallback((recordingId: string) => {
        const recording = tnrEVSEService.getRecording(recordingId);
        if (!recording) return;

        // Convertir la Map en objet pour l'export
        const exportData = {
            ...recording,
            sessions: Array.from(recording.sessions.entries()).map(([id, session]) => ({
                id,
                ...session
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tnr_evse_${recording.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const importRecording = useCallback(async (file: File): Promise<void> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target?.result as string);

                    // Reconstruire la Map des sessions
                    const recording: TNRRecording = {
                        ...data,
                        id: `tnr_evse_${Date.now()}`, // Nouvel ID
                        sessions: new Map(data.sessions.map((s: any) => [s.id, s]))
                    } as any;

                    // Ajouter à la collection
                    (tnrEVSEService as any).recordings.set(recording.id, recording);
                    (tnrEVSEService as any).saveRecordings();

                    setRecordings(tnrEVSEService.getRecordings());
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Erreur lecture fichier'));
            reader.readAsText(file);
        });
    }, []);

    // Capture manuelle
    const captureEvent = useCallback((sessionId: string, type: string, action: string, payload: any) => {
        tnrEVSEService.captureEvent(sessionId, type, action, payload);
    }, []);

    const captureSCP = useCallback((sessionId: string, data: any) => {
        tnrEVSEService.captureSCP(sessionId, data);
    }, []);

    const captureTXP = useCallback((sessionId: string, data: any) => {
        tnrEVSEService.captureTXP(sessionId, data);
    }, []);

    const captureTXDP = useCallback((sessionId: string, data: any) => {
        tnrEVSEService.captureTXDP(sessionId, data);
    }, []);

    return {
        // État
        isRecording,
        isReplaying,
        recordings,
        currentRecording,
        lastComparison,
        stats,
        replayProgress,

        // Actions
        startRecording,
        stopRecording,
        replayScenario,
        compareScenarios,   // ➕
        deleteRecording,
        exportRecording,
        importRecording,

        // Capture
        captureEvent,
        captureSCP,
        captureTXP,
        captureTXDP
    };
}
