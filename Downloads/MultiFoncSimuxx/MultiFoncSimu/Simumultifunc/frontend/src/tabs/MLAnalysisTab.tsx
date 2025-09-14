// frontend/src/tabs/MLAnalysisTab.tsx
import React, { useEffect, useState, useRef, useMemo } from "react";

/* ========================================================================== */
/* Types et interfaces                                                        */
/* ========================================================================== */

type AnomalyType =
    | "UNCONTROLLABLE_EVSE"
    | "UNDERPERFORMING"
    | "REGULATION_OSCILLATION"
    | "PHASE_IMBALANCE"
    | "ENERGY_DRIFT"
    | "SETPOINT_VIOLATION"
    | "STATISTICAL_OUTLIER";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface AnomalyResult {
    id: string;
    timestamp: string;
    sessionId: string;
    type: AnomalyType;
    severity: Severity;
    score: number;
    description: string;
    recommendation?: string;
    features: Record<string, number>;
}

interface EnergyPrediction {
    sessionId: string;
    currentEnergyKWh: number;
    predictedFinalEnergyKWh: number;
    remainingTimeMinutes: number;
    confidence: number;
    efficiencyTrend: "IMPROVING" | "STABLE" | "DEGRADING";
    influenceFactors: Record<string, number>;
}

interface ChargingFeatures {
    sessionId: string;
    powerEfficiencyMean: number;
    powerEfficiencyStd: number;
    setpointStability: number;
    oscillationFrequency: number;
    phaseImbalanceMean: number;
    phaseImbalanceMax: number;
    energyDrift: number;
    regulationPerformance: number;
}

interface MLModelStatus {
    anomalyModel: {
        trained: boolean;
        accuracy: number;
        lastTraining: string;
        samplesCount: number;
    };
    predictionModel: {
        trained: boolean;
        mse: number;
        r2Score: number;
        lastTraining: string;
    };
}

/* ========================================================================== */
/* Configuration API                                                          */
/* ========================================================================== */

// Utilisation d'une URL par défaut si API_BASE n'est pas disponible
const API_BASE = typeof window !== 'undefined'
    ? window.localStorage.getItem("runner_api") || "http://localhost:8877"
    : "http://localhost:8877";

/* ========================================================================== */
/* Helpers et utilitaires                                                    */
/* ========================================================================== */

const getSeverityColor = (severity: Severity) => {
    const colors = {
        LOW: "bg-blue-100 text-blue-800",
        MEDIUM: "bg-yellow-100 text-yellow-800",
        HIGH: "bg-orange-100 text-orange-800",
        CRITICAL: "bg-red-100 text-red-800"
    };
    return colors[severity];
};

const getAnomalyIcon = (type: AnomalyType) => {
    const icons = {
        UNCONTROLLABLE_EVSE: "⚡",
        UNDERPERFORMING: "📉",
        REGULATION_OSCILLATION: "〰️",
        PHASE_IMBALANCE: "⚖️",
        ENERGY_DRIFT: "📊",
        SETPOINT_VIOLATION: "🎯",
        STATISTICAL_OUTLIER: "🔔"
    };
    return icons[type];
};

const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h}h${m.toString().padStart(2, '0')}`;
};

/* ========================================================================== */
/* Composants UI                                                             */
/* ========================================================================== */

const AnomalyCard: React.FC<{ anomaly: AnomalyResult }> = ({ anomaly }) => (
    <div className={`rounded-lg border-l-4 p-4 ${
        anomaly.severity === 'CRITICAL' ? 'border-red-500 bg-red-50' :
            anomaly.severity === 'HIGH' ? 'border-orange-500 bg-orange-50' :
                anomaly.severity === 'MEDIUM' ? 'border-yellow-500 bg-yellow-50' :
                    'border-blue-500 bg-blue-50'
    }`}>
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <span className="text-2xl">{getAnomalyIcon(anomaly.type)}</span>
                <div>
                    <h4 className="font-semibold text-gray-900">{anomaly.type.replace(/_/g, ' ')}</h4>
                    <p className="text-sm text-gray-600">Session: {anomaly.sessionId}</p>
                </div>
            </div>
            <div className="flex flex-col items-end gap-1">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getSeverityColor(anomaly.severity)}`}>
                    {anomaly.severity}
                </span>
                <span className="text-sm font-mono text-gray-700">
                    Score: {anomaly.score.toFixed(3)}
                </span>
            </div>
        </div>

        <p className="text-gray-800 mb-2">{anomaly.description}</p>

        {anomaly.recommendation && (
            <div className="mt-3 p-3 bg-white rounded border">
                <p className="text-sm text-gray-700">
                    <strong>💡 Recommandation:</strong> {anomaly.recommendation}
                </p>
            </div>
        )}

        <div className="mt-3 text-xs text-gray-500">
            {new Date(anomaly.timestamp).toLocaleString()}
        </div>
    </div>
);

