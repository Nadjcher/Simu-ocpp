// frontend/src/components/SimuEVSE.tsx
import React, { useState, useEffect } from 'react';
import { SessionPanel } from './SessionPanel';
import { SessionOverview } from './SessionOverview';
import { useSessionStore } from '../store/sessionStore';

export function SimuEVSE() {
    const { sessions, createSession, activeSessionId, setActiveSessionId } = useSessionStore();
    const [overviewMetric, setOverviewMetric] = useState<'SoC' | 'Offered' | 'Active' | 'SetPoint'>('SoC');
    const [sessionFilter, setSessionFilter] = useState<Record<string, boolean>>({});

    const visibleSessions = sessions.filter(s => !s.hidden);
    const activeSessions = visibleSessions.filter(s => s.state === 'CHARGING');

    const handleCreateSession = async () => {
        const sessionNumber = sessions.length + 1;
        await createSession(`Session ${sessionNumber}`);
    };

    // Calculer les moyennes
    const avgSoc = activeSessions.length > 0
        ? activeSessions.reduce((sum, s) => sum + (s.soc || 0), 0) / activeSessions.length
        : 0;
    const avgOffered = activeSessions.length > 0
        ? activeSessions.reduce((sum, s) => sum + (s.offeredPowerW || 0), 0) / activeSessions.length
        : 0;
    const avgActive = activeSessions.length > 0
        ? activeSessions.reduce((sum, s) => sum + (s.activePowerW || 0), 0) / activeSessions.length
        : 0;
    const avgSetPoint = activeSessions.length > 0
        ? activeSessions.reduce((sum, s) => sum + (s.appliedLimitW || 0), 0) / activeSessions.length
        : 0;

    return (
        <div className="flex flex-col h-screen bg-gray-900">
            {/* En-tête avec Vue d'ensemble */}
            <div className="bg-gray-800 border-b border-gray-700 p-2">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm">Vue d'ensemble</span>
                        <select
                            value={activeSessionId || sessions[0]?.id || ''}
                            onChange={(e) => setActiveSessionId(e.target.value)}
                            className="px-2 py-1 bg-gray-700 rounded text-sm"
                        >
                            {sessions.map(session => (
                                <option key={session.id} value={session.id}>
                                    {session.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleCreateSession}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        >
                            + Nouvelle session
                        </button>

                        <div className="flex gap-4 text-xs">
                            <span>Sessions actives : <strong>{activeSessions.length}</strong></span>
                            <span>SoC moyen : <strong>{avgSoc.toFixed(1)} %</strong></span>
                            <span>Offered moyen : <strong>{avgOffered.toFixed(0)} W</strong></span>
                            <span>Active moyen : <strong>{avgActive.toFixed(0)} W</strong></span>
                            <span>SetPoint moyen : <strong>{avgSetPoint.toFixed(0)} W</strong></span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <label className="text-sm">Métrique :</label>
                    <select
                        value={overviewMetric}
                        onChange={(e) => setOverviewMetric(e.target.value as any)}
                        className="px-2 py-1 bg-gray-700 rounded text-sm"
                    >
                        <option value="SoC">SoC</option>
                        <option value="Offered">Offered</option>
                        <option value="Active">Active</option>
                        <option value="SetPoint">SetPoint</option>
                    </select>

                    <div className="flex items-center gap-2">
                        <span className="text-sm">Afficher sessions :</span>
                        {sessions.map(session => (
                            <label key={session.id} className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={sessionFilter[session.id] !== false}
                                    onChange={(e) => setSessionFilter(prev => ({
                                        ...prev,
                                        [session.id]: e.target.checked
                                    }))}
                                />
                                <span className="text-xs">{session.title}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {/* Zone principale avec graphique d'ensemble et panneau de session */}
            <div className="flex-1 flex flex-col p-2">
                <SessionOverview
                    metric={overviewMetric}
                    filter={sessionFilter}
                    sessions={activeSessions}
                />

                {activeSessionId && (
                    <div className="flex-1">
                        <SessionPanel sessionId={activeSessionId} />
                    </div>
                )}
            </div>
        </div>
    );
}