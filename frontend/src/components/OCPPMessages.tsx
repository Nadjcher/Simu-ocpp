// frontend/src/components/OCPPMessages.tsx
import React, { useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { api } from '../services/api';

export function OCPPMessages() {
    const { sessions } = useSessionStore();
    const [selectedSessionId, setSelectedSessionId] = useState('');
    const [msgUrl, setMsgUrl] = useState('wss://pp.total-ev-charge.com/ocpp/WebSocket');
    const [msgCpId, setMsgCpId] = useState('E00000G102');
    const [msgConnected, setMsgConnected] = useState(false);
    const [msgAction, setMsgAction] = useState('BootNotification');
    const [msgPreview, setMsgPreview] = useState('');
    const [msgResponse, setMsgResponse] = useState('');
    const [msgParams, setMsgParams] = useState<any>({});

    const buildOcppMessage = () => {
        const msgId = Date.now().toString();
        let payload: any = {};

        switch (msgAction) {
            case 'BootNotification':
                payload = {
                    chargePointModel: msgParams.model || 'PerfSim',
                    chargePointVendor: msgParams.vendor || 'SimCorp',
                    chargePointSerialNumber: msgParams.serial || msgCpId,
                    firmwareVersion: msgParams.firmware || '1.0.0'
                };
                break;
            case 'StatusNotification':
                payload = {
                    connectorId: msgParams.connectorId || 1,
                    status: msgParams.status || 'Available',
                    errorCode: msgParams.errorCode || 'NoError',
                    timestamp: new Date().toISOString()
                };
                break;
            case 'Authorize':
                payload = { idTag: msgParams.idTag || 'ID-TAG-123' };
                break;
            case 'StartTransaction':
                payload = {
                    connectorId: msgParams.connectorId || 1,
                    idTag: msgParams.idTag || 'ID-TAG-123',
                    meterStart: msgParams.meterStart || 0,
                    timestamp: new Date().toISOString()
                };
                break;
            case 'StopTransaction':
                payload = {
                    transactionId: msgParams.transactionId || 0,
                    meterStop: msgParams.meterStop || 0,
                    timestamp: new Date().toISOString(),
                    reason: msgParams.reason || 'Local'
                };
                break;
            case 'MeterValues':
                payload = {
                    connectorId: msgParams.connectorId || 1,
                    transactionId: msgParams.transactionId || 0,
                    meterValue: [{
                        timestamp: new Date().toISOString(),
                        sampledValue: [{
                            value: msgParams.value || '0',
                            context: 'Sample.Periodic',
                            measurand: msgParams.measurand || 'Energy.Active.Import.Register',
                            unit: msgParams.unit || 'Wh'
                        }]
                    }]
                };
                break;
            case 'Heartbeat':
                payload = {};
                break;
            case 'DataTransfer':
                payload = {
                    vendorId: msgParams.vendorId || 'com.vendor',
                    messageId: msgParams.messageId || 'custom',
                    data: msgParams.data || '{}'
                };
                break;
            case 'DiagnosticsStatusNotification':
                payload = {
                    status: msgParams.diagnosticsStatus || 'Idle'
                };
                break;
            case 'FirmwareStatusNotification':
                payload = {
                    status: msgParams.firmwareStatus || 'Idle'
                };
                break;
        }

        return `[2,"${msgId}","${msgAction}",${JSON.stringify(payload)}]`;
    };

    const handleConnect = async () => {
        if (!selectedSessionId) {
            setMsgResponse(prev => prev + '\n❌ Sélectionnez une session\n');
            return;
        }

        try {
            await api.connectSession(selectedSessionId);
            setMsgConnected(true);
            const timestamp = new Date().toLocaleTimeString();
            setMsgResponse(prev => prev + `\n[${timestamp}] ✅ Connecté avec succès\n`);
        } catch (error) {
            setMsgResponse(prev => prev + `\n❌ Erreur: ${error}\n`);
        }
    };

    const handleDisconnect = async () => {
        if (!selectedSessionId) return;

        try {
            await api.disconnectSession(selectedSessionId);
            setMsgConnected(false);
            const timestamp = new Date().toLocaleTimeString();
            setMsgResponse(prev => prev + `\n[${timestamp}] ❌ Déconnecté\n`);
        } catch (error) {
            setMsgResponse(prev => prev + `\n❌ Erreur: ${error}\n`);
        }
    };

    const sendOcppMessage = async () => {
        if (!selectedSessionId || !msgConnected) {
            setMsgResponse(prev => prev + '\n❌ Non connecté\n');
            return;
        }

        const message = buildOcppMessage();
        const timestamp = new Date().toLocaleTimeString();
        setMsgResponse(prev => prev + `\n[${timestamp}] >>> SENT ${msgAction}\n${message}\n`);

        try {
            const payload = JSON.parse(message)[3];
            const result = await api.sendOCPPMessage(selectedSessionId, msgAction, payload);

            const responseTime = new Date().toLocaleTimeString();
            setMsgResponse(prev => prev +
                `\n[${responseTime}] <<< RECV ${msgAction}Response\n${JSON.stringify(result, null, 2)}\n`
            );
        } catch (error) {
            setMsgResponse(prev => prev + `\n❌ Erreur: ${error}\n`);
        }
    };

    const handleActionChange = (action: string) => {
        setMsgAction(action);
        setMsgParams({});
        setMsgPreview('');
    };

    const handlePreview = () => {
        const message = buildOcppMessage();
        setMsgPreview(message);
    };

    return (
        <div className="p-6">
            <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Connexion</h3>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm mb-1">Session :</label>
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
                            <label className="block text-sm mb-1">CP-ID :</label>
                            <input
                                type="text"
                                value={msgCpId}
                                onChange={(e) => setMsgCpId(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-700 rounded"
                            />
                        </div>
                    </div>

                    <button
                        onClick={msgConnected ? handleDisconnect : handleConnect}
                        className={`px-4 py-2 rounded ${
                            msgConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                        disabled={!selectedSessionId}
                    >
                        {msgConnected ? 'Disconnect' : 'Connect'}
                    </button>
                    <span className="ml-4 text-sm">
            {msgConnected ? '🟢 Connecté' : '🔴 Déconnecté'}
          </span>

                    <hr className="my-6 border-gray-700" />

                    <h3 className="text-lg font-semibold mb-4">Message OCPP</h3>

                    <div className="mb-4">
                        <label className="block text-sm mb-1">Action OCPP :</label>
                        <select
                            value={msgAction}
                            onChange={(e) => handleActionChange(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 rounded"
                        >
                            <option value="BootNotification">BootNotification</option>
                            <option value="StatusNotification">StatusNotification</option>
                            <option value="Authorize">Authorize</option>
                            <option value="StartTransaction">StartTransaction</option>
                            <option value="StopTransaction">StopTransaction</option>
                            <option value="MeterValues">MeterValues</option>
                            <option value="Heartbeat">Heartbeat</option>
                            <option value="DataTransfer">DataTransfer</option>
                            <option value="DiagnosticsStatusNotification">DiagnosticsStatusNotification</option>
                            <option value="FirmwareStatusNotification">FirmwareStatusNotification</option>
                        </select>
                    </div>

                    <div className="bg-gray-700 p-4 rounded mb-4">
                        <h4 className="font-semibold mb-2">Paramètres</h4>
                        {msgAction === 'BootNotification' && (
                            <>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">chargePointModel:</label>
                                    <input
                                        type="text"
                                        value={msgParams.model || 'PerfSim'}
                                        onChange={(e) => setMsgParams({...msgParams, model: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">chargePointVendor:</label>
                                    <input
                                        type="text"
                                        value={msgParams.vendor || 'SimCorp'}
                                        onChange={(e) => setMsgParams({...msgParams, vendor: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">chargePointSerialNumber:</label>
                                    <input
                                        type="text"
                                        value={msgParams.serial || msgCpId}
                                        onChange={(e) => setMsgParams({...msgParams, serial: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">firmwareVersion:</label>
                                    <input
                                        type="text"
                                        value={msgParams.firmware || '1.0.0'}
                                        onChange={(e) => setMsgParams({...msgParams, firmware: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                            </>
                        )}
                        {msgAction === 'StatusNotification' && (
                            <>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">connectorId:</label>
                                    <input
                                        type="number"
                                        value={msgParams.connectorId || 1}
                                        onChange={(e) => setMsgParams({...msgParams, connectorId: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">status:</label>
                                    <select
                                        value={msgParams.status || 'Available'}
                                        onChange={(e) => setMsgParams({...msgParams, status: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    >
                                        <option value="Available">Available</option>
                                        <option value="Preparing">Preparing</option>
                                        <option value="Charging">Charging</option>
                                        <option value="SuspendedEVSE">SuspendedEVSE</option>
                                        <option value="SuspendedEV">SuspendedEV</option>
                                        <option value="Finishing">Finishing</option>
                                        <option value="Reserved">Reserved</option>
                                        <option value="Unavailable">Unavailable</option>
                                        <option value="Faulted">Faulted</option>
                                    </select>
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">errorCode:</label>
                                    <select
                                        value={msgParams.errorCode || 'NoError'}
                                        onChange={(e) => setMsgParams({...msgParams, errorCode: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    >
                                        <option value="NoError">NoError</option>
                                        <option value="ConnectorLockFailure">ConnectorLockFailure</option>
                                        <option value="EVCommunicationError">EVCommunicationError</option>
                                        <option value="GroundFailure">GroundFailure</option>
                                        <option value="HighTemperature">HighTemperature</option>
                                        <option value="InternalError">InternalError</option>
                                        <option value="LocalListConflict">LocalListConflict</option>
                                        <option value="OtherError">OtherError</option>
                                        <option value="OverCurrentFailure">OverCurrentFailure</option>
                                        <option value="PowerMeterFailure">PowerMeterFailure</option>
                                        <option value="PowerSwitchFailure">PowerSwitchFailure</option>
                                        <option value="ReaderFailure">ReaderFailure</option>
                                        <option value="ResetFailure">ResetFailure</option>
                                        <option value="UnderVoltage">UnderVoltage</option>
                                        <option value="OverVoltage">OverVoltage</option>
                                        <option value="WeakSignal">WeakSignal</option>
                                    </select>
                                </div>
                            </>
                        )}
                        {msgAction === 'Authorize' && (
                            <div className="mb-2">
                                <label className="block text-sm mb-1">idTag:</label>
                                <input
                                    type="text"
                                    value={msgParams.idTag || 'ID-TAG-123'}
                                    onChange={(e) => setMsgParams({...msgParams, idTag: e.target.value})}
                                    className="w-full px-3 py-2 bg-gray-600 rounded"
                                />
                            </div>
                        )}
                        {msgAction === 'StartTransaction' && (
                            <>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">connectorId:</label>
                                    <input
                                        type="number"
                                        value={msgParams.connectorId || 1}
                                        onChange={(e) => setMsgParams({...msgParams, connectorId: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">idTag:</label>
                                    <input
                                        type="text"
                                        value={msgParams.idTag || 'ID-TAG-123'}
                                        onChange={(e) => setMsgParams({...msgParams, idTag: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">meterStart:</label>
                                    <input
                                        type="number"
                                        value={msgParams.meterStart || 0}
                                        onChange={(e) => setMsgParams({...msgParams, meterStart: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                            </>
                        )}
                        {msgAction === 'StopTransaction' && (
                            <>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">transactionId:</label>
                                    <input
                                        type="number"
                                        value={msgParams.transactionId || 0}
                                        onChange={(e) => setMsgParams({...msgParams, transactionId: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">meterStop:</label>
                                    <input
                                        type="number"
                                        value={msgParams.meterStop || 0}
                                        onChange={(e) => setMsgParams({...msgParams, meterStop: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">reason:</label>
                                    <select
                                        value={msgParams.reason || 'Local'}
                                        onChange={(e) => setMsgParams({...msgParams, reason: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    >
                                        <option value="Local">Local</option>
                                        <option value="Remote">Remote</option>
                                        <option value="EmergencyStop">EmergencyStop</option>
                                        <option value="EVDisconnected">EVDisconnected</option>
                                        <option value="HardReset">HardReset</option>
                                        <option value="PowerLoss">PowerLoss</option>
                                        <option value="Reboot">Reboot</option>
                                        <option value="SoftReset">SoftReset</option>
                                        <option value="UnlockCommand">UnlockCommand</option>
                                        <option value="DeAuthorized">DeAuthorized</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </>
                        )}
                        {msgAction === 'MeterValues' && (
                            <>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">connectorId:</label>
                                    <input
                                        type="number"
                                        value={msgParams.connectorId || 1}
                                        onChange={(e) => setMsgParams({...msgParams, connectorId: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">transactionId:</label>
                                    <input
                                        type="number"
                                        value={msgParams.transactionId || 0}
                                        onChange={(e) => setMsgParams({...msgParams, transactionId: parseInt(e.target.value)})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">value:</label>
                                    <input
                                        type="text"
                                        value={msgParams.value || '0'}
                                        onChange={(e) => setMsgParams({...msgParams, value: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">measurand:</label>
                                    <select
                                        value={msgParams.measurand || 'Energy.Active.Import.Register'}
                                        onChange={(e) => setMsgParams({...msgParams, measurand: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    >
                                        <option value="Energy.Active.Import.Register">Energy.Active.Import.Register</option>
                                        <option value="Power.Active.Import">Power.Active.Import</option>
                                        <option value="Power.Offered">Power.Offered</option>
                                        <option value="SoC">SoC</option>
                                        <option value="Current.Import">Current.Import</option>
                                        <option value="Voltage">Voltage</option>
                                        <option value="Temperature">Temperature</option>
                                    </select>
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">unit:</label>
                                    <select
                                        value={msgParams.unit || 'Wh'}
                                        onChange={(e) => setMsgParams({...msgParams, unit: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    >
                                        <option value="Wh">Wh</option>
                                        <option value="kWh">kWh</option>
                                        <option value="W">W</option>
                                        <option value="kW">kW</option>
                                        <option value="A">A</option>
                                        <option value="V">V</option>
                                        <option value="Celsius">Celsius</option>
                                        <option value="Percent">Percent</option>
                                    </select>
                                </div>
                            </>
                        )}
                        {msgAction === 'Heartbeat' && (
                            <div className="text-sm text-gray-400">Ce message n'a pas de payload</div>
                        )}
                        {msgAction === 'DataTransfer' && (
                            <>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">vendorId:</label>
                                    <input
                                        type="text"
                                        value={msgParams.vendorId || 'com.vendor'}
                                        onChange={(e) => setMsgParams({...msgParams, vendorId: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">messageId:</label>
                                    <input
                                        type="text"
                                        value={msgParams.messageId || 'custom'}
                                        onChange={(e) => setMsgParams({...msgParams, messageId: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                    />
                                </div>
                                <div className="mb-2">
                                    <label className="block text-sm mb-1">data:</label>
                                    <textarea
                                        value={msgParams.data || '{}'}
                                        onChange={(e) => setMsgParams({...msgParams, data: e.target.value})}
                                        className="w-full px-3 py-2 bg-gray-600 rounded"
                                        rows={3}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex space-x-2">
                        <button
                            onClick={handlePreview}
                            className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700"
                        >
                            Prévisualiser JSON
                        </button>
                        <button
                            onClick={sendOcppMessage}
                            className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
                            disabled={!msgConnected}
                        >
                            Envoyer
                        </button>
                        <button
                            onClick={() => setMsgResponse('')}
                            className="px-4 py-2 bg-red-600 rounded hover:bg-red-700"
                        >
                            Effacer logs
                        </button>
                    </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Prévisualisation JSON :</h3>
                    <pre className="bg-gray-900 p-4 rounded overflow-auto h-32 text-xs">
            {msgPreview || 'Cliquez sur "Prévisualiser JSON"'}
          </pre>

                    <hr className="my-6 border-gray-700" />

                    <h3 className="text-lg font-semibold mb-4">Réponse du serveur OCPP :</h3>
                    <pre className="bg-gray-900 p-4 rounded overflow-auto h-96 text-xs font-mono">
            {msgResponse || 'En attente d\'envoi...'}
          </pre>
                </div>
            </div>
        </div>
    );
}