const PredictionCard: React.FC<{ prediction: EnergyPrediction }> = ({ prediction }) => (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Prédiction énergétique</h3>
            <span className="text-sm text-gray-600">Session: {prediction.sessionId}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                    {prediction.currentEnergyKWh.toFixed(2)} kWh
                </div>
                <div className="text-sm text-gray-600">Actuelle</div>
            </div>
            <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                    {prediction.predictedFinalEnergyKWh.toFixed(2)} kWh
                </div>
                <div className="text-sm text-gray-600">Prédite</div>
            </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center">
                <div className="text-lg font-semibold text-orange-600">
                    {formatDuration(prediction.remainingTimeMinutes)}
                </div>
                <div className="text-xs text-gray-600">Temps restant</div>
            </div>
            <div className="text-center">
                <div className="text-lg font-semibold text-purple-600">
                    {(prediction.confidence * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-600">Confiance</div>
            </div>
            <div className="text-center">
                <div className={`text-lg font-semibold ${
                    prediction.efficiencyTrend === 'IMPROVING' ? 'text-green-600' :
                        prediction.efficiencyTrend === 'STABLE' ? 'text-blue-600' :
                            'text-red-600'
                }`}>
                    {prediction.efficiencyTrend === 'IMPROVING' ? '📈' :
                        prediction.efficiencyTrend === 'STABLE' ? '➡️' : '📉'}
                </div>
                <div className="text-xs text-gray-600">Tendance</div>
            </div>
        </div>

        {/* Facteurs d'influence */}
        <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Facteurs d'influence:</h4>
            <div className="space-y-1">
                {Object.entries(prediction.influenceFactors).map(([factor, influence]) => (
                    <div key={factor} className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">{factor}</span>
                        <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-blue-600 h-2 rounded-full"
                                    style={{ width: `${Math.abs(influence) * 100}%` }}
                                />
                            </div>
                            <span className="text-xs text-gray-600 font-mono w-12">
                                {(influence * 100).toFixed(0)}%
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

const ModelStatusCard: React.FC<{ status: MLModelStatus }> = ({ status }) => (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">État des modèles ML</h3>

        <div className="space-y-4">
            {/* Modèle de détection d'anomalies */}
            <div className="border-l-4 border-blue-500 pl-4">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-800">Détection d'anomalies</h4>
                    <span className={`px-2 py-1 rounded text-xs ${
                        status.anomalyModel.trained ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                        {status.anomalyModel.trained ? 'Entraîné' : 'Non entraîné'}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                        <span className="text-gray-600">Précision: </span>
                        <span className="font-medium">{(status.anomalyModel.accuracy * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                        <span className="text-gray-600">Échantillons: </span>
                        <span className="font-medium">{status.anomalyModel.samplesCount}</span>
                    </div>
                    <div>
                        <span className="text-gray-600">MAJ: </span>
                        <span className="font-medium">
                            {status.anomalyModel.lastTraining ?
                                new Date(status.anomalyModel.lastTraining).toLocaleDateString() :
                                'Jamais'
                            }
                        </span>
                    </div>
                </div>
            </div>

            {/* Modèle de prédiction */}
            <div className="border-l-4 border-green-500 pl-4">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-800">Prédiction énergétique</h4>
                    <span className={`px-2 py-1 rounded text-xs ${
                        status.predictionModel.trained ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                        {status.predictionModel.trained ? 'Entraîné' : 'Non entraîné'}
                    </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                        <span className="text-gray-600">R² Score: </span>
                        <span className="font-medium">{status.predictionModel.r2Score.toFixed(3)}</span>
                    </div>
                    <div>
                        <span className="text-gray-600">MSE: </span>
                        <span className="font-medium">{status.predictionModel.mse.toFixed(3)}</span>
                    </div>
                    <div>
                        <span className="text-gray-600">MAJ: </span>
                        <span className="font-medium">
                            {status.predictionModel.lastTraining ?
                                new Date(status.predictionModel.lastTraining).toLocaleDateString() :
                                'Jamais'
                            }
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

/* ========================================================================== */
/* Composant principal                                                        */
/* ========================================================================== */

export default function MLAnalysisTab() {
    const [anomalies, setAnomalies] = useState<AnomalyResult[]>([]);
    const [predictions, setPredictions] = useState<EnergyPrediction[]>([]);
    const [modelStatus, setModelStatus] = useState<MLModelStatus | null>(null);
    const [activeSessions, setActiveSessions] = useState<string[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isTraining, setIsTraining] = useState(false);
    const [importStatus, setImportStatus] = useState<string>("");

    // Configuration
    const [autoAnalysis, setAutoAnalysis] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(10); // secondes
    const [anomalyThreshold, setAnomalyThreshold] = useState(0.05);

    const intervalRef = useRef<NodeJS.Timeout>()
    const wsRef = useRef<WebSocket | null>(null);

    /* ======== Fonctions API ======== */

    const fetchAPI = async <T,>(endpoint: string, options?: RequestInit): Promise<T> => {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    };

    const analyzeSession = async (sessionId: string) => {
        return fetchAPI<{
            anomalies: AnomalyResult[];
            prediction: EnergyPrediction;
            features: ChargingFeatures;
        }>(`/api/ml/analyze/${sessionId}`, { method: 'POST' });
    };

    const getModelStatus = async () => {
        return fetchAPI<MLModelStatus>('/api/ml/status');
    };

    const getActiveSessions = async () => {
        const sessions = await fetchAPI<Array<{id: string, status: string}>>('/api/simu');
        return sessions.filter(s => s.status === 'started' || s.status === 'charging').map(s => s.id);
    };

    const trainModels = async () => {
        return fetchAPI('/api/ml/train', { method: 'POST' });
    };

    const importERRData = async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE}/api/ml/import-err`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error(`Import failed: ${response.status}`);
        return response.json();
    };

    const updateThreshold = async () => {
        return fetchAPI('/api/ml/threshold', {
            method: 'POST',
            body: JSON.stringify({ anomaly: anomalyThreshold })
        });
    };

    /* ======== Logique d'analyse ======== */

    const performAnalysis = async () => {
        if (isAnalyzing) return;

        setIsAnalyzing(true);
        try {
            const sessions = await getActiveSessions();
            setActiveSessions(sessions);

            if (sessions.length === 0) {
                setIsAnalyzing(false);
                return;
            }

            const results = await Promise.allSettled(
                sessions.map(sessionId => analyzeSession(sessionId))
            );

            const newAnomalies: AnomalyResult[] = [];
            const newPredictions: EnergyPrediction[] = [];

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    newAnomalies.push(...result.value.anomalies);
                    newPredictions.push(result.value.prediction);
                } else {
                    console.error(`Analysis failed for session ${sessions[index]}:`, result.reason);
                }
            });

            // Mise à jour des états (garder les 50 dernières anomalies)
            setAnomalies(prev => [...newAnomalies, ...prev].slice(0, 50));
            setPredictions(newPredictions);

            // Notifications pour anomalies critiques
            newAnomalies
                .filter(a => a.severity === 'CRITICAL')
                .forEach(anomaly => {
                    console.warn(`🚨 Anomalie critique détectée:`, anomaly);
                    // Ici on pourrait ajouter des notifications toast
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification('Anomalie Critique Détectée', {
                            body: `${anomaly.type}: ${anomaly.description}`,
                            icon: '🚨'
                        });
                    }
                });

        } catch (error) {
            console.error('Erreur lors de l\'analyse ML:', error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    /* ======== Effects ======== */

    useEffect(() => {
        // Charger le statut des modèles au montage
        getModelStatus()
            .then(setModelStatus)
            .catch(error => console.error('Erreur chargement status ML:', error));

        // Demander permission pour notifications
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // Délai pour laisser le serveur démarrer complètement
        const connectWebSocket = () => {
            try {
                const ws = new WebSocket('ws://localhost:8877');
                wsRef.current = ws;

                ws.onopen = () => {
                    console.log('✅ Connected to ML WebSocket');
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.type === 'CONNECTION') {
                            console.log('WebSocket handshake:', data.message);
                        } else if (data.type === 'ML_ANOMALY') {
                            console.log('🔔 Nouvelle anomalie reçue:', data.data);

                            // Ajouter l'anomalie à la liste
                            setAnomalies(prev => [data.data, ...prev].slice(0, 50));

                            // Notification si critique
                            if ((data.data.severity === 'CRITICAL' || data.data.severity === 'HIGH') &&
                                'Notification' in window &&
                                Notification.permission === 'granted') {
                                new Notification('🚨 Anomalie Détectée', {
                                    body: `${data.data.type}: ${data.data.description}`,
                                    icon: '🚨'
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Erreur parsing WebSocket message:', error);
                    }
                };

                ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                    // Réessayer la connexion après 5 secondes
                    setTimeout(connectWebSocket, 5000);
                };

                ws.onclose = () => {
                    console.log('🔌 WebSocket disconnected');
                    // Réessayer la connexion après 3 secondes
                    setTimeout(connectWebSocket, 3000);
                };
            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                // Réessayer après 5 secondes
                setTimeout(connectWebSocket, 5000);
            }
        };

        // Attendre 1 seconde avant de se connecter (laisser le serveur démarrer)
        const timeoutId = setTimeout(connectWebSocket, 1000);

        // Cleanup
        return () => {
            clearTimeout(timeoutId);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (autoAnalysis && analysisInterval > 0) {
            intervalRef.current = setInterval(performAnalysis, analysisInterval * 1000);
            // Première analyse immédiate
            performAnalysis();
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [autoAnalysis, analysisInterval]);

    /* ======== Handlers ======== */

    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setImportStatus("Import en cours...");
        try {
            const result = await importERRData(file);
            setImportStatus(`✅ Import réussi: ${result.imported} échantillons`);

            // Relancer l'entraînement automatiquement
            if (result.imported > 0) {
                await trainModels();
                // Recharger le statut
                const status = await getModelStatus();
                setModelStatus(status);
            }
        } catch (error) {
            console.error('Erreur import ERR:', error);
            setImportStatus(`❌ Erreur: ${error}`);
        }
    };

    const handleTrainModels = async () => {
        setIsTraining(true);
        try {
            await trainModels();
            const status = await getModelStatus();
            setModelStatus(status);
            setImportStatus("✅ Entraînement terminé avec succès!");
        } catch (error) {
            console.error('Erreur entraînement:', error);
            setImportStatus(`❌ Erreur entraînement: ${error}`);
        } finally {
            setIsTraining(false);
        }
    };

    const handleThresholdChange = async (value: number) => {
        setAnomalyThreshold(value);
        try {
            await updateThreshold();
        } catch (error) {
            console.error('Erreur mise à jour seuil:', error);
        }
    };

    /* ======== Statistiques dérivées ======== */

    const anomaliesStats = useMemo(() => {
        const stats = {
            total: anomalies.length,
            critical: anomalies.filter(a => a.severity === 'CRITICAL').length,
            high: anomalies.filter(a => a.severity === 'HIGH').length,
            medium: anomalies.filter(a => a.severity === 'MEDIUM').length,
            low: anomalies.filter(a => a.severity === 'LOW').length,
        };
        return stats;
    }, [anomalies]);

    //
    const analyzeERRFile = async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE}/api/ml/analyze-err`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Analyse échouée');

            const results = await response.json();

            // Ajouter les anomalies au state local
            setAnomalies(prev => [...results.anomalies, ...prev].slice(0, 50));

            // Afficher les stats
            setImportStatus(
                `✅ Analyse terminée: ${results.anomalies.length} anomalies détectées, ` +
                `Efficacité moyenne: ${(results.statistics.avgEfficiency * 100).toFixed(1)}%`
            );

            return results;
        } catch (error) {
            console.error('Erreur analyse ERR:', error);
            setImportStatus(`❌ Erreur: ${error}`);
            throw error;
        }
    };

    /* ======== Rendu ======== */

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Analyse ML & Détection d'Anomalies</h1>
                    <p className="text-gray-600">Intelligence artificielle pour optimiser les sessions de charge</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className={`px-3 py-1 rounded-full text-sm ${
                        isAnalyzing ? 'bg-blue-100 text-blue-800 animate-pulse' :
                            activeSessions.length > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                        {isAnalyzing ? '🔄 Analyse en cours...' :
                            activeSessions.length > 0 ? '✅ Prêt' : '⏸️ En attente'}
                    </div>
                    <span className="text-sm text-gray-600">
                        {activeSessions.length} session{activeSessions.length !== 1 ? 's' : ''} active{activeSessions.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {/* Configuration et contrôles */}
            <div className="grid grid-cols-12 gap-6">
                <div className="col-span-8">
                    <div className="rounded-lg border bg-white p-4 shadow-sm">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Configuration</h2>

                        <div className="grid grid-cols-4 gap-4">
                            <div>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={autoAnalysis}
                                        onChange={e => setAutoAnalysis(e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm">Analyse automatique</span>
                                </label>
                            </div>

                            <div>
                                <label className="text-sm text-gray-600 block mb-1">Intervalle (s)</label>
                                <input
                                    type="number"
                                    min="5"
                                    max="300"
                                    value={analysisInterval}
                                    onChange={e => setAnalysisInterval(Number(e.target.value))}
                                    className="w-full border rounded px-2 py-1"
                                />
                            </div>

                            <div>
                                <label className="text-sm text-gray-600 block mb-1">Seuil anomalie</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    min="0.001"
                                    max="0.1"
                                    value={anomalyThreshold}
                                    onChange={e => handleThresholdChange(Number(e.target.value))}
                                    className="w-full border rounded px-2 py-1"
                                />
                            </div>

                            <div className="flex items-end">
                                <button
                                    onClick={performAnalysis}
                                    disabled={isAnalyzing || activeSessions.length === 0}
                                    className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    Analyser maintenant
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-span-4">
                    <div className="rounded-lg border bg-white p-4 shadow-sm">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>

                        <div className="space-y-3">
                            <div>
                                <label className="text-sm text-gray-600 block mb-1">Import données ERR</label>
                                <input
                                    type="file"
                                    accept=".csv,.json"
                                    onChange={handleFileImport}
                                    className="w-full border rounded px-2 py-1 text-sm"
                                />
                            </div>

                            <button
                                onClick={handleTrainModels}
                                disabled={isTraining}
                                className="w-full px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isTraining ? '⏳ Entraînement...' : '🧠 Entraîner les modèles'}
                            </button>

                            {importStatus && (
                                <div className="text-sm p-2 bg-gray-50 rounded">
                                    {importStatus}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Statistiques rapides */}
            <div className="grid grid-cols-5 gap-4">
                <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-gray-900">{anomaliesStats.total}</div>
                    <div className="text-sm text-gray-600">Total anomalies</div>
                </div>
                <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-red-600">{anomaliesStats.critical}</div>
                    <div className="text-sm text-gray-600">Critiques</div>
                </div>
                <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-orange-600">{anomaliesStats.high}</div>
                    <div className="text-sm text-gray-600">Élevées</div>
                </div>
                <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-yellow-600">{anomaliesStats.medium}</div>
                    <div className="text-sm text-gray-600">Moyennes</div>
                </div>
                <div className="rounded-lg border bg-white p-4 shadow-sm text-center">
                    <div className="text-2xl font-bold text-blue-600">{anomaliesStats.low}</div>
                    <div className="text-sm text-gray-600">Faibles</div>
                </div>
            </div>

            {/* Contenu principal */}
            <div className="grid grid-cols-12 gap-6">
                {/* Statut des modèles */}
                <div className="col-span-4">
                    {modelStatus ? (
                        <ModelStatusCard status={modelStatus} />
                    ) : (
                        <div className="rounded-lg border bg-white p-4 shadow-sm">
                            <div className="animate-pulse">
                                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                                <div className="h-8 bg-gray-200 rounded"></div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Prédictions énergétiques */}
                <div className="col-span-8">
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-gray-900">Prédictions énergétiques</h2>
                        {predictions.length > 0 ? (
                            predictions.map(prediction => (
                                <PredictionCard key={prediction.sessionId} prediction={prediction} />
                            ))
                        ) : (
                            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                                <p className="text-gray-500">Aucune prédiction disponible</p>
                                <p className="text-sm text-gray-400 mt-2">Lancez une session de charge pour voir les prédictions</p>
                                <p className="text-xs text-gray-400 mt-4">
                                    Astuce: Allez dans l'onglet "Simu EVSE" pour démarrer une session
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Anomalies détectées */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Anomalies détectées</h2>
                    {anomalies.length > 0 && (
                        <button
                            onClick={() => setAnomalies([])}
                            className="text-sm text-gray-500 hover:text-gray-700"
                        >
                            Effacer tout
                        </button>
                    )}
                </div>

                <div className="space-y-4">
                    {anomalies.length > 0 ? (
                        anomalies.map(anomaly => (
                            <AnomalyCard key={anomaly.id} anomaly={anomaly} />
                        ))
                    ) : (
                        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
                            <p className="text-gray-500">Aucune anomalie détectée</p>
                            <p className="text-sm text-gray-400 mt-2">C'est une bonne nouvelle! 🎉</p>
                            <p className="text-xs text-gray-400 mt-4">
                                Le système surveille en continu les sessions actives
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}