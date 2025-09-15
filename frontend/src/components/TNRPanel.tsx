// frontend/src/components/TNRPanel.tsx
import React, { useState, useEffect } from 'react';
import { useTNRStore } from '@/store/tnrStore';
import { tnr } from '@/lib/apiBase';

// Types pour les données
interface Scenario {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    folder?: string;
    sessions?: Array<{
        id: string;
        cpId: string;
        idTag?: string;
        title?: string;
        vehicleProfile?: string;
    }>;
    events?: Array<{
        t?: number;
        type?: string;
        action?: string;
        payload?: any;
        latency?: number;
    }>;
    validationRules?: Array<{
        type: string;
        target: string;
        tolerance?: number;
    }>;
    createdAt?: string;
}

interface Execution {
    executionId: string;
    scenarioId: string;
    timestamp?: string;
    startedAt?: string;
    passed?: boolean;
    totalEvents?: number;
    errorCount?: number;
    avgLatency?: number;
    maxLatency?: number;
}

export function TNRPanel() {
    const {
        scenarios,
        isRecording,
        isReplaying,
        recordingEvents,
        startRecording,
        stopRecording,
        loadScenarios
    } = useTNRStore();

    const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
    const [recordingName, setRecordingName] = useState('');
    const [recordingDescription, setRecordingDescription] = useState('');
    const [executions, setExecutions] = useState<Execution[]>([]);

    useEffect(() => {
        void loadScenarios();
        void loadExecutions();
    }, [loadScenarios]);

    const loadExecutions = async () => {
        try {
            const data = await tnr.executions();
            setExecutions(data || []);
        } catch (error) {
            console.error('Failed to load executions:', error);
            setExecutions([]);
        }
    };

    const handleStartRecording = async () => {
        const name = prompt('Nom du scénario:');
        if (name) {
            setRecordingName(name);
            await startRecording(name);
        }
    };

    const handleStopRecording = async () => {
        const description = prompt('Description du scénario:');
        setRecordingDescription(description || '');
        await stopRecording(recordingName, description || '');
        setRecordingName('');
        setRecordingDescription('');
        // Recharger les scénarios après l'enregistrement
        setTimeout(() => {
            void loadScenarios();
        }, 1000);
    };

    const handleReplayScenario = async (scenario: Scenario) => {
        try {
            const result = await tnr.replay(scenario.id);
            console.log('Replay started:', result);
            // Recharger les exécutions après un délai
            setTimeout(() => void loadExecutions(), 5000);
        } catch (error) {
            console.error('Failed to replay scenario:', error);
        }
    };

    const handleExportScenario = async (scenario: Scenario) => {
        try {
            const data = await tnr.get(scenario.id);
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tnr_scenario_${scenario.id}.json`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export scenario:', error);
        }
    };

    const handleImportScenario = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            await tnr.importScenario(formData);
            await loadScenarios();
        } catch (error) {
            console.error('Failed to import scenario:', error);
        }
    };

    const handleDeleteScenario = async (scenarioId: string) => {
        if (confirm('Supprimer ce scénario ?')) {
            try {
                await tnr.remove(scenarioId);
                await loadScenarios();
                setSelectedScenario(null);
            } catch (error) {
                console.error('Failed to delete scenario:', error);
            }
        }
    };

    const handleCancelRecording = async () => {
        try {
            await tnr.cancelRecording();
            setRecordingName('');
            setRecordingDescription('');
            // Forcer le rafraîchissement de l'état du store
            await loadScenarios();
        } catch (error) {
            console.error('Failed to cancel recording:', error);
        }
    };

    return (
        <div className="p-6">
            <div className="mb-6 flex justify-between items-center">
                <h2 className="text-2xl font-bold">Tests Non Régressifs (TNR)</h2>
                <div className="flex space-x-2">
                    {!isRecording ? (
                        <>
                            <button
                                onClick={() => void handleStartRecording()}
                                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                            >
                                🔴 Enregistrer un scénario
                            </button>
                            <label className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 cursor-pointer">
                                📁 Importer
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={(e) => void handleImportScenario(e)}
                                    className="hidden"
                                />
                            </label>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => void handleStopRecording()}
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                            >
                                ⏹️ Arrêter l'enregistrement ({recordingEvents} événements)
                            </button>
                            <button
                                onClick={() => void handleCancelRecording()}
                                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                            >
                                Annuler
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Scénarios enregistrés</h3>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {scenarios.length === 0 ? (
                            <p className="text-gray-400">Aucun scénario enregistré</p>
                        ) : (
                            scenarios.map((scenario: any) => (
                                <div
                                    key={scenario.id}
                                    onClick={() => setSelectedScenario(scenario)}
                                    className={`p-4 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 ${
                                        selectedScenario?.id === scenario.id ? 'ring-2 ring-blue-500' : ''
                                    }`}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className="font-semibold">{scenario.name}</h4>
                                            <p className="text-sm text-gray-400">{scenario.description}</p>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {scenario.sessions?.length || 0} sessions • {scenario.events?.length || 0} événements •
                                                {scenario.createdAt ? new Date(scenario.createdAt).toLocaleString() : 'Date inconnue'}
                                            </div>
                                        </div>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleReplayScenario(scenario as Scenario);
                                                }}
                                                disabled={isReplaying}
                                                className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {isReplaying ? '⏳' : '▶️'}
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleExportScenario(scenario as Scenario);
                                                }}
                                                className="px-3 py-1 bg-gray-600 rounded hover:bg-gray-700"
                                            >
                                                💾
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleDeleteScenario(scenario.id);
                                                }}
                                                className="px-3 py-1 bg-red-600 rounded hover:bg-red-700"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Détails du scénario</h3>
                    {selectedScenario ? (
                        <div className="space-y-4">
                            <div>
                                <h4 className="font-medium mb-2">Sessions impliquées</h4>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {selectedScenario.sessions?.map((session) => (
                                        <div key={session.id} className="text-sm bg-gray-700 p-2 rounded">
                                            {session.title || 'Sans titre'} ({session.cpId}) - {session.vehicleProfile || 'Profil inconnu'}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h4 className="font-medium mb-2">Événements critiques</h4>
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                    {selectedScenario.events?.slice(0, 20).map((event, idx) => (
                                        <div key={idx} className="text-xs bg-gray-700 p-2 rounded">
                                            <div className="flex justify-between">
                                                <span className={`font-semibold ${
                                                    event.type === 'connect' ? 'text-blue-400' :
                                                        event.type === 'disconnect' ? 'text-red-400' :
                                                            event.type === 'authorize' ? 'text-yellow-400' :
                                                                event.type === 'startTransaction' ? 'text-green-400' :
                                                                    event.type === 'stopTransaction' ? 'text-orange-400' :
                                                                        'text-gray-400'
                                                }`}>
                                                    {event.action || event.type}
                                                </span>
                                                <span className="text-gray-500">
                                                    {event.latency ? `${event.latency}ms` : ''}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h4 className="font-medium mb-2">Règles de validation</h4>
                                <div className="space-y-1">
                                    {selectedScenario.validationRules && selectedScenario.validationRules.length > 0 ? (
                                        selectedScenario.validationRules.map((rule, idx) => (
                                            <div key={idx} className="text-sm bg-gray-700 p-2 rounded">
                                                <span className="font-medium">{rule.type}:</span> {rule.target}
                                                {rule.tolerance && <span className="text-gray-400"> (±{rule.tolerance})</span>}
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-gray-400 text-sm">Aucune règle de validation définie</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-400">Sélectionnez un scénario pour voir les détails</p>
                    )}
                </div>
            </div>

            <div className="mt-6 bg-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4">Résultats d'exécution</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {executions.length === 0 ? (
                        <p className="text-gray-400">Aucune exécution disponible</p>
                    ) : (
                        executions.map((execution) => (
                            <div key={execution.executionId} className="bg-gray-700 rounded p-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="font-semibold">
                                            {scenarios.find((s: any) => s.id === execution.scenarioId)?.name || 'Scénario inconnu'}
                                        </h4>
                                        <p className="text-sm text-gray-400">
                                            {execution.timestamp ? new Date(execution.timestamp).toLocaleString() : 'Date inconnue'} •
                                            {execution.totalEvents || 0} événements
                                        </p>
                                    </div>
                                    <span className={`px-3 py-1 rounded text-sm font-medium ${
                                        execution.passed ? 'bg-green-600' : 'bg-red-600'
                                    }`}>
                                        {execution.passed ? '✓ PASSÉ' : '✗ ÉCHOUÉ'}
                                    </span>
                                </div>

                                <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                                    <div className="bg-gray-800 p-2 rounded">
                                        <div className="text-gray-400">Événements</div>
                                        <div className="font-semibold">{execution.totalEvents || 0}</div>
                                    </div>
                                    <div className="bg-gray-800 p-2 rounded">
                                        <div className="text-gray-400">Erreurs</div>
                                        <div className="font-semibold text-red-400">{execution.errorCount || 0}</div>
                                    </div>
                                    <div className="bg-gray-800 p-2 rounded">
                                        <div className="text-gray-400">Latence moy.</div>
                                        <div className="font-semibold">{execution.avgLatency || 0}ms</div>
                                    </div>
                                    <div className="bg-gray-800 p-2 rounded">
                                        <div className="text-gray-400">Latence max</div>
                                        <div className="font-semibold">{execution.maxLatency || 0}ms</div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}