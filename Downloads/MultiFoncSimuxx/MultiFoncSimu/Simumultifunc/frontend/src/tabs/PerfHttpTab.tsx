import React from "react";

// Bloc navigateur (pool WebSocket côté UI)
// Choisis le bon import selon ce que tu as dans /components :
// - Si tu as "PerfOCPPPanel.tsx" (le plus courant)
import PerfOCPPPanel from "../components/PerfOCPPPanel";
// - Si chez toi c'est "PerformanceOCPPPanel.tsx", remplace la ligne ci-dessus par :
// import PerformanceOCPPPanel from "../components/PerformanceOCPPPanel";

import PerfHttpControl from "../components/PerfHttpControl"; // runner HTTP

export default function PerfHttpTab() {
    return (
        <div className="flex flex-col gap-4">
            {/* Bloc 1 : Perf OCPP (navigateur) */}
            <div className="rounded border bg-white p-4 shadow-sm">
                <div className="font-semibold mb-3">Perf OCPP (navigateur)</div>
                {/* Si ton projet expose PerfOCPPPanel : */}
                <PerfOCPPPanel />
                {/* Si chez toi c'est PerformanceOCPPPanel, utilise-le à la place :
            <PerformanceOCPPPanel />
        */}
            </div>

            {/* Bloc 2 : Runner HTTP */}
            <div className="rounded border bg-white p-4 shadow-sm">
                <div className="font-semibold mb-3">Runner HTTP (haute charge & MeterValues)</div>
                <PerfHttpControl />
            </div>
        </div>
    );
}
