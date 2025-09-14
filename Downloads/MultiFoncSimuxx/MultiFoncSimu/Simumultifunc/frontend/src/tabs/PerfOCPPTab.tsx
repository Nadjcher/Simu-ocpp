// frontend/src/tabs/PerfOCPPTab.tsx
import React, { useEffect } from "react";
import PerfOCPPPanel from "../components/PerfOCPPPanel";

export default function PerfOCPPTab() {
    // thème clair local à l’onglet
    useEffect(() => {
        if (typeof document !== "undefined") document.documentElement.classList.remove("dark");
    }, []);
    return (
        <div className="perf bg-white text-gray-900 min-h-[calc(100vh-64px)]">
            <div className="mx-auto max-w-[1400px] p-4 md:p-6">
                <PerfOCPPPanel />
            </div>
        </div>
    );
}
