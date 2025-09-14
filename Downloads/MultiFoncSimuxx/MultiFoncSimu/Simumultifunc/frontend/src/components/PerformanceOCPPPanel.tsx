// components/PerformanceOCPPPanel.tsx

import React, { useState, useRef, useEffect } from 'react';
import {
    Activity,
    Upload,
    PlayCircle,
    StopCircle,
    BarChart3,
    Clock,
    CheckCircle,
    XCircle,
    TrendingUp
} from 'lucide-react';
import { useOCPPWebSocket } from '../hooks/useOCPPWebSocket';

interface PerfSession {
    cpId: string;
    tagId: string;
    capacityKWh: number;
    initialSoc: number;
    maxCurrentA: number;
}

interface PerfResult {
    cpId: string;
    tagId: string;
    wsOk: boolean;
    bootMs: number;
    authMs: number;
    startMs: number;
    stopMs: number;
    requestTime: number;
    logs: string[];
}

interface PerformanceOCPPPanelProps {
    wsBaseUrl: string;
}

export const PerformanceOCPPPanel: React.FC<PerformanceOCPPPanelProps> = ({
                                                                              wsBaseUrl
                                                                          }) => {
    // État
    const [sessions, setSessions] = useState<PerfSession[]>([]);
    const [results, setResults] = useState<Map<string, PerfResult>>(new Map());
    const [isRunning, setIsRunning] = useState(false);
    const [config, setConfig] = useState({
        nbClients: 1,
        delaySeconds: 0,
        batchSize: 10
    });

    // Statistiques
    const [stats, setStats] = useState({
        totalSessions: 0,
        connectedSessions: 0,
        successfulTransactions: 0,
        failedTransactions: 0,
        averageBootTime: 0,
        averageAuthTime: 0,
        averageStartTime: 0,
        averageStopTime: 0
    });

    // Références pour les connexions multiples
    const connectionsRef = useRef<Map<string, ReturnType<typeof useOCPPWebSocket>>>(new Map());
    const schedulerRef = useRef<NodeJS.Timer | null>(null);

    // Données pour le graphique
    const [chartData, setChartData] = useState<Array<{
        time: number;
        connected: number;
        transactions: number;
        throughput: number;
    }>>([]);

    /**
     * Import CSV
     */
    const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            const lines = text.split('\n').filter(line => line.trim());
            const parsedSessions: PerfSession[] = [];

            // Skip header
            for (let i = 1; i < lines.length; i++) {
                const [cpId, tagId, capacity, soc, current] = lines[i].split(',');
                if (cpId && tagId) {
                    parsedSessions.push({
                        cpId: cpId.trim(),
                        tagId: tagId.trim(),
                        capacityKWh: parseFloat(capacity) || 50,
                        initialSoc: parseInt(soc) || 20,
                        maxCurrentA: parseFloat(current) || 32
                    });
                }
            }

            setSessions(parsedSessions);
            addLog(`CSV importé: ${parsedSessions.length} sessions`);
        };
        reader.readAsText(file);
    };

    /**
     * Démarrer les tests de performance
     */
    const startPerformanceTest = async () => {
        if (sessions.length === 0) {
            alert('Veuillez importer un CSV de sessions');
            return;
        }

        setIsRunning(true);
        setResults(new Map());
        setChartData([]);

        const startTime = Date.now();
        let sessionIndex = 0;

        // Fonction pour lancer un batch de connexions
        const launchBatch = () => {
            const batch = sessions.slice(sessionIndex, sessionIndex + config.batchSize);

            batch.forEach(session => {
                launchSession(session, startTime);
            });

            sessionIndex += config.batchSize;

            // Continuer s'il reste des sessions
            if (sessionIndex < sessions.length && sessionIndex < config.nbClients) {
                setTimeout(launchBatch, config.delaySeconds * 1000);
            } else {
                // Toutes les sessions lancées
                addLog(`✓ ${Math.min(sessions.length, config.nbClients)} sessions lancées`);
            }
        };

        // Démarrer le premier batch
        launchBatch();

        // Démarrer le monitoring
        startMonitoring(startTime);
    };

    /**
     * Lancer une session individuelle
     */
    const launchSession = (session: PerfSession, testStartTime: number) => {
        const result: PerfResult = {
            cpId: session.cpId,
            tagId: session.tagId,
            wsOk: false,
            bootMs: 0,
            authMs: 0,
            startMs: 0,
            stopMs: 0,
            requestTime: Date.now(),
            logs: []
        };

        setResults(prev => new Map(prev).set(session.cpId, result));

        // Créer la connexion WebSocket
        const wsHook = useOCPPWebSocket(
            {
                url: wsBaseUrl,
                chargePointId: session.cpId,
                heartbeatInterval: 60000
            },
            // onMessage
            (message) => {
                if (message.type === 3) { // CALLRESULT
                    handleSessionResponse(session.cpId, message);
                }
            },
            // onStatusChange
            (status) => {
                if (status === 'connected') {
                    updateResult(session.cpId, {
                        wsOk: true,
                        bootMs: Date.now() - result.requestTime
                    });

                    // Lancer automatiquement la séquence
                    setTimeout(() => startSessionSequence(session), 1000);
                }
            }
        );

        connectionsRef.current.set(session.cpId, wsHook);
        wsHook.connect();
    };

    /**
     * Séquence automatique pour une session
     */
    const startSessionSequence = async (session: PerfSession) => {
        const wsHook = connectionsRef.current.get(session.cpId);
        if (!wsHook) return;

        try {
            // Authorize
            const authStart = Date.now();
            const authResult = await wsHook.sendCall('Authorize', {
                idTag: session.tagId
            });

            updateResult(session.cpId, {
                authMs: Date.now() - authStart
            });

            if (authResult.idTagInfo?.status === 'Accepted') {
                // StartTransaction
                const startStart = Date.now();
                const startResult = await wsHook.sendCall('StartTransaction', {
                    connectorId: 1,
                    idTag: session.tagId,
                    meterStart: 0,
                    timestamp: new Date().toISOString()
                });

                updateResult(session.cpId, {
                    startMs: Date.now() - startStart
                });

                const transactionId = startResult.transactionId;

                // Attendre un peu puis StopTransaction
                setTimeout(async () => {
                    const stopStart = Date.now();
                    await wsHook.sendCall('StopTransaction', {
                        transactionId: transactionId,
                        meterStop: Math.round(Math.random() * 10000),
                        timestamp: new Date().toISOString()
                    });

                    updateResult(session.cpId, {
                        stopMs: Date.now() - stopStart
                    });
                }, 10000); // 10 secondes de charge
            }
        } catch (error) {
            addLog(`✗ Erreur session ${session.cpId}: ${error}`);
        }
    };

    /**
     * Gérer les réponses d'une session
     */
    const handleSessionResponse = (cpId: string, message: any) => {
        // Mise à jour des résultats selon le type de réponse
        const result = results.get(cpId);
        if (result) {
            result.logs.push(`Response: ${JSON.stringify(message.payload)}`);
            setResults(new Map(results));
        }
    };

    /**
     * Mettre à jour un résultat
     */
    const updateResult = (cpId: string, updates: Partial<PerfResult>) => {
        setResults(prev => {
            const newResults = new Map(prev);
            const existing = newResults.get(cpId);
            if (existing) {
                newResults.set(cpId, { ...existing, ...updates });
            }
            return newResults;
        });
    };

    /**
     * Arrêter tous les tests
     */
    const stopPerformanceTest = () => {
        setIsRunning(false);

        // Déconnecter toutes les sessions
        connectionsRef.current.forEach(wsHook => {
            wsHook.disconnect();
        });
        connectionsRef.current.clear();

        // Arrêter le monitoring
        if (schedulerRef.current) {
            clearInterval(schedulerRef.current);
            schedulerRef.current = null;
        }

        addLog('■ Tests arrêtés');
        calculateFinalStats();
    };

    /**
     * Démarrer le monitoring temps réel
     */
    const startMonitoring = (startTime: number) => {
        schedulerRef.current = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const connected = Array.from(results.values()).filter(r => r.wsOk).length;
            const transactions = Array.from(results.values()).filter(r => r.startMs > 0).length;
            const throughput = transactions / Math.max(elapsed, 1);

            setChartData(prev => [...prev, {
                time: elapsed,
                connected,
                transactions,
                throughput
            }].slice(-60)); // Garder 60 points

            // Mettre à jour les stats
            calculateStats();
        }, 1000);
    };

    /**
     * Calculer les statistiques
     */
    const calculateStats = () => {
        const allResults = Array.from(results.values());
        const connected = allResults.filter(r => r.wsOk);
        const successful = allResults.filter(r => r.startMs > 0);
        const failed = allResults.filter(r => r.wsOk && r.startMs === 0);

        const avgBoot = connected.length > 0
            ? connected.reduce((sum, r) => sum + r.bootMs, 0) / connected.length
            : 0;

        const avgAuth = successful.length > 0
            ? successful.reduce((sum, r) => sum + r.authMs, 0) / successful.length
            : 0;

        const avgStart = successful.length > 0
            ? successful.reduce((sum, r) => sum + r.startMs, 0) / successful.length
            : 0;

        const avgStop = successful.filter(r => r.stopMs > 0).length > 0
            ? successful.filter(r => r.stopMs > 0).reduce((sum, r) => sum + r.stopMs, 0) / successful.filter(r => r.stopMs > 0).length
            : 0;

        setStats({
            totalSessions: allResults.length,
            connectedSessions: connected.length,
            successfulTransactions: successful.length,
            failedTransactions: failed.length,
            averageBootTime: Math.round(avgBoot),
            averageAuthTime: Math.round(avgAuth),
            averageStartTime: Math.round(avgStart),
            averageStopTime: Math.round(avgStop)
        });
    };

    /**
     * Calculer les stats finales
     */
    const calculateFinalStats = () => {
        calculateStats();

        // Export CSV des résultats
        const csvContent = exportResultsToCSV();
        // Créer un lien de téléchargement
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `perf_results_${Date.now()}.csv`;
        a.click();
    };

    /**
     * Exporter les résultats en CSV
     */
    const exportResultsToCSV = (): string => {
        const headers = ['CP-ID', 'Tag-ID', 'WS OK', 'Boot (ms)', 'Auth (ms)', 'Start (ms)', 'Stop (ms)'];
        const rows = Array.from(results.values()).map(r => [
            r.cpId,
            r.tagId,
            r.wsOk ? 'Yes' : 'No',
            r.bootMs.toString(),
            r.authMs.toString(),
            r.startMs.toString(),
            r.stopMs.toString()
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
    };

    const [logs, setLogs] = useState<string[]>([]);
    const addLog = (message: string) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev].slice(0, 100));
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Activity className="text-orange-500" />
                Performance OCPP
            </h2>

            {/* Configuration */}
            <div className="mb-6 p-4 bg-gray-50 rounded">
                <h3 className="font-bold mb-3">Configuration du test</h3>

                <div className="grid grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Import CSV</label>
                        <input
                            type="file"
                            accept=".csv"
                            onChange={handleCSVImport}
                            className="w-full p-2 border rounded"
                            disabled={isRunning}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Nb clients max</label>
                        <input
                            type="number"
                            min="1"
                            max="1000"
                            value={config.nbClients}
                            onChange={(e) => setConfig({ ...config, nbClients: parseInt(e.target.value) })}
                            className="w-full p-2 border rounded"
                            disabled={isRunning}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Délai (s)</label>
                        <input
                            type="number"
                            min="0"
                            max="60"
                            value={config.delaySeconds}
                            onChange={(e) => setConfig({ ...config, delaySeconds: parseInt(e.target.value) })}
                            className="w-full p-2 border rounded"
                            disabled={isRunning}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Batch size</label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={config.batchSize}
                            onChange={(e) => setConfig({ ...config, batchSize: parseInt(e.target.value) })}
                            className="w-full p-2 border rounded"
                            disabled={isRunning}
                        />
                    </div>
                </div>

                <div className="mt-4 flex gap-2">
                    <button
                        onClick={startPerformanceTest}
                        disabled={isRunning || sessions.length === 0}
                        className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 flex items-center gap-2"
                    >
                        <PlayCircle size={20} />
                        Démarrer test
                    </button>

                    <button
                        onClick={stopPerformanceTest}
                        disabled={!isRunning}
                        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 flex items-center gap-2"
                    >
                        <StopCircle size={20} />
                        Arrêter test
                    </button>
                </div>
            </div>

            {/* Statistiques en temps réel */}
            <div className="mb-6 grid grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded">
                    <div className="text-sm text-gray-600">Sessions totales</div>
                    <div className="text-2xl font-bold">{stats.totalSessions}</div>
                </div>

                <div className="p-4 bg-green-50 rounded">
                    <div className="text-sm text-gray-600">Connectées</div>
                    <div className="text-2xl font-bold text-green-600">{stats.connectedSessions}</div>
                </div>

                <div className="p-4 bg-yellow-50 rounded">
                    <div className="text-sm text-gray-600">Transactions OK</div>
                    <div className="text-2xl font-bold text-yellow-600">{stats.successfulTransactions}</div>
                </div>

                <div className="p-4 bg-red-50 rounded">
                    <div className="text-sm text-gray-600">Échecs</div>
                    <div className="text-2xl font-bold text-red-600">{stats.failedTransactions}</div>
                </div>
            </div>

            {/* Temps de réponse moyens */}
            <div className="mb-6 p-4 bg-gray-50 rounded">
                <h3 className="font-bold mb-3 flex items-center gap-2">
                    <Clock />
                    Latences moyennes
                </h3>

                <div className="grid grid-cols-4 gap-4">
                    <div>
                        <div className="text-sm text-gray-600">Boot</div>
                        <div className="text-xl font-bold">{stats.averageBootTime} ms</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-600">Authorize</div>
                        <div className="text-xl font-bold">{stats.averageAuthTime} ms</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-600">Start</div>
                        <div className="text-xl font-bold">{stats.averageStartTime} ms</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-600">Stop</div>
                        <div className="text-xl font-bold">{stats.averageStopTime} ms</div>
                    </div>
                </div>
            </div>

            {/* Graphique de progression */}
            {chartData.length > 0 && (
                <div className="mb-6 p-4 bg-gray-50 rounded">
                    <h3 className="font-bold mb-3 flex items-center gap-2">
                        <TrendingUp />
                        Progression du test
                    </h3>

                    <div className="h-64 flex items-center justify-center text-gray-500">
                        {/* Intégrer Recharts ici */}
                        <div>
                            <BarChart3 size={48} className="mx-auto mb-2" />
                            <div>Graphique temps réel</div>
                            <div className="text-sm">
                                Connectés: {chartData[chartData.length - 1]?.connected || 0} |
                                Transactions: {chartData[chartData.length - 1]?.transactions || 0}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Table des résultats */}
            <div className="mb-6">
                <h3 className="font-bold mb-3">Résultats détaillés</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                        <tr className="bg-gray-100">
                            <th className="border p-2 text-left">CP-ID</th>
                            <th className="border p-2 text-center">WS</th>
                            <th className="border p-2 text-right">Boot (ms)</th>
                            <th className="border p-2 text-right">Auth (ms)</th>
                            <th className="border p-2 text-right">Start (ms)</th>
                            <th className="border p-2 text-right">Stop (ms)</th>
                        </tr>
                        </thead>
                        <tbody>
                        {Array.from(results.values()).slice(0, 10).map(result => (
                            <tr key={result.cpId}>
                                <td className="border p-2">{result.cpId}</td>
                                <td className="border p-2 text-center">
                                    {result.wsOk ? (
                                        <CheckCircle size={16} className="text-green-500 inline" />
                                    ) : (
                                        <XCircle size={16} className="text-red-500 inline" />
                                    )}
                                </td>
                                <td className="border p-2 text-right">{result.bootMs || '-'}</td>
                                <td className="border p-2 text-right">{result.authMs || '-'}</td>
                                <td className="border p-2 text-right">{result.startMs || '-'}</td>
                                <td className="border p-2 text-right">{result.stopMs || '-'}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                    {results.size > 10 && (
                        <div className="text-center text-sm text-gray-500 mt-2">
                            ... et {results.size - 10} autres
                        </div>
                    )}
                </div>
            </div>

            {/* Logs */}
            <div className="p-4 bg-gray-900 rounded">
                <h3 className="font-bold mb-3 text-white">Logs</h3>
                <div className="h-32 overflow-y-auto font-mono text-xs text-green-400">
                    {logs.map((log, index) => (
                        <div key={index}>{log}</div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ================================================
// components/SessionOverview.tsx
// ================================================


import {
    Eye,
    Plus,
    Filter,
    Download,
    RefreshCw,
    Zap,
    Battery
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SessionData {
    id: string;
    name: string;
    status: 'Available' | 'Preparing' | 'Charging' | 'Finishing' | 'Unavailable';
    connectorId: number;
    soc: number;
    meterWh: number;
    offeredW: number;
    activeW: number;
    transactionId?: number;
    startTime?: Date;
    tagId?: string;
}

interface SessionOverviewProps {
    sessions: SessionData[];
    onAddSession: () => void;
    onSelectSession: (sessionId: string) => void;
}

export const SessionOverview: React.FC<SessionOverviewProps> = ({
                                                                    sessions,
                                                                    onAddSession,
                                                                    onSelectSession
                                                                }) => {
    const [filter, setFilter] = useState<string>('all');
    const [selectedMetric, setSelectedMetric] = useState<'soc' | 'power' | 'energy'>('power');
    const [chartData, setChartData] = useState<any[]>([]);
    const [aggregateStats, setAggregateStats] = useState({
        totalSessions: 0,
        activeSessions: 0,
        totalPowerKW: 0,
        averageSoC: 0,
        totalEnergyKWh: 0
    });

    // Filtrer les sessions
    const filteredSessions = sessions.filter(session => {
        if (filter === 'all') return true;
        if (filter === 'charging') return session.status === 'Charging';
        if (filter === 'available') return session.status === 'Available';
        return true;
    });

    // Calculer les statistiques agrégées
    useEffect(() => {
        const active = sessions.filter(s => s.status === 'Charging');
        const totalPower = active.reduce((sum, s) => sum + s.activeW, 0) / 1000;
        const avgSoC = active.length > 0
            ? active.reduce((sum, s) => sum + s.soc, 0) / active.length
            : 0;
        const totalEnergy = sessions.reduce((sum, s) => sum + s.meterWh, 0) / 1000;

        setAggregateStats({
            totalSessions: sessions.length,
            activeSessions: active.length,
            totalPowerKW: totalPower,
            averageSoC: avgSoC,
            totalEnergyKWh: totalEnergy
        });
    }, [sessions]);

    // Mettre à jour les données du graphique
    useEffect(() => {
        const interval = setInterval(() => {
            const newDataPoint: any = { time: new Date().toLocaleTimeString() };

            filteredSessions.forEach(session => {
                if (selectedMetric === 'soc') {
                    newDataPoint[session.name] = session.soc;
                } else if (selectedMetric === 'power') {
                    newDataPoint[session.name] = session.activeW / 1000;
                } else {
                    newDataPoint[session.name] = session.meterWh / 1000;
                }
            });

            setChartData(prev => [...prev.slice(-29), newDataPoint]);
        }, 2000);

        return () => clearInterval(interval);
    }, [filteredSessions, selectedMetric]);

    // Exporter les données
    const exportData = () => {
        const csv = [
            ['Session', 'Status', 'SoC (%)', 'Power (kW)', 'Energy (kWh)'],
            ...sessions.map(s => [
                s.name,
                s.status,
                s.soc.toFixed(1),
                (s.activeW / 1000).toFixed(2),
                (s.meterWh / 1000).toFixed(2)
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sessions_${Date.now()}.csv`;
        a.click();
    };

    // Couleur selon le statut
    const getStatusColor = (status: SessionData['status']) => {
        switch (status) {
            case 'Available': return 'bg-green-500';
            case 'Charging': return 'bg-blue-500';
            case 'Preparing': return 'bg-yellow-500';
            case 'Finishing': return 'bg-orange-500';
            case 'Unavailable': return 'bg-gray-500';
            default: return 'bg-gray-400';
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Eye className="text-blue-500" />
                    Vue d'ensemble des sessions
                </h2>

                <div className="flex gap-2">
                    <button
                        onClick={onAddSession}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
                    >
                        <Plus size={20} />
                        Nouvelle session
                    </button>

                    <button
                        onClick={exportData}
                        className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center gap-2"
                    >
                        <Download size={20} />
                        Exporter
                    </button>
                </div>
            </div>

            {/* Statistiques globales */}
            <div className="grid grid-cols-5 gap-4 mb-6">
                <div className="p-4 bg-blue-50 rounded">
                    <div className="text-sm text-gray-600">Sessions totales</div>
                    <div className="text-2xl font-bold">{aggregateStats.totalSessions}</div>
                </div>

                <div className="p-4 bg-green-50 rounded">
                    <div className="text-sm text-gray-600">En charge</div>
                    <div className="text-2xl font-bold text-green-600">{aggregateStats.activeSessions}</div>
                </div>

                <div className="p-4 bg-yellow-50 rounded">
                    <div className="text-sm text-gray-600">Puissance totale</div>
                    <div className="text-2xl font-bold text-yellow-600">
                        {aggregateStats.totalPowerKW.toFixed(1)} kW
                    </div>
                </div>

                <div className="p-4 bg-purple-50 rounded">
                    <div className="text-sm text-gray-600">SoC moyen</div>
                    <div className="text-2xl font-bold text-purple-600">
                        {aggregateStats.averageSoC.toFixed(1)}%
                    </div>
                </div>

                <div className="p-4 bg-indigo-50 rounded">
                    <div className="text-sm text-gray-600">Énergie totale</div>
                    <div className="text-2xl font-bold text-indigo-600">
                        {aggregateStats.totalEnergyKWh.toFixed(1)} kWh
                    </div>
                </div>
            </div>

            {/* Filtres et sélection métrique */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex gap-2">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    >
                        Toutes
                    </button>
                    <button
                        onClick={() => setFilter('charging')}
                        className={`px-3 py-1 rounded ${filter === 'charging' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    >
                        En charge
                    </button>
                    <button
                        onClick={() => setFilter('available')}
                        className={`px-3 py-1 rounded ${filter === 'available' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    >
                        Disponibles
                    </button>
                </div>

                <div className="flex gap-2">
                    <select
                        value={selectedMetric}
                        onChange={(e) => setSelectedMetric(e.target.value as any)}
                        className="p-2 border rounded"
                    >
                        <option value="soc">SoC (%)</option>
                        <option value="power">Puissance (kW)</option>
                        <option value="energy">Énergie (kWh)</option>
                    </select>
                </div>
            </div>

            {/* Graphique temps réel */}
            <div className="mb-6 p-4 bg-gray-50 rounded">
                <h3 className="font-bold mb-3">Évolution en temps réel</h3>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        {filteredSessions.map((session, index) => (
                            <Line
                                key={session.id}
                                type="monotone"
                                dataKey={session.name}
                                stroke={`hsl(${index * 360 / filteredSessions.length}, 70%, 50%)`}
                                strokeWidth={2}
                                dot={false}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Grille des sessions */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSessions.map(session => (
                    <div
                        key={session.id}
                        className="p-4 border rounded-lg hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => onSelectSession(session.id)}
                    >
                        <div className="flex justify-between items-start mb-3">
                            <h4 className="font-bold text-lg">{session.name}</h4>
                            <span className={`px-2 py-1 rounded text-white text-xs ${getStatusColor(session.status)}`}>
                {session.status}
              </span>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <Battery size={16} />
                  SoC
                </span>
                                <div className="flex items-center gap-2">
                                    <div className="w-24 bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-green-500 h-2 rounded-full"
                                            style={{ width: `${session.soc}%` }}
                                        />
                                    </div>
                                    <span className="text-sm font-medium">{session.soc}%</span>
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <Zap size={16} />
                  Puissance
                </span>
                                <span className="text-sm font-medium">
                  {(session.activeW / 1000).toFixed(1)} kW
                </span>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Énergie</span>
                                <span className="text-sm font-medium">
                  {(session.meterWh / 1000).toFixed(2)} kWh
                </span>
                            </div>

                            {session.transactionId && (
                                <div className="pt-2 border-t">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-500">Transaction</span>
                                        <span className="font-mono">{session.transactionId}</span>
                                    </div>
                                    {session.tagId && (
                                        <div className="flex justify-between text-xs mt-1">
                                            <span className="text-gray-500">Badge</span>
                                            <span className="font-mono">{session.tagId}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {filteredSessions.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <RefreshCw size={48} className="mx-auto mb-4 animate-spin" />
                    <p>Aucune session active</p>
                    <button
                        onClick={onAddSession}
                        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                        Créer une session
                    </button>
                </div>
            )}
        </div>
    );
};

export default SessionOverview;