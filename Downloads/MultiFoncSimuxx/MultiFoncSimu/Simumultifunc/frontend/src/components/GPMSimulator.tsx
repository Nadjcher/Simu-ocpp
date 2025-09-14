// frontend/src/components/GPMSimulator.tsx
import React, { useState } from 'react';
import { Settings, Database, Server, Wifi } from 'lucide-react';

export function GPMSimulator() {
    const [config, setConfig] = useState({
        serverUrl: 'ws://localhost:8080/ocpp',
        maxSessions: 20000,
        heartbeatInterval: 60,
        meterValueInterval: 10,
        autoReconnect: true
    });

    return (
        <div className="h-full bg-white rounded-lg shadow p-6">
            <div className="mb-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Settings className="text-blue-600" />
                    Configuration GPM Simulateur
                </h2>
                <p className="text-gray-600 mt-2">Configuration globale du simulateur EVSE</p>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Configuration Serveur */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Server size={20} />
                        Serveur OCPP
                    </h3>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            URL du serveur
                        </label>
                        <input
                            type="text"
                            value={config.serverUrl}
                            onChange={(e) => setConfig({...config, serverUrl: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Sessions maximum
                        </label>
                        <input
                            type="number"
                            value={config.maxSessions}
                            onChange={(e) => setConfig({...config, maxSessions: parseInt(e.target.value)})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                    </div>
                </div>

                {/* Configuration Timing */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Wifi size={20} />
                        Paramètres de communication
                    </h3>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Intervalle Heartbeat (s)
                        </label>
                        <input
                            type="number"
                            value={config.heartbeatInterval}
                            onChange={(e) => setConfig({...config, heartbeatInterval: parseInt(e.target.value)})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Intervalle MeterValues (s)
                        </label>
                        <input
                            type="number"
                            value={config.meterValueInterval}
                            onChange={(e) => setConfig({...config, meterValueInterval: parseInt(e.target.value)})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                    </div>

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            checked={config.autoReconnect}
                            onChange={(e) => setConfig({...config, autoReconnect: e.target.checked})}
                            className="mr-2"
                        />
                        <label className="text-sm font-medium text-gray-700">
                            Reconnexion automatique
                        </label>
                    </div>
                </div>
            </div>

            {/* Statistiques */}
            <div className="mt-8 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} />
                    Statistiques système
                </h3>
                <div className="grid grid-cols-4 gap-4">
                    <div className="bg-white p-3 rounded shadow">
                        <div className="text-2xl font-bold text-blue-600">0</div>
                        <div className="text-sm text-gray-600">Sessions actives</div>
                    </div>
                    <div className="bg-white p-3 rounded shadow">
                        <div className="text-2xl font-bold text-green-600">0</div>
                        <div className="text-sm text-gray-600">Transactions</div>
                    </div>
                    <div className="bg-white p-3 rounded shadow">
                        <div className="text-2xl font-bold text-yellow-600">0</div>
                        <div className="text-sm text-gray-600">Messages/s</div>
                    </div>
                    <div className="bg-white p-3 rounded shadow">
                        <div className="text-2xl font-bold text-purple-600">0</div>
                        <div className="text-sm text-gray-600">Erreurs</div>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex gap-3">
                <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                    Sauvegarder configuration
                </button>
                <button className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
                    Réinitialiser
                </button>
            </div>
        </div>
    );
}