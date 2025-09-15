import React, { useState, useEffect, useRef } from 'react';
import { LogEntry } from '@/types';
import { useSessionStore } from '@/store/sessionStore';
import {
    Filter,
    Download,
    Trash2,
    Search,
    AlertCircle,
    Info,
    AlertTriangle,
    XCircle,
    CheckCircle
} from 'lucide-react';

export function LogViewer() {
    const sessions = useSessionStore(state => state.sessions);
    const [filter, setFilter] = useState({
        level: 'ALL',
        sessionId: 'ALL',
        search: ''
    });
    const [autoScroll, setAutoScroll] = useState(true);
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Combiner tous les logs de toutes les sessions
    const getAllLogs = (): LogEntry[] => {
        const allLogs: LogEntry[] = [];
        sessions.forEach(session => {
            session.logs.forEach(log => {
                allLogs.push({ ...log, sessionId: session.id });
            });
        });
        return allLogs.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    };

    const filteredLogs = getAllLogs().filter(log => {
        if (filter.level !== 'ALL' && log.level !== filter.level) return false;
        if (filter.sessionId !== 'ALL' && log.sessionId !== filter.sessionId) return false;
        if (filter.search && !log.message.toLowerCase().includes(filter.search.toLowerCase())) return false;
        return true;
    });

    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [filteredLogs, autoScroll]);

    const getLogIcon = (level: string) => {
        switch (level) {
            case 'DEBUG': return <Info size={16} className="text-gray-400" />;
            case 'INFO': return <CheckCircle size={16} className="text-blue-400" />;
            case 'WARNING': return <AlertTriangle size={16} className="text-yellow-400" />;
            case 'ERROR': return <XCircle size={16} className="text-red-400" />;
            case 'CRITICAL': return <AlertCircle size={16} className="text-red-600" />;
            default: return <Info size={16} className="text-gray-400" />;
        }
    };

    const getLogColor = (level: string) => {
        switch (level) {
            case 'DEBUG': return 'text-gray-400';
            case 'INFO': return 'text-blue-400';
            case 'WARNING': return 'text-yellow-400';
            case 'ERROR': return 'text-red-400';
            case 'CRITICAL': return 'text-red-600';
            default: return 'text-gray-400';
        }
    };

    const exportLogs = () => {
        const data = JSON.stringify(filteredLogs, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs-${new Date().toISOString()}.json`;
        a.click();
    };

    return (
        <div className="card h-full flex flex-col">
            {/* Header avec filtres */}
            <div className="border-b border-gray-700 pb-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Filter size={20} />
                        Visualiseur de logs
                    </h3>

                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={autoScroll}
                                onChange={(e) => setAutoScroll(e.target.checked)}
                            />
                            Auto-scroll
                        </label>

                        <button
                            onClick={exportLogs}
                            className="btn-secondary p-2"
                            title="Exporter les logs"
                        >
                            <Download size={16} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">Niveau</label>
                        <select
                            value={filter.level}
                            onChange={(e) => setFilter({ ...filter, level: e.target.value })}
                            className="input-field w-full text-sm"
                        >
                            <option value="ALL">Tous</option>
                            <option value="DEBUG">Debug</option>
                            <option value="INFO">Info</option>
                            <option value="WARNING">Warning</option>
                            <option value="ERROR">Error</option>
                            <option value="CRITICAL">Critical</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs text-gray-400 mb-1">Session</label>
                        <select
                            value={filter.sessionId}
                            onChange={(e) => setFilter({ ...filter, sessionId: e.target.value })}
                            className="input-field w-full text-sm"
                        >
                            <option value="ALL">Toutes</option>
                            {sessions.map(session => (
                                <option key={session.id} value={session.id}>
                                    {session.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Recherche</label>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={filter.search}
                                onChange={(e) => setFilter({ ...filter, search: e.target.value })}
                                className="input-field w-full pl-9 text-sm"
                                placeholder="Rechercher dans les messages..."
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Logs */}
            <div
                ref={logContainerRef}
                className="flex-1 overflow-y-auto bg-gray-900 rounded-lg p-3 font-mono text-xs"
            >
                {filteredLogs.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                        Aucun log à afficher
                    </div>
                ) : (
                    filteredLogs.map((log, index) => (
                        <div
                            key={index}
                            className="flex items-start gap-2 py-1 hover:bg-gray-800 px-2 rounded"
                        >
                            {getLogIcon(log.level)}
                            <span className="text-gray-500">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
                            <span className={`font-semibold ${getLogColor(log.level)}`}>
                [{log.level}]
              </span>
                            <span className="text-gray-400">
                {sessions.find(s => s.id === log.sessionId)?.title || log.sessionId}:
              </span>
                            <span className="text-gray-200 flex-1">
                {log.message}
              </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}