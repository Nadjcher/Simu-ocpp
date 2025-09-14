// src/components/SmartChargingPanel.tsx

import React, { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Send, Calendar, Zap, Clock, ChevronDown, ChevronUp, Copy, Download } from 'lucide-react';
import { OCPPChargingProfilesManager, ChargingProfile, ChargingSchedulePeriod } from '../services/OCPPChargingProfilesManager';

interface SmartChargingPanelProps {
    profilesManager: OCPPChargingProfilesManager;
    onSendProfile?: (connectorId: number, profile: ChargingProfile) => void;
    onClearProfile?: (criteria: any) => void;
    sessionId?: string;
}

export const SmartChargingPanel: React.FC<SmartChargingPanelProps> = ({
                                                                          profilesManager,
                                                                          onSendProfile,
                                                                          onClearProfile,
                                                                          sessionId
                                                                      }) => {
    // État du panneau
    const [expanded, setExpanded] = useState(true);
    const [activeTab, setActiveTab] = useState<'create' | 'active' | 'history'>('create');

    // Configuration du profil
    const [connectorId, setConnectorId] = useState(1);
    const [profileId, setProfileId] = useState(Date.now() % 10000);
    const [stackLevel, setStackLevel] = useState(0);
    const [profilePurpose, setProfilePurpose] = useState<'ChargePointMaxProfile' | 'TxDefaultProfile' | 'TxProfile'>('TxProfile');
    const [profileKind, setProfileKind] = useState<'Absolute' | 'Recurring' | 'Relative'>('Absolute');
    const [recurrencyKind, setRecurrencyKind] = useState<'Daily' | 'Weekly'>('Daily');
    const [validFrom, setValidFrom] = useState('');
    const [validTo, setValidTo] = useState('');
    const [chargingRateUnit, setChargingRateUnit] = useState<'W' | 'A'>('A');
    const [minChargingRate, setMinChargingRate] = useState<number | undefined>(undefined);
    const [schedules, setSchedules] = useState<ChargingSchedulePeriod[]>([
        { startPeriod: 0, limit: 32, numberPhases: 1 }
    ]);

    // État temps réel
    const [currentLimit, setCurrentLimit] = useState({ limitW: 0, source: 'default' });
    const [activeProfiles, setActiveProfiles] = useState<ChargingProfile[]>([]);
    const [nextChange, setNextChange] = useState<number | undefined>(undefined);
    const [logs, setLogs] = useState<string[]>([]);

    // Mise à jour périodique de l'état
    useEffect(() => {
        const updateState = () => {
            const state = profilesManager.getConnectorState(connectorId);
            setCurrentLimit({
                limitW: state.effectiveLimit.limitW,
                source: state.effectiveLimit.source
            });
            setActiveProfiles(state.profiles);
            setNextChange(state.effectiveLimit.nextChangeIn);
        };

        updateState();
        const interval = setInterval(updateState, 1000);
        return () => clearInterval(interval);
    }, [profilesManager, connectorId]);

    // Gestion des périodes
    const addSchedulePeriod = () => {
        const lastPeriod = schedules[schedules.length - 1];
        setSchedules([...schedules, {
            startPeriod: lastPeriod.startPeriod + 3600,
            limit: chargingRateUnit === 'A' ? 32 : 11000,
            numberPhases: 1
        }]);
    };

    const removeSchedulePeriod = (index: number) => {
        if (schedules.length > 1) {
            setSchedules(schedules.filter((_, i) => i !== index));
        }
    };

    const updateSchedulePeriod = (index: number, field: keyof ChargingSchedulePeriod, value: number) => {
        const newSchedules = [...schedules];
        newSchedules[index] = { ...newSchedules[index], [field]: value };
        setSchedules(newSchedules);
    };

    // Construction et envoi du profil
    const buildProfile = (): ChargingProfile => {
        return profilesManager.createProfile({
            connectorId,
            chargingProfileId: profileId,
            stackLevel,
            purpose: profilePurpose,
            kind: profileKind,
            recurrencyKind: profileKind === 'Recurring' ? recurrencyKind : undefined,
            validFrom: profileKind === 'Recurring' ? validFrom : undefined,
            validTo: profileKind === 'Recurring' ? validTo : undefined,
            chargingRateUnit,
            minChargingRate,
            periods: schedules
        });
    };

    const handleSendProfile = () => {
        const profile = buildProfile();
        const result = profilesManager.setChargingProfile(connectorId, profile);

        if (result.status === 'Accepted') {
            const logEntry = `[${new Date().toLocaleTimeString()}] ✅ Profile ${profile.chargingProfileId} appliqué (${profilePurpose}, stack ${stackLevel})`;
            setLogs(prev => [...prev.slice(-49), logEntry]);
            setProfileId(Date.now() % 10000); // Nouveau ID pour le prochain

            if (onSendProfile) {
                onSendProfile(connectorId, profile);
            }
        }
    };

    const handleClearProfile = (profileIdToClear?: number) => {
        const criteria = profileIdToClear ? { id: profileIdToClear } : { connectorId };
        const result = profilesManager.clearChargingProfile(criteria);

        const logEntry = `[${new Date().toLocaleTimeString()}] 🗑️ ${result.cleared.length} profil(s) supprimé(s)`;
        setLogs(prev => [...prev.slice(-49), logEntry]);

        if (onClearProfile) {
            onClearProfile(criteria);
        }
    };

    const exportProfiles = () => {
        const state = profilesManager.exportState();
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `charging-profiles-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    };

    return (
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-blue-600 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur">
                            <Settings className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">Smart Charging Control</h3>
                            <p className="text-sm text-white/80">OCPP 1.6 Charging Profiles Manager</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        {expanded ? <ChevronUp className="w-5 h-5 text-white" /> : <ChevronDown className="w-5 h-5 text-white" />}
                    </button>
                </div>

                {/* État actuel */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="bg-white/10 backdrop-blur rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-yellow-300" />
                            <span className="text-xs text-white/70">Limite Active</span>
                        </div>
                        <div className="text-2xl font-bold text-white">
                            {(currentLimit.limitW / 1000).toFixed(1)} kW
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                            Source: {currentLimit.source}
                        </div>
                    </div>

                    <div className="bg-white/10 backdrop-blur rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Settings className="w-4 h-4 text-blue-300" />
                            <span className="text-xs text-white/70">Profils Actifs</span>
                        </div>
                        <div className="text-2xl font-bold text-white">
                            {activeProfiles.length}
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                            {activeProfiles.filter(p => p.chargingProfileKind === 'Recurring').length} récurrents
                        </div>
                    </div>

                    <div className="bg-white/10 backdrop-blur rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-4 h-4 text-green-300" />
                            <span className="text-xs text-white/70">Prochain Changement</span>
                        </div>
                        <div className="text-2xl font-bold text-white">
                            {nextChange ? formatDuration(nextChange) : '--'}
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                            {nextChange ? 'avant modification' : 'stable'}
                        </div>
                    </div>
                </div>
            </div>

            {expanded && (
                <div className="p-4">
                    {/* Tabs */}
                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={() => setActiveTab('create')}
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${
                                activeTab === 'create'
                                    ? 'bg-emerald-600 text-white shadow-lg'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            Créer Profil
                        </button>
                        <button
                            onClick={() => setActiveTab('active')}
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${
                                activeTab === 'active'
                                    ? 'bg-emerald-600 text-white shadow-lg'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            Profils Actifs ({activeProfiles.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${
                                activeTab === 'history'
                                    ? 'bg-emerald-600 text-white shadow-lg'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            Historique
                        </button>
                    </div>

                    {/* Contenu des tabs */}
                    {activeTab === 'create' && (
                        <div className="space-y-4">
                            {/* Configuration de base */}
                            <div className="bg-gray-700/50 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-gray-300 mb-3">Configuration de Base</h4>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Connector ID</label>
                                        <input
                                            type="number"
                                            value={connectorId}
                                            onChange={(e) => setConnectorId(Number(e.target.value))}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                            min={0}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Profile ID</label>
                                        <input
                                            type="number"
                                            value={profileId}
                                            onChange={(e) => setProfileId(Number(e.target.value))}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Stack Level</label>
                                        <input
                                            type="number"
                                            value={stackLevel}
                                            onChange={(e) => setStackLevel(Number(e.target.value))}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                            min={0}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Profile Purpose</label>
                                        <select
                                            value={profilePurpose}
                                            onChange={(e) => setProfilePurpose(e.target.value as any)}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                        >
                                            <option value="ChargePointMaxProfile">ChargePoint Max</option>
                                            <option value="TxDefaultProfile">Tx Default</option>
                                            <option value="TxProfile">Tx Profile</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Profile Kind</label>
                                        <select
                                            value={profileKind}
                                            onChange={(e) => setProfileKind(e.target.value as any)}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                        >
                                            <option value="Absolute">Absolute</option>
                                            <option value="Recurring">Recurring</option>
                                            <option value="Relative">Relative</option>
                                        </select>
                                    </div>
                                </div>

                                {profileKind === 'Recurring' && (
                                    <div className="grid grid-cols-3 gap-3 mt-3">
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Recurrency</label>
                                            <select
                                                value={recurrencyKind}
                                                onChange={(e) => setRecurrencyKind(e.target.value as any)}
                                                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                            >
                                                <option value="Daily">Daily</option>
                                                <option value="Weekly">Weekly</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Valid From</label>
                                            <input
                                                type="datetime-local"
                                                value={validFrom}
                                                onChange={(e) => setValidFrom(e.target.value)}
                                                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Valid To</label>
                                            <input
                                                type="datetime-local"
                                                value={validTo}
                                                onChange={(e) => setValidTo(e.target.value)}
                                                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Configuration de charge */}
                            <div className="bg-gray-700/50 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-gray-300 mb-3">Configuration de Charge</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Charging Rate Unit</label>
                                        <select
                                            value={chargingRateUnit}
                                            onChange={(e) => setChargingRateUnit(e.target.value as 'W' | 'A')}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                        >
                                            <option value="W">Watts</option>
                                            <option value="A">Ampères</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Min Charging Rate (optionnel)</label>
                                        <input
                                            type="number"
                                            value={minChargingRate || ''}
                                            onChange={(e) => setMinChargingRate(e.target.value ? Number(e.target.value) : undefined)}
                                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
                                            placeholder="Minimum..."
                                        />
                                    </div>
                                </div>

                                {/* Schedule Periods */}
                                <div className="mt-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-xs text-gray-400">Schedule Periods</label>
                                        <button
                                            onClick={addSchedulePeriod}
                                            className="p-1.5 bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
                                        >
                                            <Plus className="w-4 h-4 text-white" />
                                        </button>
                                    </div>
                                    <div className="space-y-2 max-h-64 overflow-y-auto">
                                        {schedules.map((period, index) => (
                                            <div key={index} className="flex items-center gap-2 bg-gray-800 p-3 rounded-lg">
                                                <div className="flex-1">
                                                    <input
                                                        type="number"
                                                        value={period.startPeriod}
                                                        onChange={(e) => updateSchedulePeriod(index, 'startPeriod', Number(e.target.value))}
                                                        className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                                        placeholder="Start (s)"
                                                    />
                                                    <span className="text-xs text-gray-500 mt-1">
                            {formatDuration(period.startPeriod)}
                          </span>
                                                </div>
                                                <div className="flex-1">
                                                    <input
                                                        type="number"
                                                        value={period.limit}
                                                        onChange={(e) => updateSchedulePeriod(index, 'limit', Number(e.target.value))}
                                                        className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                                        placeholder="Limit"
                                                    />
                                                    <span className="text-xs text-gray-500 mt-1">
                            {period.limit} {chargingRateUnit}
                          </span>
                                                </div>
                                                {chargingRateUnit === 'A' && (
                                                    <div className="w-20">
                                                        <input
                                                            type="number"
                                                            value={period.numberPhases || 1}
                                                            onChange={(e) => updateSchedulePeriod(index, 'numberPhases', Number(e.target.value))}
                                                            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                                                            placeholder="Ph"
                                                            min={1}
                                                            max={3}
                                                        />
                                                        <span className="text-xs text-gray-500 mt-1">phases</span>
                                                    </div>
                                                )}
                                                {schedules.length > 1 && (
                                                    <button
                                                        onClick={() => removeSchedulePeriod(index)}
                                                        className="p-1.5 bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                                                    >
                                                        <Trash2 className="w-3 h-3 text-white" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleSendProfile}
                                    className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-600 to-blue-600 text-white rounded-lg hover:shadow-lg transition-all flex items-center justify-center gap-2 font-medium"
                                >
                                    <Send className="w-4 h-4" />
                                    Envoyer Profile
                                </button>
                                <button
                                    onClick={() => handleClearProfile()}
                                    className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all"
                                >
                                    Clear All
                                </button>
                                <button
                                    onClick={exportProfiles}
                                    className="px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all"
                                >
                                    <Download className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'active' && (
                        <div className="space-y-3">
                            {activeProfiles.length === 0 ? (
                                <div className="text-center py-8 text-gray-400">
                                    Aucun profil actif
                                </div>
                            ) : (
                                activeProfiles.map((profile) => (
                                    <div key={profile.chargingProfileId} className="bg-gray-700/50 rounded-lg p-4">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                          <span className="text-lg font-semibold text-white">
                            Profile #{profile.chargingProfileId}
                          </span>
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                        profile.chargingProfilePurpose === 'TxProfile'
                                                            ? 'bg-green-600 text-white'
                                                            : profile.chargingProfilePurpose === 'TxDefaultProfile'
                                                                ? 'bg-blue-600 text-white'
                                                                : 'bg-amber-600 text-white'
                                                    }`}>
                            {profile.chargingProfilePurpose}
                          </span>
                                                    <span className="px-2 py-1 bg-gray-600 text-gray-200 rounded text-xs">
                            {profile.chargingProfileKind}
                          </span>
                                                    <span className="px-2 py-1 bg-gray-600 text-gray-200 rounded text-xs">
                            Stack: {profile.stackLevel}
                          </span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4 mt-3">
                                                    <div>
                                                        <span className="text-xs text-gray-400">Schedule</span>
                                                        <div className="mt-1 space-y-1">
                                                            {profile.chargingSchedule.chargingSchedulePeriod.map((period, idx) => (
                                                                <div key={idx} className="text-sm text-gray-300">
                                                                    {formatDuration(period.startPeriod)}: {period.limit}{profile.chargingSchedule.chargingRateUnit}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    {profile.chargingProfileKind === 'Recurring' && (
                                                        <div>
                                                            <span className="text-xs text-gray-400">Récurrence</span>
                                                            <div className="text-sm text-gray-300 mt-1">
                                                                {profile.recurrencyKind}
                                                                {profile.validFrom && (
                                                                    <div className="text-xs">De: {new Date(profile.validFrom).toLocaleString()}</div>
                                                                )}
                                                                {profile.validTo && (
                                                                    <div className="text-xs">À: {new Date(profile.validTo).toLocaleString()}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => handleClearProfile(profile.chargingProfileId)}
                                                className="ml-3 p-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="bg-gray-900 rounded-lg p-3 h-64 overflow-y-auto">
                            {logs.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-4">Aucune activité</p>
                            ) : (
                                logs.map((log, i) => (
                                    <div key={i} className="text-xs text-gray-300 font-mono py-1 border-b border-gray-800">
                                        {log}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SmartChargingPanel;