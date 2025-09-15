
import React, { useState, useEffect } from 'react';

interface PhasingConfig {
    evsePhases: number;
    vehicleActivePhases: number;
    powerPerPhase: number;
}

interface PhasingSectionProps {
    sessionId: string | null;
    disabled?: boolean;
    apiBase?: string;
}

const PhasingSection: React.FC<PhasingSectionProps> = ({
                                                           sessionId,
                                                           disabled = false,
                                                           apiBase = "http://localhost:8877"
                                                       }) => {
    const [phasingConfig, setPhasingConfig] = useState<PhasingConfig>({
        evsePhases: 3,
        vehicleActivePhases: 3,
        powerPerPhase: 16
    });

    const [loading, setLoading] = useState(false);
    const [applied, setApplied] = useState(false);

    const updatePhasing = async () => {
        if (!sessionId) return;

        setLoading(true);
        try {
            const response = await fetch(`${apiBase}/api/simu/${sessionId}/phasing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(phasingConfig)
            });
            const result = await response.json();
            console.log('Phasage configuré:', result);
            setApplied(true);
            setTimeout(() => setApplied(false), 2000);
        } catch (error) {
            console.error('Erreur configuration phasage:', error);
        }
        setLoading(false);
    };

    // Validation pour empêcher véhicule > EVSE
    useEffect(() => {
        if (phasingConfig.vehicleActivePhases > phasingConfig.evsePhases) {
            setPhasingConfig(prev => ({
                ...prev,
                vehicleActivePhases: prev.evsePhases
            }));
        }
    }, [phasingConfig.evsePhases]);

    return (
        <div className="rounded border bg-white p-4 shadow-sm">
            <div className="font-semibold mb-3 text-purple-700">
                ⚡ Test Régulation par Phasage
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <div className="text-xs mb-1 text-slate-600">EVSE Phases</div>
                    <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={phasingConfig.evsePhases}
                        onChange={(e) => setPhasingConfig({
                            ...phasingConfig,
                            evsePhases: parseInt(e.target.value)
                        })}
                        disabled={disabled || loading}
                    >
                        <option value="1">Mono (1ph)</option>
                        <option value="3">Tri (3ph)</option>
                    </select>
                </div>

                <div>
                    <div className="text-xs mb-1 text-slate-600">Véhicule Phases</div>
                    <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={phasingConfig.vehicleActivePhases}
                        onChange={(e) => setPhasingConfig({
                            ...phasingConfig,
                            vehicleActivePhases: parseInt(e.target.value)
                        })}
                        disabled={disabled || loading}
                    >
                        <option value="1">1 phase</option>
                        {phasingConfig.evsePhases >= 2 &&
                            <option value="2">2 phases</option>
                        }
                        {phasingConfig.evsePhases >= 3 &&
                            <option value="3">3 phases</option>
                        }
                    </select>
                </div>

                <div>
                    <div className="text-xs mb-1 text-slate-600">Courant/phase (A)</div>
                    <input
                        type="number"
                        min="6"
                        max="63"
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={phasingConfig.powerPerPhase}
                        onChange={(e) => setPhasingConfig({
                            ...phasingConfig,
                            powerPerPhase: parseInt(e.target.value) || 16
                        })}
                        disabled={disabled || loading}
                    />
                </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
                <div className="text-sm">
                    <span className="text-slate-600">Puissance: </span>
                    <span className="font-bold text-purple-700">
            {(phasingConfig.vehicleActivePhases *
                phasingConfig.powerPerPhase * 230 / 1000).toFixed(1)} kW
          </span>
                </div>

                <button
                    onClick={updatePhasing}
                    disabled={disabled || loading || !sessionId}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                        applied
                            ? 'bg-green-600 text-white'
                            : 'bg-purple-600 text-white hover:bg-purple-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {loading ? 'Application...' : applied ? '✓ Appliqué' : 'Appliquer Phasage'}
                </button>
            </div>

            <div className="mt-2 text-xs text-slate-500 bg-purple-50 p-2 rounded">
                Configure le nombre de phases actives pour tester la régulation SCP.
                Le véhicule simulera {phasingConfig.vehicleActivePhases} phase(s) active(s)
                avec {phasingConfig.powerPerPhase}A par phase.
            </div>
        </div>
    );
};

export default PhasingSection;