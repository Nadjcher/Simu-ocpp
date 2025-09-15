// frontend/src/components/SessionPanel.tsx

import React, { useState } from 'react';

interface SessionPanelProps {
    session: any;
    onUpdate: (updates: any) => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onPark: () => void;
    onPlug: () => void;
    onAuthorize: (tag: string) => void;
    onStart: () => void;
    onStop: () => void;
}

export const SessionPanel: React.FC<SessionPanelProps> = ({
                                                              session,
                                                              onUpdate,
                                                              onConnect,
                                                              onDisconnect,
                                                              onPark,
                                                              onPlug,
                                                              onAuthorize,
                                                              onStart,
                                                              onStop
                                                          }) => {
    const [idTag, setIdTag] = useState('TEST-TAG-001');

    // Profils de véhicules en dur (temporaire)
    const vehicleProfiles = [
        { id: 'TESLA_MODEL_3', name: 'Tesla Model 3 (75 kWh)' },
        { id: 'RENAULT_ZOE', name: 'Renault ZOE (52 kWh)' },
        { id: 'NISSAN_LEAF', name: 'Nissan Leaf (62 kWh)' }
    ];

    const getStateColor = (state: string) => {
        switch (state) {
            case 'DISCONNECTED': return 'text-gray-400';
            case 'CONNECTING': return 'text-yellow-400';
            case 'CONNECTED': return 'text-green-400';
            case 'AUTHORIZED': return 'text-blue-400';
            case 'CHARGING': return 'text-green-500';
            default: return 'text-gray-400';
        }
    };

    return (
        <div className="bg-gray-800 rounded-lg p-6 h-full overflow-auto border border-gray-700">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">{session.title}</h2>
                <span className={`font-semibold ${getStateColor(session.state)}`}>
          {session.state}
        </span>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Configuration Panel */}
                <div>
                    <h3 className="text-lg font-semibold mb-3 text-white">🔌 Connexion OCPP</h3>

                    <div className="space-y-3 mb-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm mb-1 text-gray-300">URL WebSocket</label>
                                <input
                                    type="text"
                                    value={session.url}
                                    onChange={(e) => onUpdate({ url: e.target.value })}
                                    className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600"
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-gray-300">Charge Point ID</label>
                                <input
                                    type="text"
                                    value={session.cpId}
                                    onChange={(e) => onUpdate({ cpId: e.target.value })}
                                    className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600"
                                />
                            </div>
                        </div>

                        <button
                            onClick={session.state === 'DISCONNECTED' ? onConnect : onDisconnect}
                            className={`w-full px-4 py-2 rounded font-medium text-white ${
                                session.state === 'DISCONNECTED'
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-red-600 hover:bg-red-700'
                            }`}
                            disabled={session.state === 'CONNECTING'}
                        >
                            {session.state === 'DISCONNECTED' ? '🔌 Connecter' :
                                session.state === 'CONNECTING' ? '⏳ Connexion...' :
                                    '🔌 Déconnecter'}
                        </button>
                    </div>

                    <h3 className="text-lg font-semibold mb-3 text-white">🚗 Véhicule</h3>

                    <div className="space-y-3 mb-4">
                        <div>
                            <label className="block text-sm mb-1 text-gray-300">Profil véhicule</label>
                            <select
                                value={session.vehicleProfile || ''}
                                onChange={(e) => onUpdate({ vehicleProfile: e.target.value })}
                                className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600"
                            >
                                <option value="">Sélectionner un véhicule</option>
                                {vehicleProfiles.map(profile => (
                                    <option key={profile.id} value={profile.id}>
                                        {profile.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={onPark}
                                disabled={session.state !== 'CONNECTED'}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                🅿️ Park
                            </button>
                            <button
                                onClick={onPlug}
                                disabled={session.state !== 'CONNECTED'}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                🔌 Plug
                            </button>
                        </div>
                    </div>

                    <h3 className="text-lg font-semibold mb-3 text-white">⚡ Charge</h3>

                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={idTag}
                                onChange={(e) => setIdTag(e.target.value)}
                                className="flex-1 px-3 py-2 bg-gray-700 text-white rounded text-sm border border-gray-600"
                                placeholder="ID Tag"
                            />
                            <button
                                onClick={() => onAuthorize(idTag)}
                                disabled={session.state !== 'CONNECTED'}
                                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                            >
                                🔑 Auth
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={onStart}
                                disabled={session.state !== 'AUTHORIZED'}
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                                ▶️ Start
                            </button>
                            <button
                                onClick={onStop}
                                disabled={session.state !== 'CHARGING'}
                                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                                ⏹️ Stop
                            </button>
                        </div>
                    </div>
                </div>

                {/* Status Panel */}
                <div>
                    <h3 className="text-lg font-semibold mb-3 text-white">📊 État de charge</h3>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-gray-700 p-3 rounded">
                            <div className="text-sm text-gray-400">SoC actuel</div>
                            <div className="text-2xl font-bold text-white">{session.soc?.toFixed(1) || '0.0'}%</div>
                        </div>
                        <div className="bg-gray-700 p-3 rounded">
                            <div className="text-sm text-gray-400">Énergie</div>
                            <div className="text-2xl font-bold text-white">{((session.meterValue || 0) / 1000).toFixed(1)} kWh</div>
                        </div>
                    </div>

                    {/* Graphiques simplifiés */}
                    <div className="bg-gray-700 rounded p-4 mb-4 h-32 flex items-center justify-center">
                        <div className="text-gray-400 text-center">
                            <div className="text-3xl mb-2">📈</div>
                            <div>Graphique SoC</div>
                        </div>
                    </div>

                    <div className="bg-gray-700 rounded p-4 h-32 flex items-center justify-center">
                        <div className="text-gray-400 text-center">
                            <div className="text-3xl mb-2">⚡</div>
                            <div>Graphique Puissance</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Logs */}
            <div className="mt-6">
                <h3 className="text-lg font-semibold mb-2 text-white">📋 Logs</h3>
                <div className="bg-gray-900 rounded p-3 h-32 overflow-y-auto font-mono text-xs border border-gray-700">
                    {session.logs?.length === 0 ? (
                        <div className="text-gray-500">Aucun log disponible</div>
                    ) : (
                        session.logs?.map((log: string, index: number) => (
                            <div key={index} className="text-gray-300">
                                {log}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};