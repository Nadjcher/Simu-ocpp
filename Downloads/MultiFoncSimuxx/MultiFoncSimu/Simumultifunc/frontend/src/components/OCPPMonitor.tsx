import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
    MessageSquare, Trash2, Filter, Download,
    ArrowUp, ArrowDown, Clock
} from 'lucide-react';

export function OCPPMonitor() {
    const { ocppMessages, sessions, selectedSessionId } = useAppStore();
    const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedAction, setSelectedAction] = useState<string>('all');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const filteredMessages = ocppMessages.filter(msg => {
        if (filter !== 'all' && msg.direction.toLowerCase() !== filter) return false;
        if (selectedSessionId && msg.sessionId !== selectedSessionId) return false;
        if (selectedAction !== 'all' && msg.action !== selectedAction) return false;
        if (searchTerm && !JSON.stringify(msg.payload).toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
    });

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [filteredMessages]);

    const getMessageIcon = (direction: string) => {
        return direction === 'SENT' ? <ArrowUp size={16} /> : <ArrowDown size={16} />;
    };

    const getMessageColor = (action: string) => {
        switch (action) {
            case 'BootNotification': return 'text-blue-400';
            case 'Authorize': return 'text-yellow-400';
            case 'StartTransaction': return 'text-green-400';
            case 'StopTransaction': return 'text-red-400';
            case 'Heartbeat': return 'text-gray-400';
            case 'MeterValues': return 'text-purple-400';
            default: return 'text-white';
        }
    };

    const clearMessages = () => {
        // TODO: Implement clear messages in store
    };

    const exportMessages = () => {
        const dataStr = JSON.stringify(filteredMessages, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = `ocpp-messages-${Date.now()}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    };

    const uniqueActions = Array.from(new Set(ocppMessages.map(msg => msg.action)));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Moniteur OCPP</h2>
                <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            {filteredMessages.length} messages
          </span>
                    <button
                        onClick={clearMessages}
                        className="p-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                        title="Effacer les messages"
                    >
                        <Trash2 size={18} />
                    </button>
                    <button
                        onClick={exportMessages}
                        className="p-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
                        title="Exporter les messages"
                    >
                        <Download size={18} />
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Filter size={18} className="text-gray-400" />
                        <span className="text-sm text-gray-400">Filtrer:</span>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                                filter === 'all'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                            }`}
                        >
                            Tous
                        </button>
                        <button
                            onClick={() => setFilter('sent')}
                            className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                                filter === 'sent'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                            }`}
                        >
                            <ArrowUp size={14} className="inline mr-1" />
                            Envoyés
                        </button>
                        <button
                            onClick={() => setFilter('received')}
                            className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                                filter === 'received'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                            }`}
                        >
                            <ArrowDown size={14} className="inline mr-1" />
                            Reçus
                        </button>
                    </div>

                    <select
                        value={selectedAction}
                        onChange={(e) => setSelectedAction(e.target.value)}
                        className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                        <option value="all">Toutes les actions</option>
                        {uniqueActions.map(action => (
                            <option key={action} value={action}>{action}</option>
                        ))}
                    </select>

                    <select
                        value={selectedSessionId || 'all'}
                        onChange={(e) => useAppStore.getState().selectSession(e.target.value === 'all' ? null : e.target.value)}
                        className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                        <option value="all">Toutes les sessions</option>
                        {sessions.map(session => (
                            <option key={session.id} value={session.id}>{session.title}</option>
                        ))}
                    </select>

                    <input
                        type="text"
                        placeholder="Rechercher dans les payloads..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="flex-1 px-3 py-1 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            {/* Messages List */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
                <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full">
                        <thead className="bg-gray-700 sticky top-0">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Temps</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Direction</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Session</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Payload</th>
                        </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                        {filteredMessages.map((msg, index) => (
                            <tr key={index} className="hover:bg-gray-700/50">
                                <td className="px-4 py-2 text-xs text-gray-400">
                                    <div className="flex items-center gap-1">
                                        <Clock size={12} />
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </div>
                                </td>
                                <td className="px-4 py-2">
                                    <div className={`flex items-center gap-1 ${
                                        msg.direction === 'SENT' ? 'text-blue-400' : 'text-green-400'
                                    }`}>
                                        {getMessageIcon(msg.direction)}
                                        <span className="text-xs font-medium">{msg.direction}</span>
                                    </div>
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-300">
                                    {sessions.find(s => s.id === msg.sessionId)?.title || msg.sessionId}
                                </td>
                                <td className="px-4 py-2">
                    <span className={`text-sm font-medium ${getMessageColor(msg.action)}`}>
                      {msg.action}
                    </span>
                                </td>
                                <td className="px-4 py-2">
                                    <details className="cursor-pointer">
                                        <summary className="text-xs text-gray-400 hover:text-white">
                                            {JSON.stringify(msg.payload).substring(0, 50)}...
                                        </summary>
                                        <pre className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-300 overflow-x-auto">
                        {JSON.stringify(msg.payload, null, 2)}
                      </pre>
                                    </details>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                    {filteredMessages.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                            <MessageSquare size={48} className="mx-auto mb-2 opacity-50" />
                            <p>Aucun message OCPP</p>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm mb-1">Messages envoyés</div>
                    <div className="text-2xl font-bold text-blue-400">
                        {ocppMessages.filter(m => m.direction === 'SENT').length}
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm mb-1">Messages reçus</div>
                    <div className="text-2xl font-bold text-green-400">
                        {ocppMessages.filter(m => m.direction === 'RECEIVED').length}
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm mb-1">Transactions actives</div>
                    <div className="text-2xl font-bold text-yellow-400">
                        {sessions.filter(s => s.transactionId).length}
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm mb-1">Sessions connectées</div>
                    <div className="text-2xl font-bold text-purple-400">
                        {sessions.filter(s => s.connected).length}
                    </div>
                </div>
            </div>
        </div>
    );
}