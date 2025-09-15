// frontend/src/components/PerfOCPP.tsx
import React, { useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';

export function PerfOCPP() {
    const [perfUrl, setPerfUrl] = useState('wss://pp.total-ev-charge.com/ocpp/WebSocket');
    const [perfRunning, setPerfRunning] = useState(false);
    const [perfResults, setPerfResults] = useState<any[]>([]);
    const [perfChartData, setPerfChartData] = useState<any[]>([]);
    const [perfLogs, setPerfLogs] = useState<string[]>([]);
    const [perfMetrics, setPerfMetrics] = useState({
        totalSessions: 0,
        activeSessions: 0,
        successRate: 0,
        avgLatency: 0,
        maxLatency: 0,
        errorCount: 0
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleCSVImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const result = await api.importPerfCSV(formData);
            setPerfLogs(prev => [...prev, `✓ Imported ${result.count} clients from CSV`]);
        } catch (error) {
            setPerfLogs(prev => [...prev, `❌ Import failed: ${error}`]);
        }
    };

    const runAdaptivePerfTest = async () => {
        setPerfRunning(true);
        setPerfChartData([]);
        setPerfLogs(['🚀 Starting adaptive performance test...']);

        try {
            const result = await api.startPerformanceTest({
                url: perfUrl,
                initialBatch: 10,
                targetSessions: 1000
            });

            setPerfLogs(prev => [...prev,
                `✅ Test finished: ${result.totalSessions} total, ${result.successCount} successful`
            ]);
        } catch (error) {
            setPerfLogs(prev => [...prev, `❌ Test failed: ${error}`]);
        } finally {
            setPerfRunning(false);
        }
    };

    const stopTest = async () => {
        await api.stopPerformanceTest();
        setPerfRunning(false);
    };

    // Polling des métriques
    React.useEffect(() => {
        if (!perfRunning) return;

        const interval = setInterval(async () => {
            try {
                const metrics = await api.getPerformanceMetrics();
                setPerfMetrics(metrics);

                setPerfChartData(prev => [...prev, {
                    time: prev.length,
                    connections: metrics.activeSessions,
                    successRate: metrics.successRate
                }]);
            } catch (error) {
                console.error('Failed to fetch metrics:', error);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [perfRunning]);

    return (
        <div className="p-6">
            <div className="bg-gray-800 rounded-lg p-6 mb-6">
                <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-sm mb-1">URL OCPP:</label>
                        <input
                            type="text"
                            value={perfUrl}
                            onChange={(e) => setPerfUrl(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 rounded"
                            disabled={perfRunning}
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Import CSV:</label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv"
                            onChange={handleCSVImport}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full px-4 py-2 bg-gray-600 rounded hover:bg-gray-700"
                            disabled={perfRunning}
                        >
                            📁 Importer CSV Perf
                        </button>
                    </div>
                    <div className="flex items-end">
                        {!perfRunning ? (
                            <button
                                onClick={runAdaptivePerfTest}
                                className="w-full px-4 py-2 bg-red-600 rounded hover:bg-red-700"
                            >
                                🚀 Montée en charge adaptative
                            </button>
                        ) : (
                            <button
                                onClick={stopTest}
                                className="w-full px-4 py-2 bg-yellow-600 rounded hover:bg-yellow-700"
                            >
                                ⏹️ Arrêter Test
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-6 gap-4">
                    <div className="bg-gray-700 p-3 rounded text-center">
                        <div className="text-xs text-gray-400">Total</div>
                        <div className="text-xl font-bold">{perfMetrics.totalSessions}</div>
                    </div>
                    <div className="bg-gray-700 p-3 rounded text-center">
                        <div className="text-xs text-gray-400">Actives</div>
                        <div className="text-xl font-bold text-green-400">{perfMetrics.activeSessions}</div>
                    </div>
                    <div className="bg-gray-700 p-3 rounded text-center">
                        <div className="text-xs text-gray-400">Succès</div>
                        <div className="text-xl font-bold text-blue-400">{perfMetrics.successRate.toFixed(1)}%</div>
                    </div>
                    <div className="bg-gray-700 p-3 rounded text-center">
                        <div className="text-xs text-gray-400">Latence moy.</div>
                        <div className="text-xl font-bold">{perfMetrics.avgLatency}ms</div>
                    </div>
                    <div className="bg-gray-700 p-3 rounded text-center">
                        <div className="text-xs text-gray-400">Latence max</div>
                        <div className="text-xl font-bold text-yellow-400">{perfMetrics.maxLatency}ms</div>
                    </div>
                    <div className="bg-gray-700 p-3 rounded text-center">
                        <div className="text-xs text-gray-400">Erreurs</div>
                        <div className="text-xl font-bold text-red-400">{perfMetrics.errorCount}</div>
                    </div>
                </div>

                {perfRunning && (
                    <div className="mt-4 bg-gray-700 rounded-full h-4 overflow-hidden">
                        <div
                            className="bg-gradient-to-r from-blue-600 to-green-600 h-full transition-all duration-500 animate-pulse"
                            style={{ width: `${Math.min((perfMetrics.activeSessions / 1000) * 100, 100)}%` }}
                        />
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Résultats ({perfResults.length} sessions)</h3>
                    <div className="overflow-auto" style={{ maxHeight: '400px' }}>
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-800">
                            <tr className="border-b border-gray-700">
                                <th className="text-left py-2">CP-ID</th>
                                <th className="text-left py-2">WS</th>
                                <th className="text-left py-2">Boot (ms)</th>
                                <th className="text-left py-2">Auth (ms)</th>
                                <th className="text-left py-2">Start (ms)</th>
                                <th className="text-left py-2">Stop (ms)</th>
                                <th className="text-left py-2">Erreur</th>
                            </tr>
                            </thead>
                            <tbody>
                            {perfResults.slice(-100).map((result, idx) => (
                                <tr key={idx} className="border-b border-gray-700">
                                    <td className="py-2">{result.cpId}</td>
                                    <td className="py-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                          result.wsOk ? 'bg-green-600' : 'bg-red-600'
                      }`}>
                        {result.wsOk ? 'OK' : 'KO'}
                      </span>
                                    </td>
                                    <td className="py-2">{result.bootMs}</td>
                                    <td className="py-2">{result.authMs}</td>
                                    <td className="py-2">{result.startMs}</td>
                                    <td className="py-2">{result.stopMs}</td>
                                    <td className="py-2 text-xs text-red-400">{result.error || '-'}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Montée en charge adaptative</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={perfChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="time" stroke="#9CA3AF" />
                            <YAxis stroke="#9CA3AF" />
                            <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: 'none' }} />
                            <Legend />
                            <Line type="monotone" dataKey="connections" stroke="#10b981" strokeWidth={2} dot={false} name="Connexions actives" />
                            <Line type="monotone" dataKey="successRate" stroke="#3b82f6" strokeWidth={2} dot={false} name="Taux succès (%)" />
                        </LineChart>
                    </ResponsiveContainer>

                    <div className="mt-4">
                        <h4 className="font-semibold mb-2">Logs Performance :</h4>
                        <div className="bg-gray-900 p-3 rounded h-32 overflow-auto font-mono text-xs">
                            {perfLogs.map((log, idx) => (
                                <div key={idx} className={`${
                                    log.includes('⚠️') ? 'text-yellow-400' :
                                        log.includes('✅') || log.includes('✓') ? 'text-green-400' :
                                            log.includes('❌') ? 'text-red-400' : ''
                                }`}>
                                    {log}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}