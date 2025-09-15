// src/contexts/TNRContext.tsx
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { API_BASE } from "@/lib/apiBase";

interface TNRContextType {
    // État
    isRecording: boolean;
    recStartedAt: number;
    recEvents: number;
    recName: string;
    recId: string;
    recDesc: string;
    recTags: string;
    recBaseline: boolean;
    refreshTrigger: number;

    // Setters
    setRecName: (v: string) => void;
    setRecId: (v: string) => void;
    setRecDesc: (v: string) => void;
    setRecTags: (v: string) => void;
    setRecBaseline: (v: boolean) => void;

    // Actions
    startRecording: (config?: any) => Promise<void>;
    stopRecording: () => Promise<void>;
    tapEvent: (type: string, action: string, payload: any, sessionId?: string) => Promise<void>;
    refreshScenarios: () => void;
}

const TNRContext = createContext<TNRContextType | undefined>(undefined);

async function fetchJSON<T = any>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...(init || {}),
    });
    try {
        return (await r.json()) as T;
    } catch {
        return [] as any;
    }
}

function parseTags(s: string) {
    return (s || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
}

export function TNRProvider({ children }: { children: ReactNode }) {
    const [isRecording, setIsRecording] = useState(false);
    const [recStartedAt, setRecStartedAt] = useState(0);
    const [recEvents, setRecEvents] = useState(0);
    const [recName, setRecName] = useState(`rec_${Date.now()}`);
    const [recId, setRecId] = useState(`tnr_${Date.now()}`);
    const [recDesc, setRecDesc] = useState("");
    const [recTags, setRecTags] = useState("");
    const [recBaseline, setRecBaseline] = useState(false);

    const isRecordingRef = useRef(false);
    const eventCountRef = useRef(0);
    const refreshTriggeredRef = useRef(0);

    // Polling du status
    const refreshStatus = async () => {
        try {
            const s: any = await fetchJSON("/api/tnr/status");
            const rec = !!s?.isRecording;
            setIsRecording(rec);
            isRecordingRef.current = rec;

            if (rec) {
                setRecEvents(Number(s.recordingEvents || 0));
                eventCountRef.current = Number(s.recordingEvents || 0);
                if (s.recordingDuration) {
                    setRecStartedAt(Date.now() - Number(s.recordingDuration));
                }
                // Récupérer le nom de l'enregistrement en cours si disponible
                if (s.recordingName) {
                    setRecName(s.recordingName);
                }
            } else {
                setRecEvents(0);
                eventCountRef.current = 0;
                setRecStartedAt(0);
            }
        } catch {
            // endpoint absent, on ne casse rien
        }
    };

    useEffect(() => {
        refreshStatus();
        const t = setInterval(refreshStatus, 3000);
        return () => clearInterval(t);
    }, []);

    const startRecording = async (config?: any) => {
        const body = {
            name: recName || `rec_${Date.now()}`,
            description: recDesc || undefined,
            tags: parseTags(recTags),
            config: config || {},
        };

        try {
            // Essayer d'abord /recorder/start puis /record/start
            let success = false;
            try {
                await fetchJSON("/api/tnr/recorder/start", {
                    method: "POST",
                    body: JSON.stringify(body)
                });
                success = true;
            } catch {
                // Fallback sur /record/start
                try {
                    await fetchJSON("/api/tnr/record/start", {
                        method: "POST",
                        body: JSON.stringify(body)
                    });
                    success = true;
                } catch (e) {
                    throw e;
                }
            }

            if (success) {
                setIsRecording(true);
                isRecordingRef.current = true;
                setRecStartedAt(Date.now());
                setRecEvents(0);
                eventCountRef.current = 0;
            }
        } catch (e: any) {
            alert(`Erreur start TNR: ${e?.message || e}`);
        }
    };

    const stopRecording = async () => {
        const payload = {
            id: recId || `tnr_${Date.now()}`,
            name: recName || undefined,
            description: recDesc || undefined,
            tags: [
                ...(parseTags(recTags) || []),
                ...(recBaseline ? ["baseline"] : []),
            ],
        };

        try {
            // Essayer d'abord /recorder/stop puis /record/stop
            let success = false;
            try {
                await fetchJSON("/api/tnr/recorder/stop", {
                    method: "POST",
                    body: JSON.stringify(payload)
                });
                success = true;
            } catch {
                // Fallback sur /record/stop
                try {
                    await fetchJSON("/api/tnr/record/stop", {
                        method: "POST",
                        body: JSON.stringify(payload)
                    });
                    success = true;
                } catch (e) {
                    throw e;
                }
            }

            if (success) {
                setIsRecording(false);
                isRecordingRef.current = false;
                setRecStartedAt(0);
                setRecEvents(0);
                eventCountRef.current = 0;

                // Générer de nouveaux IDs pour le prochain enregistrement
                setRecName(`rec_${Date.now()}`);
                setRecId(`tnr_${Date.now()}`);
                setRecDesc("");
                setRecTags("");
                setRecBaseline(false);

                // Déclencher un refresh des scénarios
                refreshTriggeredRef.current = Date.now();
            }
        } catch (e: any) {
            alert(`Erreur stop TNR: ${e?.message || e}`);
        }
    };

    const tapEvent = async (type: string, action: string, payload: any, sessionId?: string) => {
        if (!isRecordingRef.current) return;

        try {
            const b = {
                timestamp: Date.now(),
                type,
                action,
                sessionId: sessionId || undefined,
                payload,
            };

            let ok = false;

            // Essayer d'abord /record/event
            try {
                const r = await fetch(`${API_BASE}/api/tnr/record/event`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(b),
                });
                ok = r.ok;
            } catch {}

            // Fallback sur /tap si nécessaire
            if (!ok) {
                try {
                    await fetch(`${API_BASE}/api/tnr/tap`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            sessionId: b.sessionId,
                            action,
                            type,
                            payload
                        }),
                    });
                    ok = true;
                } catch {}
            }

            if (ok) {
                // Incrémenter le compteur local
                eventCountRef.current += 1;
                setRecEvents(eventCountRef.current);
            }
        } catch {
            // silencieux
        }
    };

    const refreshScenarios = () => {
        refreshTriggeredRef.current = Date.now();
    };

    // Exposer refreshTriggeredRef via le contexte pour que TnrTab puisse l'écouter
    const contextValue: TNRContextType & { refreshTrigger?: number } = {
        isRecording,
        recStartedAt,
        recEvents,
        recName,
        recId,
        recDesc,
        recTags,
        recBaseline,
        setRecName,
        setRecId,
        setRecDesc,
        setRecTags,
        setRecBaseline,
        startRecording,
        stopRecording,
        tapEvent,
        refreshScenarios,
        refreshTrigger: refreshTriggeredRef.current,
    };

    return (
        <TNRContext.Provider value={contextValue as TNRContextType}>
            {children}
        </TNRContext.Provider>
    );
}

export const useTNR = () => {
    const context = useContext(TNRContext);
    if (!context) {
        throw new Error("useTNR must be used within TNRProvider");
    }
    return context;
};