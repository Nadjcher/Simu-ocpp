import React, { useState } from 'react';
import { useTNRStore } from '@/store/tnrStore';
import { useSessionStore } from '@/store/sessionStore';
import {
    Play,
    StopCircle,
    Save,
    Trash2,
    CheckCircle,
    XCircle,
    Clock,
    TestTube
} from 'lucide-react';

export function TNRManager() {
    const scenarios = useTNRStore(state => state.scenarios);
    const isRecording = useTNRStore(state => state.isRecording);
    const recordingSteps = useTNRStore(state => state.recordingSteps);
    const startRecording = useTNRStore(state => state.startRecording);
    const stopRecording = useTNRStore(state => state.stopRecording);
    const replayScenario = useTNRStore(state => state.replayScenario);
    const deleteScenario = useTNRStore(state => state.deleteScenario);

    const sessions = useSessionStore(state => state.sessions);
    const [selectedSessionId, setSelectedSessionId] = useState<string>('');
    const [scenarioName, setScenarioName] = useState('');
    const [scenarioDescription, setScenarioDescription] = useState('');
    const [replayingId, setReplayingId] = useState<string | null>(null);

    const handleStartRecording = () => {
        if (!selectedSessionId) return;
        startRecording(selectedSessionId);
    };

    const handleStopRecording = async () => {
        if (!scenarioName) return;
        await stopRecording(scenarioName, scenarioDescription);
        setScenarioName('');
        setScenarioDescription('');
    };

    const handleReplay = async (scenarioId: string) => {
        setReplayingId(scenarioId);
        try {
            await replayScenario(scenarioId);
        } finally {
            setReplayingId(null);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'COMPLETED':
                return <CheckCircle size={16} className="text-green-400" />;
            case 'FAILED':
                return <XCircle size={16} className="text-red-400" />;
            case 'RUNNING':
                return <Clock size={16} className="text-yellow-400 animate-spin" />;
            default:
                return <TestTube size={16} className="text-gray-400" />;
        }
    };

    return (
        <div className="space-y-6">
            {/* Enregistrement */}
            <div className="card">
                <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <TestTube size={24} />
                    Enregistrement TNR
                </h3>

                {!isRecording ? (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">
                                Session à enregistrer
                            </label>
                            <select
                                value={selectedSessionId}
                                onChange={(e) => setSelectedSessionId(e.target.value)}
                                className="input-field w-full"
                            >
                                <option value="">Sélectionner une session</option>
                                {sessions.map(session => (
                                    <option key={session.id} value={session.id}>
                                        {session.title}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={handleStartRecording}
                            disabled={!selectedSessionId}
                            className="btn-danger flex items-center gap-2"
                        >
                            <Play size={18} />
                            Démarrer l'enregistrement
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-red-900/20 border border-red-600 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-red-400 mb-2">
                                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                                <span className="font-semibold">Enregistrement en cours...</span>
                            </div>
                            <p className="text-sm text-gray-400">
                                {recordingSteps.length} actions enregistrées
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">
                                    Nom du scénario
                                </label>
                                <input
                                    type="text"
                                    value={scenarioName}
                                    onChange={(e) => setScenarioName(e.target.value)}
                                    className="input-field w-full"
                                    placeholder="Ex: Test charge complète"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-400 mb-1">
                                    Description
                                </label>
                                <input
                                    type="text"
                                    value={scenarioDescription}
                                    onChange={(e) => setScenarioDescription(e.target.value)}
                                    className="input-field w-full"
                                    placeholder="Description du test"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleStopRecording}
                            disabled={!scenarioName}
                            className="btn-secondary flex items-center gap-2"
                        >
                            <StopCircle size={18} />
                            Arrêter et sauvegarder
                        </button>
                    </div>
                )}
            </div>

            {/* Liste des scénarios */}
            <div className="card">
                <h3 className="text-xl font-semibold mb-4">
                    Scénarios enregistrés
                </h3>

                {scenarios.length > 0 ? (
                    <div className="space-y-3">
                        {scenarios.map(scenario => (
                            <div
                                key={scenario.id}
                                className="bg-gray-700 rounded-lg p-4 flex items-center justify-between"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        {getStatusIcon(scenario.status)}
                                        <h4 className="font-semibold">{scenario.name}</h4>
                                    </div>
                                    <p className="text-sm text-gray-400 mt-1">
                                        {scenario.description}
                                    </p>
                                    <div className="text-xs text-gray-500 mt-2">
                                        {scenario.steps.length} étapes •
                                        Créé le {new Date(scenario.createdAt).toLocaleDateString()}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleReplay(scenario.id)}
                                        disabled={replayingId === scenario.id}
                                        className="btn-primary flex items-center gap-2"
                                    >
                                        <Play size={16} />
                                        {replayingId === scenario.id ? 'Replay...' : 'Rejouer'}
                                    </button>

                                    <button
                                        onClick={() => deleteScenario(scenario.id)}
                                        className="btn-danger p-2"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-400 text-center py-8">
                        Aucun scénario enregistré
                    </p>
                )}
            </div>
        </div>
    );
}