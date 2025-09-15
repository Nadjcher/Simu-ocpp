// frontend/src/components/SmartCharging.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useSessionStore } from '../store/sessionStore';

interface ChargingPeriod {
    startPeriod: number;
    limit: number;
    numberPhases?: number;
}

export function SmartCharging() {
    const { sessions } = useSessionStore();
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [scUrl, setScUrl] = useState('wss://pp.total-ev-charge.com/ocpp/WebSocket');
    const [scCpId, setScCpId] = useState('CU-POP-REGULATION-PP-TOMY-3');
    const [scEvpId, setScEvpId] = useState('CU-GPM-TEST-FLOW-001-200');
    const [scToken, setScToken] = useState('');
    const [scConnected, setScConnected] = useState(false);
    const [scConnectorId, setScConnectorId] = useState(1);
    const [scProfileId, setScProfileId] = useState(1);
    const [scStackLevel, setScStackLevel] = useState(0);
    const [scPurpose, setScPurpose] = useState('TxProfile');
    const [scKind, setScKind] = useState('Absolute');
    const [scRecurrency, setScRecurrency] = useState('Daily');
    const [scUnit, setScUnit] = useState('W');
    const [scPeriods, setScPeriods] = useState<ChargingPeriod[]>([{ startPeriod: 0, limit: 10000 }]);
    const [scLogs, setScLogs] = useState<string[]>([]);
    const [scValidFrom, setScValidFrom] = useState(new Date().toISOString().split('T')[0]);
    const [scValidTo, setScValidTo] = useState(new Date(Date.now() + 86400000).toISOString().split('T')[0]);
    const [savedProfiles, setSavedProfiles] = useState<any[]>([]);

    useEffect(() => {
        loadSavedProfiles();
    }, []);

    const loadSavedProfiles = async () => {
        try {
            const profiles = await api.getChargingProfiles();
            setSavedProfiles(profiles);
        } catch (error) {
            console.error('Failed to load profiles:', error);
        }
    };

    const buildChargingProfile = () => {
        return {
            connectorId: scConnectorId,
            profileId: scProfileId,
            stackLevel: scStackLevel,
            purpose: scPurpose,
            kind: scKind,
            recurrency: scKind === 'Recurring' ? scRecurrency : undefined,
            unit: scUnit,
            validFrom: scKind === 'Recurring' ? scValidFrom : undefined,
            validTo: scKind === 'Recurring' ? scValidTo : undefined,
            periods: scPeriods
        };
    };

    const handleConnect = async () => {
        if (!selectedSessionId) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Sélectionnez une session`]);
            return;
        }

        try {
            await api.connectSession(selectedSessionId);
            setScConnected(true);
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ Connecté`]);
        } catch (error) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Erreur: ${error}`]);
        }
    };

    const handleDisconnect = async () => {
        if (!selectedSessionId) return;

        try {
            await api.disconnectSession(selectedSessionId);
            setScConnected(false);
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Déconnecté`]);
        } catch (error) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Erreur: ${error}`]);
        }
    };

    const handleSendOCPP = async () => {
        if (!selectedSessionId || !scConnected) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Non connecté`]);
            return;
        }

        const profile = buildChargingProfile();
        const timestamp = new Date().toLocaleTimeString();

        try {
            setScLogs(prev => [...prev,
                `[${timestamp}] → Sent SetChargingProfile`,
                `[${timestamp}] Payload: ${JSON.stringify(profile, null, 2).substring(0, 200)}...`
            ]);

            const result = await api.applyChargingProfile({
                sessionId: selectedSessionId,
                ...profile
            });

            setScLogs(prev => [...prev,
                `[${new Date().toLocaleTimeString()}] ← SetChargingProfile Response: ${JSON.stringify(result)}`
            ]);
        } catch (error) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Erreur: ${error}`]);
        }
    };

    const handleClearProfile = async () => {
        if (!selectedSessionId || !scConnected) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Non connecté`]);
            return;
        }

        try {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] → Sent ClearChargingProfile`]);

            const result = await api.clearChargingProfile({
                sessionId: selectedSessionId,
                profileId: scProfileId,
                connectorId: scConnectorId
            });

            setScLogs(prev => [...prev,
                `[${new Date().toLocaleTimeString()}] ← ClearChargingProfile Response: ${JSON.stringify(result)}`
            ]);
        } catch (error) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Erreur: ${error}`]);
        }
    };

    const handleSendCentral = async () => {
        if (!scEvpId || !scToken) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ EVP ID et Token requis`]);
            return;
        }

        const profile = buildChargingProfile();

        try {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] → Sent CentralTask`]);

            const result = await api.applyCentralProfile({
                evpId: scEvpId,
                bearerToken: scToken,
                ...profile
            });

            setScLogs(prev => [...prev,
                `[${new Date().toLocaleTimeString()}] ← CentralTask Response: ${JSON.stringify(result)}`
            ]);
        } catch (error) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Erreur: ${error}`]);
        }
    };

    const handleSaveProfile = async () => {
        const profile = {
            name: prompt('Nom du profil:') || `Profile ${savedProfiles.length + 1}`,
            ...buildChargingProfile()
        };

        try {
            await api.saveChargingProfile(profile);
            await loadSavedProfiles();
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ Profil sauvegardé`]);
        } catch (error) {
            setScLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Erreur: ${error}`]);
        }
    };

    const addPeriod = () => {
        setScPeriods([...scPeriods, { startPeriod: 0, limit: 0 }]);
    };

    const removePeriod = (index: number) => {
        setScPeriods(scPeriods.filter((_, i) => i !== index));
    };

    const updatePeriod = (index: number, field: keyof ChargingPeriod, value: any) => {
        const newPeriods = [...scPeriods];
        newPeriods[index] = { ...newPeriods[index], [field]: value };
        setScPeriods(newPeriods);
    };

    return (
        <div className="p-6">
            <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Connexion</h3>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm mb-1">Session:</label>
                            <select
                                value={selectedSessionId}
                                onChange={(e) => setSelectedSessionId(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            >
                                <option value="">-- Sélectionner --</option>
                                {sessions.map(session => (
                                    <option key={session.id} value={session.id}>
                                        {session.title} ({session.cpId})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm mb-1">CP-ID:</label>
                            <input
                                type="text"
                                value={scCpId}
                                onChange={(e) => setScCpId(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Evp-ID:</label>
                            <input
                                type="text"
                                value={scEvpId}
                                onChange={(e) => setScEvpId(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Token:</label>
                            <input
                                type="password"
                                value={scToken}
                                onChange={(e) => setScToken(e.target.value)}
                                placeholder="Bearer token"
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                    </div>

                    <button
                        onClick={scConnected ? handleDisconnect : handleConnect}
                        className={`px-4 py-2 rounded ${
                            scConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                        disabled={!selectedSessionId}
                    >
                        {scConnected ? 'Disconnect' : 'Connect'}
                    </button>
                    <span className="ml-4 text-sm">
            {scConnected ? '🟢 Connecté' : '🔴 Déconnecté'}
          </span>

                    <hr className="my-6 border-gray-700" />

                    <h3 className="text-lg font-semibold mb-4">Configuration du profil</h3>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                            <label className="block text-sm mb-1">ConnectorId:</label>
                            <input
                                type="number"
                                value={scConnectorId}
                                onChange={(e) => setScConnectorId(parseInt(e.target.value) || 1)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1">ProfileId:</label>
                            <input
                                type="number"
                                value={scProfileId}
                                onChange={(e) => setScProfileId(parseInt(e.target.value) || 1)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1">StackLevel:</label>
                            <input
                                type="number"
                                value={scStackLevel}
                                onChange={(e) => setScStackLevel(parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Purpose:</label>
                            <select
                                value={scPurpose}
                                onChange={(e) => setScPurpose(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            >
                                <option value="TxProfile">TxProfile</option>
                                <option value="TxDefaultProfile">TxDefaultProfile</option>
                                <option value="ChargePointMaxProfile">ChargePointMaxProfile</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Kind:</label>
                            <select
                                value={scKind}
                                onChange={(e) => setScKind(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            >
                                <option value="Absolute">Absolute</option>
                                <option value="Recurring">Recurring</option>
                                <option value="Relative">Relative</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Unit:</label>
                            <select
                                value={scUnit}
                                onChange={(e) => setScUnit(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            >
                                <option value="W">W</option>
                                <option value="A">A</option>
                            </select>
                        </div>
                    </div>

                    {scKind === 'Recurring' && (
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="block text-sm mb-1">Recurrence:</label>
                                <select
                                    value={scRecurrency}
                                    onChange={(e) => setScRecurrency(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-700 rounded"
                                >
                                    <option value="Daily">Daily</option>
                                    <option value="Weekly">Weekly</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm mb-1">ValidFrom:</label>
                                <input
                                    type="date"
                                    value={scValidFrom}
                                    onChange={(e) => setScValidFrom(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-700 rounded"
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">ValidTo:</label>
                                <input
                                    type="date"
                                    value={scValidTo}
                                    onChange={(e) => setScValidTo(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-700 rounded"
                                />
                            </div>
                        </div>
                    )}

                    <div className="mb-4">
                        <h4 className="font-semibold mb-2">Périodes</h4>
                        {scPeriods.map((period, idx) => (
                            <div key={idx} className="flex space-x-2 mb-2">
                                <input
                                    type="number"
                                    value={period.startPeriod}
                                    onChange={(e) => updatePeriod(idx, 'startPeriod', parseInt(e.target.value) || 0)}
                                    placeholder="start(s)"
                                    className="flex-1 px-3 py-2 bg-gray-700 rounded"
                                />
                                <input
                                    type="number"
                                    value={period.limit}
                                    onChange={(e) => updatePeriod(idx, 'limit', parseInt(e.target.value) || 0)}
                                    placeholder="limit"
                                    className="flex-1 px-3 py-2 bg-gray-700 rounded"
                                />
                                <input
                                    type="number"
                                    value={period.numberPhases || ''}
                                    onChange={(e) => updatePeriod(idx, 'numberPhases', parseInt(e.target.value) || undefined)}
                                    placeholder="phases"
                                    className="w-20 px-3 py-2 bg-gray-700 rounded"
                                />
                                <button
                                    onClick={() => removePeriod(idx)}
                                    className="px-3 py-2 bg-red-600 rounded hover:bg-red-700"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={addPeriod}
                            className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700"
                        >
                            Ajouter période
                        </button>
                    </div>

                    <div className="flex space-x-2">
                        <button
                            onClick={handleSendOCPP}
                            className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
                            disabled={!scConnected}
                        >
                            Envoyer OCPP
                        </button>
                        <button
                            onClick={handleSendCentral}
                            className="px-4 py-2 bg-green-600 rounded hover:bg-green-700"
                        >
                            Envoyer Central
                        </button>
                        <button
                            onClick={handleClearProfile}
                            className="px-4 py-2 bg-red-600 rounded hover:bg-red-700"
                            disabled={!scConnected}
                        >
                            Clear Profile
                        </button>
                        <button
                            onClick={handleSaveProfile}
                            className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700"
                        >
                            Sauvegarder
                        </button>
                    </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Prévisualisation JSON:</h3>
                    <pre className="bg-gray-900 p-4 rounded overflow-auto h-64 text-xs">
{JSON.stringify(buildChargingProfile(), null, 2)}
          </pre>

                    <hr className="my-6 border-gray-700" />

                    <h3 className="text-lg font-semibold mb-4">Logs Smart Charging:</h3>
                    <div className="bg-gray-900 p-4 rounded h-48 overflow-auto font-mono text-xs">
                        {scLogs.length === 0 ? (
                            <span className="text-gray-500">En attente de connexion...</span>
                        ) : (
                            scLogs.map((log, idx) => (
                                <div key={idx} className={`mb-1 ${
                                    log.includes('✅') ? 'text-green-400' :
                                        log.includes('❌') ? 'text-red-400' :
                                            log.includes('←') ? 'text-blue-400' :
                                                log.includes('→') ? 'text-yellow-400' :
                                                    'text-gray-300'
                                }`}>
                                    {log}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}