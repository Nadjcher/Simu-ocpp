// frontend/src/components/SessionOverview.tsx

import React from 'react';
import { Plus, Play, Square, Battery, Zap, WifiOff, Wifi } from 'lucide-react';

interface SessionInfo {
    id: string;
    name: string;
    chargePointId: string;
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
    sessions: SessionInfo[];
    onAddSession: () => void;
    onSelectSession: (sessionId: string) => void;
}

export const SessionOverview: React.FC<SessionOverviewProps> = ({
                                                                    sessions,
                                                                    onAddSession,
                                                                    onSelectSession
                                                                }) => {
    const getStatusColor = (status: SessionInfo['status']) => {
        switch (status) {
            case 'Available': return 'bg-green-500';
            case 'Preparing': return 'bg-yellow-500';
            case 'Charging': return 'bg-blue-500';
            case 'Finishing': return 'bg-orange-500';
            case 'Unavailable': return 'bg-gray-500';
            default: return 'bg-gray-400';
        }
    };

    const getStatusIcon = (status: SessionInfo['status']) => {
        switch (status) {
            case 'Charging': return <Zap className="w-5 h-5" />;
            case 'Available': return <Wifi className="w-5 h-5" />;
            case 'Unavailable': return <WifiOff className="w-5 h-5" />;
            default: return <Battery className="w-5 h-5" />;
        }
    };

    if (sessions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white rounded-lg shadow">
                <div className="text-gray-400 mb-4">
                    <Battery size={64} />
                </div>
                <h3 className="text-xl font-semibold mb-2">Aucune session active</h3>
                <p className="text-gray-500 mb-6">Créez une nouvelle session pour commencer</p>
                <button
                    onClick={onAddSession}
                    className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
                >
                    <Plus size={20} />
                    Nouvelle session
                </button>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Sessions actives ({sessions.length})</h2>
                <button
                    onClick={onAddSession}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
                >
                    <Plus size={20} />
                    Nouvelle session
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sessions.map(session => (
                    <div
                        key={session.id}
                        className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => onSelectSession(session.id)}
                    >
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold">{session.name}</h3>
                                    <p className="text-sm text-gray-500">{session.chargePointId}</p>
                                </div>
                                <div className={`p-2 rounded-full ${getStatusColor(session.status)} text-white`}>
                                    {getStatusIcon(session.status)}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">État</span>
                                    <span className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(session.status)}`}>
                                        {session.status}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">SoC</span>
                                    <div className="flex items-center gap-2">
                                        <div className="w-24 bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-green-500 h-2 rounded-full transition-all"
                                                style={{ width: `${session.soc}%` }}
                                            />
                                        </div>
                                        <span className="text-sm font-medium">{session.soc}%</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">Énergie</span>
                                    <span className="text-sm font-medium">
                                        {(session.meterWh / 1000).toFixed(2)} kWh
                                    </span>
                                </div>

                                {session.status === 'Charging' && (
                                    <>
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-600">Puissance</span>
                                            <span className="text-sm font-medium">
                                                {(session.activeW / 1000).toFixed(1)} kW
                                            </span>
                                        </div>

                                        {session.transactionId && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm text-gray-600">Transaction</span>
                                                <span className="text-sm font-mono">
                                                    #{session.transactionId}
                                                </span>
                                            </div>
                                        )}

                                        {session.startTime && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm text-gray-600">Durée</span>
                                                <span className="text-sm font-medium">
                                                    {Math.floor((Date.now() - session.startTime.getTime()) / 60000)} min
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}

                                <div className="pt-3 border-t flex justify-between">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelectSession(session.id);
                                        }}
                                        className="text-blue-500 hover:text-blue-600 text-sm font-medium"
                                    >
                                        Gérer
                                    </button>

                                    {session.status === 'Charging' ? (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Implémenter l'arrêt
                                            }}
                                            className="text-red-500 hover:text-red-600 flex items-center gap-1"
                                        >
                                            <Square size={16} />
                                            <span className="text-sm font-medium">Arrêter</span>
                                        </button>
                                    ) : (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Implémenter le démarrage
                                            }}
                                            className="text-green-500 hover:text-green-600 flex items-center gap-1"
                                        >
                                            <Play size={16} />
                                            <span className="text-sm font-medium">Démarrer</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};