// frontend/src/components/SimulGPM.tsx
import React from 'react';

export function SimulGPM() {
    return (
        <div className="p-6">
            <div className="max-w-4xl mx-auto bg-gray-800 rounded-lg p-6">
                <h2 className="text-2xl font-bold mb-4 text-center">GPM SIMULATEUR!</h2>

                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold mb-2">Modes de simulation :</h3>

                        <div className="space-y-4">
                            <div className="bg-gray-700 p-4 rounded">
                                <h4 className="font-semibold text-blue-400">1. WebSocket OCPP</h4>
                                <ul className="list-disc list-inside mt-2 text-sm">
                                    <li>Simulez un chargeur OCPP 1.6 réel</li>
                                    <li>URL : wss://&lt;votre-serveur&gt;/ocpp/WebSocket/&lt;CP-ID&gt;</li>
                                    <li>Gérez BootNotification, StatusNotification, MeterValues, Start/StopTransaction…</li>
                                    <li>Connexions WebSocket réelles, pas de mock</li>
                                </ul>
                            </div>

                            <div className="bg-gray-700 p-4 rounded">
                                <h4 className="font-semibold text-blue-400">2. OCPP Messages manuels</h4>
                                <ul className="list-disc list-inside mt-2 text-sm">
                                    <li>Composez et envoyez n'importe quel CALL OCPP</li>
                                    <li>Support complet OCPP 1.6 : BootNotification, Heartbeat, RemoteStart/Stop, GetConfiguration, etc.</li>
                                    <li>Visualisation des payloads JSON et des réponses</li>
                                </ul>
                            </div>

                            <div className="bg-gray-700 p-4 rounded">
                                <h4 className="font-semibold text-blue-400">3. Perf OCPP (batch CSV)</h4>
                                <ul className="list-disc list-inside mt-2 text-sm">
                                    <li>Importez un CSV de sessions (CP-ID, Token-ID)</li>
                                    <li>Lancez des centaines ou milliers de TRANSACTIONS simultanées</li>
                                    <li>Visualisez en temps réel le nombre de connexions actives</li>
                                    <li>Montée en charge adaptative automatique</li>
                                </ul>
                            </div>

                            <div className="bg-gray-700 p-4 rounded">
                                <h4 className="font-semibold text-blue-400">4. Smart Charging</h4>
                                <ul className="list-disc list-inside mt-2 text-sm">
                                    <li>Construisez vos ChargingProfiles (mono ou multi-périodes)</li>
                                    <li>Configuration complète : connectorId, profileId, stackLevel, purpose, kind, recurrency</li>
                                    <li>Définissez vos périodes (startPeriod, limit, phases)</li>
                                    <li>Envoyez en OCPP CALL ou via l'API EVP (avec evpId et Bearer token)</li>
                                </ul>
                            </div>

                            <div className="bg-gray-700 p-4 rounded">
                                <h4 className="font-semibold text-purple-400">5. TNR (Tests Non Régressifs)</h4>
                                <ul className="list-disc list-inside mt-2 text-sm">
                                    <li>Enregistrez des scénarios complets avec toutes les interactions</li>
                                    <li>Rejouez les scénarios de manière reproductible</li>
                                    <li>Comparez les résultats et détectez les régressions</li>
                                    <li>Validez automatiquement les réponses et latences</li>
                                    <li>Export/Import de scénarios en JSON</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-lg font-semibold mb-2">Fonctionnalités transversales :</h3>
                        <ul className="list-disc list-inside space-y-1 text-sm">
                            <li><strong>Multi-onglets</strong> : Passez d'un module à l'autre sans perdre le contexte</li>
                            <li><strong>Multi-session</strong> : Créez et pilotez plusieurs sessions en parallèle</li>
                            <li><strong>Graphiques temps réel</strong> : SoC, puissance offerte, puissance active, set-point, énergie cumulée</li>
                            <li><strong>Mode "flou" SCP</strong> : Lissage progressif des set-points pour tester vos algorithmes</li>
                            <li><strong>Export CSV</strong> : Sauvegardez vos logs et résultats de performance</li>
                            <li><strong>Logs complets</strong> : Toutes les requêtes et réponses OCPP avec timestamps et payloads</li>
                            <li><strong>WebSocket temps réel</strong> : Mises à jour instantanées de toutes les métriques</li>
                            <li><strong>Simulation réaliste</strong> : MeterValues automatiques toutes les 60 secondes pendant la charge</li>
                        </ul>
                    </div>

                    <div className="bg-blue-900 p-4 rounded">
                        <h3 className="text-lg font-semibold mb-2">🚀 Démarrage rapide :</h3>
                        <ol className="list-decimal list-inside space-y-1 text-sm">
                            <li>Allez dans l'onglet "Simu EVSE"</li>
                            <li>Créez une nouvelle session</li>
                            <li>Configurez l'URL OCPP et le CP-ID</li>
                            <li>Cliquez sur "Connecter" pour établir la connexion WebSocket</li>
                            <li>Suivez le workflow : Se garer → Brancher → Badger → Démarrer</li>
                            <li>Observez les MeterValues envoyés automatiquement</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
}