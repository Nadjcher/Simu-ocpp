import React, { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { PerformanceMetrics } from '@/types';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
    Cpu,
    Activity,
    Zap,
    AlertTriangle,
    Download,
    Upload,
    Play,
    StopCircle
} from 'lucide-react';

export function PerformanceOCPP() {
    const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
    const [history, setHistory] = useState<PerformanceMetrics[]>([]);
    const [isTestRunning, setIsTestRunning] = useState(false);
    const [testConfig, setTestConfig] = useState({
        sessions: 100,
        duration: 60
    });

    // Charger les métriques toutes les secondes
    useEffect(() => {
        const loadMetrics = async () => {
            try {
                const current = await api.getPerformanceMetrics();
                setMetrics(current);

                setHistory(prev => {
                    const updated = [...prev, current];
                    if (updated.length > 60) updated.shift();
                    return updated;
                });
            } catch (error) {
                console.error('Failed to load metrics:', error);
            }
        };

        loadMetrics();
        const interval = setInterval(loadMetrics, 1000);

        return () => clearInterval(interval);
    }, []);

    const startTest = async () => {
        setIsTestRunning(true);
        try {
            await api.startPerformanceTest(testConfig.sessions, testConfig.duration);
        } catch (error) {
            console.error('Failed to start test:', error);
            setIsTestRunning(false);
        }
    };

    const stopTest = async () => {
        try {
            await api.stopPerformanceTest();
        } finally {
            setIsTestRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Métriques temps réel */}
            <div className="grid grid-cols-4 gap-4">
                <div className="card bg-gradient-to-br from-blue-600 to-blue-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm opacity-80">CPU Usage</div>
                            <div className="text-3xl font-bold">{metrics?.cpuUsage.toFixed(1)}%</div>
                        </div>
                        <Cpu size={32} className="opacity-50" />
                    </div>
                </div>

                <div className="card bg-gradient-to-br from-green-600 to-green-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm opacity-80">RAM Usage</div>
                            <div className="text-3xl font-bold">{metrics?.memoryUsage.toFixed(1)}%</div>
                        </div>
                        <Activity size={32} className="opacity-50" />
                    </div>
                </div>

                <div className="card bg-gradient-to-br from-yellow-600 to-yellow-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm opacity-80">Messages/sec</div>
                            <div className="text-3xl font-bold">{metrics?.messagesPerSecond || 0}</div>
                        </div>
                        <Zap size={32} className="opacity-50" />
                    </div>
                </div>

                <div className="card bg-gradient-to-br from-red-600 to-red-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm opacity-80">Errors</div>
                            <div className="text-3xl font-bold">{metrics?.errors || 0}</div>
                        </div>
                        <AlertTriangle size={32} className="opacity-50" />
                    </div>
                </div>
            </div>

            {/* Test de charge */}
            <div className="card">
                <h3 className="text-xl font-semibold mb-4">Test de Charge OCPP</h3>

                <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-1">
                            Nombre de sessions
                        </label>
                        <input
                            type="number"
                            value={testConfig.sessions}
                            onChange={(e) => setTestConfig(prev => ({
                                ...prev,
                                sessions: parseInt(e.target.value)
                            }))}
                            className="input-field w-full"
                            min="1"
                            max="10000"
                            disabled={isTestRunning}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">
                            Durée (secondes)
                        </label>
                        <input
                            type="number"
                            value={testConfig.duration}
                            onChange={(e) => setTestConfig(prev => ({
                                ...prev,
                                duration: parseInt(e.target.value)
                            }))}
                            className="input-field w-full"
                            min="10"
                            max="3600"
                            disabled={isTestRunning}
                        />
                    </div>

                    <div className="flex items-end">
                        {!isTestRunning ? (
                            <button
                                onClick={startTest}
                                className="btn-success flex items-center gap-2 w-full"
                            >
                                <Play size={18} />
                                Démarrer le test
                            </button>
                        ) : (
                            <button
                                onClick={stopTest}
                                className="btn-danger flex items-center gap-2 w-full"
                            >
                                <StopCircle size={18} />
                                Arrêter le test
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Graphiques de performance */}
            <div className="grid grid-cols-2 gap-4">
                <div className="card">
                    <h4 className="text-lg font-semibold mb-3">CPU & Mémoire</h4>
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                                dataKey="timestamp"
                                stroke="#9CA3AF"
                                tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                            />
                            <YAxis stroke="#9CA3AF" />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1F2937', border: 'none' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="cpuUsage"
                                stroke="#3B82F6"
                                fill="#3B82F6"
                                fillOpacity={0.5}
                                name="CPU %"
                            />
                            <Area
                                type="monotone"
                                dataKey="memoryUsage"
                                stroke="#10B981"
                                fill="#10B981"
                                fillOpacity={0.5}
                                name="RAM %"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <div className="card">
                    <h4 className="text-lg font-semibold mb-3">Messages OCPP</h4>
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                                dataKey="timestamp"
                                stroke="#9CA3AF"
                                tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                            />
                            <YAxis stroke="#9CA3AF" />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1F2937', border: 'none' }}
                            />
                            <Line
                                type="monotone"
                                dataKey="messagesPerSecond"
                                stroke="#F59E0B"
                                strokeWidth={2}
                                name="Msg/sec"
                                dot={false}
                            />
                            <Line
                                type="monotone"
                                dataKey="averageLatency"
                                stroke="#EF4444"
                                strokeWidth={2}
                                name="Latence (ms)"
                                dot={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}