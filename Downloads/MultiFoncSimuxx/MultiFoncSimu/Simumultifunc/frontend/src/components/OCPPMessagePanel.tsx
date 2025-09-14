// frontend/src/components/OCPPMessagePanel.tsx
import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { MessageSquare, Send, ArrowUp, ArrowDown, Filter } from 'lucide-react';

export function OCPPMessagePanel() {
    const { ocppMessages } = useAppStore();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');

    const filteredMessages = ocppMessages.filter(msg => {
        if (filter !== 'all' && msg.direction !== filter) return false;
        if (searchTerm && !JSON.stringify(msg).toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
    });

    return (
        <div className="h-full flex flex-col bg-white rounded-lg shadow">
            {/* Header */}
            <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <MessageSquare className="text-blue-600" />
                        Messages OCPP
                    </h2>

                    <div className="flex items-center gap-3">
                        <input
                            type="text"
                            placeholder="Rechercher..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="px-3 py-1 border rounded"
                        />

                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="px-3 py-1 border rounded"
                        >
                            <option value="all">Tous</option>
                            <option value="SENT">Envoyés</option>
                            <option value="RECEIVED">Reçus</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Messages List */}
            <div className="flex-1 overflow-auto p-4">
                <div className="space-y-2">
                    {filteredMessages.map((message, index) => (
                        <div
                            key={index}
                            className={`p-3 rounded border ${
                                message.direction === 'SENT'
                                    ? 'bg-blue-50 border-blue-200'
                                    : 'bg-green-50 border-green-200'
                            }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    {message.direction === 'SENT' ? (
                                        <ArrowUp className="text-blue-600" size={16} />
                                    ) : (
                                        <ArrowDown className="text-green-600" size={16} />
                                    )}
                                    <span className="font-medium">{message.action}</span>
                                    <span className="text-xs text-gray-500">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                                </div>
                                <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                  {message.sessionId}
                </span>
                            </div>

                            <div className="mt-2 text-sm font-mono bg-white p-2 rounded">
                                <pre>{JSON.stringify(message.payload, null, 2)}</pre>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}