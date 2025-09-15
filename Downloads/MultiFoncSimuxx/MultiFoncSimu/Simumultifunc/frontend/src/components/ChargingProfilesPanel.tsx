// src/components/ChargingProfilesPanel.tsx
import React from 'react';
import type { OCPPChargingProfilesManager, ChargingProfilePurposeType } from '@/services/OCPPChargingProfilesManager';

type Props = {
  manager: OCPPChargingProfilesManager;
  connectorId: number;
  onClear?: (purpose?: ChargingProfilePurposeType) => void;
};

export default function ChargingProfilesPanel({ manager, connectorId, onClear }: Props) {
  const { profiles, effectiveLimit, history } = manager.getConnectorState(connectorId);

  return (
    <div className="rounded border p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">Smart Charging (OCPP 1.6)</div>
        <div className="text-sm">
          Limite effective:&nbsp;
          <span className="font-bold">{(effectiveLimit.limitW / 1000).toFixed(1)} kW</span>
          <span className="ml-2 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">
            {effectiveLimit.purpose}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button className="px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 text-sm"
                onClick={() => onClear?.()}>
          Clear ALL
        </button>
        <button className="px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 text-sm"
                onClick={() => onClear?.('TxProfile')}>
          Clear TxProfile
        </button>
        <button className="px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 text-sm"
                onClick={() => onClear?.('TxDefaultProfile')}>
          Clear TxDefaultProfile
        </button>
      </div>

      <div className="mt-3">
        <div className="text-xs text-slate-500 mb-1">Profils actifs</div>
        <div className="space-y-1">
          {profiles.length === 0 && <div className="text-sm text-slate-500">Aucun profil.</div>}
          {profiles.map(p => (
            <div key={p.chargingProfileId} className="text-sm px-2 py-1 rounded bg-slate-50 border">
              <span className="font-mono mr-2">#{p.chargingProfileId}</span>
              <span className="px-1 py-0.5 text-xs rounded bg-slate-200 mr-2">{p.chargingProfilePurpose}</span>
              <span className="px-1 py-0.5 text-xs rounded bg-slate-200 mr-2">stack {p.stackLevel}</span>
              <span className="text-slate-600">
                {(p.chargingSchedule.chargingSchedulePeriod?.[0]?.limit ?? 0)} {p.chargingSchedule.chargingRateUnit}
              </span>
              {p.transactionId != null && <span className="ml-2 text-slate-500 text-xs">txId {p.transactionId}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-slate-500 mb-1">Historique</div>
        <div className="max-h-32 overflow-y-auto text-xs font-mono bg-slate-50 border rounded p-2">
          {history.slice(-10).map((e, i) => (
            <div key={i}>
              [{new Date(e.timestamp).toLocaleTimeString()}] {e.type} → {((e.newLimit ?? 0) / 1000).toFixed(1)} kW &nbsp;{e.reason}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
