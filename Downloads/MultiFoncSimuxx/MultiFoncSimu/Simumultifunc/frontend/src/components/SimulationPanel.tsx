// frontend/src/components/SimulationPanel.tsx
import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { api } from '@/services/api';
import {
    Play, StopCircle, Plus, Trash2, Download, Upload,
    Plug, Battery, RefreshCw
} from 'lucide-react';

export function SimulationPanel() {
    const { sessions, createSession, deleteSession } = useAppStore();
    const [selectedSessions, setSelectedSessions] = useState<string[]>([]);

    const handleSelectSession = (sessionId: string) => {
        setSelectedSessions(prev =>
            prev.includes(sessionId)
                ? prev.filter(id => id !== sessionId)
                : [...prev, sessionId]
        );
    };

    const handleSelectAll = () => {
        if (selectedSessions.length === sessions.length) {
            setSelectedSessions([]);
        } else {
            setSelectedSessions(sessions.map(s => s.id));
        }
    };

    const handleLaunchSelected = async () => {
        for (const sessionId of selectedSessions) {
            await api.connectOCPP(sessionId);
            await api.startTransaction(sessionId);
        }
    };

    const handleStopSelected = async () => {
        for (const sessionId of selectedSessions) {
            await api.stopTransaction(sessionId);
            await api.disconnectOCPP(sessionId);
        }
    };

    const handleExport = async () => {
        const data = sessions.filter(s => selectedSessions.includes(s.id));
        const csv = convertToCSV(data);
        downloadCSV(csv, 'sessions_export.csv');
    };

    const convertToCSV = (data: any[]) => {
        const headers = ['timestamp', 'cpId', 'sessionId', 'power', 'scp', 'messageType', 'status'];
        const rows = data.map(session => [
            new Date().toISOString(),
            session.chargePointId,
            session.id,
            session.activePower || 0,
            session.scpLimit || 0,
            session.state,
            session.connected ? 'Connected' : 'Disconnected'
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
    };

    const downloadCSV = (csv: string, filename: string) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    };

    return (
        <div className="h-full flex flex-col bg-white rounded-lg shadow">
            {/* Toolbar */}
            <div className="border-b border-gray-200 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => createSession(`Session ${sessions.length + 1}`)}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
                        >
                            <Plus size={18} />
                            Nouvelle Session
                        </button>

                        <button
                            onClick={handleLaunchSelected}
                            disabled={selectedSessions.length === 0}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            <Play size={18} />
                            Lancer
                        </button>

                        <button
                            onClick={handleStopSelected}
                            disabled={selectedSessions.length === 0}
                            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            <StopCircle size={18} />
                            Arrêter
                        </button>

                        <div className="h-8 w-px bg-gray-300 mx-2" />

                        <button
                            onClick={handleExport}
                            disabled={selectedSessions.length === 0}
                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            <Download size={18} />
                            Exporter
                        </button>

                        <button
                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center gap-2"
                        >
                            <Upload size={18} />
                            Importer
                        </button>
                    </div>

                    <div className="text-sm text-gray-600">
                        {selectedSessions.length} / {sessions.length} sélectionnées
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 sticky top-0">
                    <tr>
                        <th className="px-4 py-3 text-left">
                            <input
                                type="checkbox"
                                checked={selectedSessions.length === sessions.length && sessions.length > 0}
                                onChange={handleSelectAll}
                                className="rounded"
                            />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Session ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CP ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">État</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SoC</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Puissance</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SCP Limite</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Véhicule</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                    {sessions.map(session => (
                        <tr key={session.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                                <input
                                    type="checkbox"
                                    checked={selectedSessions.includes(session.id)}
                                    onChange={() => handleSelectSession(session.id)}
                                    className="rounded"
                                />
                            </td>
                            <td className="px-4 py-3 font-medium">{session.id}</td>
                            <td className="px-4 py-3">{session.chargePointId}</td>
                            <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      session.state === 'CHARGING' ? 'bg-green-100 text-green-800' :
                          session.state === 'CONNECTED' ? 'bg-blue-100 text-blue-800' :
                              session.state === 'FAULTED' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                  }`}>
                    {session.state}
                  </span>
                            </td>
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-20 bg-gray-200 rounded-full h-2">
                                        <div
                                            className="bg-green-500 h-2 rounded-full"
                                            style={{ width: `${session.soc || 0}%` }}
                                        />
                                    </div>
                                    <span className="text-sm">{(session.soc || 0).toFixed(0)}%</span>
                                </div>
                            </td>
                            <td className="px-4 py-3">{(session.activePower || 0).toFixed(1)} kW</td>
                            <td className="px-4 py-3">{(session.scpLimit || 0).toFixed(1)} kW</td>
                            <td className="px-4 py-3">{session.vehicleProfile?.name || 'Non défini'}</td>
                            <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                    <button className="p-1 hover:bg-gray-100 rounded" title="Connecter">
                                        <Plug size={16} />
                                    </button>
                                    <button className="p-1 hover:bg-gray-100 rounded" title="Charger">
                                        <Battery size={16} />
                                    </button>
                                    <button
                                        onClick={() => deleteSession(session.id)}
                                        className="p-1 hover:bg-gray-100 rounded text-red-600"
                                        title="Supprimer"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}