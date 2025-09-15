import React, { useState } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { SessionPanel } from './SessionPanel';
import { Plus, X, Wifi, WifiOff, Battery, Zap } from 'lucide-react';

export function SessionList() {
    const sessions = useSessionStore(state => state.sessions);
    const createSession = useSessionStore(state => state.createSession);
    const deleteSession = useSessionStore(state => state.deleteSession);
    const updateSession = useSessionStore(state => state.updateSession);
    const [selectedTab, setSelectedTab] = useState<string | null>(null);

    const handleCreateSession = async () => {
        const count = sessions.length + 1;
        const session = await createSession(`Session ${count}`);
        setSelectedTab(session.id);
    };

    return (
        <div className="space-y-4">
            {/* Header avec bouton création */}
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Gestion des Sessions</h2>
                <button
                    onClick={handleCreateSession}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} />
                    Nouvelle session
                </button>
            </div>

            {/* Onglets des sessions */}
            {sessions.length > 0 ? (
                <div>
                    <div className="flex gap-2 border-b border-gray-700 overflow-x-auto">
                        {sessions.map(session => (
                            <div
                                key={session.id}
                                className={`flex items-center gap-2 px-4 py-2 cursor-pointer rounded-t-lg transition-colors ${
                                    selectedTab === session.id
                                        ? 'bg-gray-700 text-white'
                                        : 'bg-gray-800 text-gray-400 hover:bg-gray-750'
                                }`}
                                onClick={() => setSelectedTab(session.id)}
                            >
                                <div className="flex items-center gap-2">
                                    {session.connected ? (
                                        <Wifi size={16} className="text-green-400" />
                                    ) : (
                                        <WifiOff size={16} className="text-gray-500" />
                                    )}
                                    <span>{session.title}</span>
                                    {session.charging && (
                                        <Zap size={16} className="text-yellow-400 animate-pulse" />
                                    )}
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSession(session.id);
                                        if (selectedTab === session.id) {
                                            setSelectedTab(sessions[0]?.id || null);
                                        }
                                    }}
                                    className="ml-2 text-gray-500 hover:text-red-400"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Contenu de la session sélectionnée */}
                    {selectedTab && (
                        <div className="mt-4">
                            {sessions
                                .filter(s => s.id === selectedTab)
                                .map(session => (
                                    <SessionPanel
                                        key={session.id}
                                        session={session}
                                        onUpdate={(updates) => updateSession(session.id, updates)}
                                    />
                                ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-12 bg-gray-800 rounded-lg">
                    <p className="text-gray-400 mb-4">Aucune session active</p>
                    <button
                        onClick={handleCreateSession}
                        className="btn-primary"
                    >
                        Créer la première session
                    </button>
                </div>
            )}
        </div>
    );
}