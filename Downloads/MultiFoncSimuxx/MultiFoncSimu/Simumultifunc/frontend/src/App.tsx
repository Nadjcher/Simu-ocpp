// frontend/src/App.tsx
import React, { useState } from "react";
import "./App.css";
import { TNRProvider } from "./contexts/TNRContext";

import SimulGPMTab from "./tabs/SimulGPMTab";
import SimuEvseTab from "./tabs/SimuEvseTab";
import PerfOCPPTab from "./tabs/PerfOCPPTab";
import TnrTab from "./tabs/TnrTab";
import SmartChargingTab from "./tabs/SmartChargingTab";
import OCPPMessagesTab from "./tabs/OCPPMessagesTab";
import MLAnalysisTab from "./tabs/MLAnalysisTab";
import "@/styles/buttons.css";

type TabKey =
    | "simul-gpm"
    | "simu-evse"
    | "perf-ocpp"
    | "tnr"
    | "smart-charging"
    | "ocpp-messages"
    | "ml-analysis";

const TABS: { key: TabKey; label: string }[] = [
    { key: "simul-gpm", label: "Simul GPM" },
    { key: "simu-evse", label: "Simu EVSE" },
    { key: "perf-ocpp", label: "Perf OCPP (HTTP)" },
    { key: "tnr", label: "TNR" },
    { key: "smart-charging", label: "Smart Charging" },
    { key: "ocpp-messages", label: "OCPP Messages" },
    { key: "ml-analysis", label: "ML Analysis " },
];

export default function App() {
    const [open, setOpen] = useState(true);
    const [active, setActive] = useState<TabKey>("simu-evse");

    return (
        <TNRProvider>
            <div className="root">
                <header className="topbar">
                    <button className="toggle" onClick={() => setOpen((o) => !o)}>
                        ☰
                    </button>
                    <div className="title">GPM Simulator</div>
                    <div className="right">OCPP 1.6</div>
                </header>

                <div className="layout">
                    <aside className={`sidebar ${open ? "show" : "hide"}`}>
                        {TABS.map((t) => (
                            <button
                                key={t.key}
                                className={`tabbtn ${active === t.key ? "active" : ""}`}
                                onClick={() => setActive(t.key)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </aside>

                    <main className="content">
                        {active === "simul-gpm" && <SimulGPMTab />}
                        {active === "simu-evse" && <SimuEvseTab />}
                        {active === "perf-ocpp" && <PerfOCPPTab />}
                        {active === "tnr" && <TnrTab />}
                        {active === "smart-charging" && <SmartChargingTab />}
                        {active === "ocpp-messages" && <OCPPMessagesTab />}
                        {active === "ml-analysis" && <MLAnalysisTab />}
                    </main>
                </div>
            </div>
        </TNRProvider>
    );
}