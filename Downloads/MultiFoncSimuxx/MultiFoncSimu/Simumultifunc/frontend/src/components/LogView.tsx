import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * LOGVIEW PATCH R1 — batched, capped, emoji-free, safe-wrap
 * - Cap mémoire/DOM : max lignes (par défaut 500)
 * - Batch + diff tail pour le polling
 * - Tronquage des lignes très longues pour garder le layout fluide
 * - Sanitize : remplace les emojis par des marqueurs ASCII
 */

type Props =
    | { lines: string[]; fetchUrl?: undefined; max?: number; pollMs?: number; height?: number }
    | { fetchUrl: string; lines?: undefined; max?: number; pollMs?: number; height?: number };

const DEFAULT_MAX = 500;
const DEFAULT_POLL = 1000;
const DEFAULT_HEIGHT = 260;

// même mapping que côté runner (pour uniformiser)
function sanitize(line: string): string {
    return String(line)
        .replace(/[✅✔️]/g, "<<OK>>")
        .replace(/[❌✖️]/g, "<<ERR>>")
        .replace(/[🔄]/g, "<<RETRY>>")
        .replace(/[🔗]/g, "<<WS>>")
        .replace(/[⏱️]/g, "<<TIMER>>")
        .replace(/[⚡]/g, "<<POWER>>")
        .replace(/[🔌]/g, "<<PLUG>>")
        .replace(/[🚗]/g, "<<CAR>>")
        .replace(/[▶️→]/g, ">>")
        .replace(/[←]/g, "<<");
}

export default function LogView(props: Props) {
    console.log("### LOGVIEW PATCH R1 ###"); // marqueur visuel dans la console

    const max = props.max ?? DEFAULT_MAX;
    const pollMs = props.pollMs ?? DEFAULT_POLL;
    const height = props.height ?? DEFAULT_HEIGHT;

    const [data, setData] = useState<string[]>(
        () => (Array.isArray((props as any).lines) ? (props as any).lines : []).slice(-max)
    );

    const queueRef = useRef<string[]>([]);
    const timerRef = useRef<number | null>(null);
    const preRef = useRef<HTMLPreElement | null>(null);
    const autoScrollRef = useRef(true);

    // batching pour limiter les re-render
    function push(newLines: string[]) {
        if (!newLines?.length) return;
        queueRef.current.push(...newLines);
        if (timerRef.current) return;
        timerRef.current = window.setTimeout(() => {
            const merged = [...data, ...queueRef.current];
            queueRef.current = [];
            timerRef.current && window.clearTimeout(timerRef.current);
            timerRef.current = null;
            const next = merged.slice(-max);
            setData(next);
        }, 200);
    }

    // Mode fetch (polling)
    useEffect(() => {
        if (!("fetchUrl" in props) || !props.fetchUrl) return;
        let stop = false;
        let ctrl: AbortController | null = null;
        let lastLen = 0;

        async function tick() {
            if (stop) return;
            try {
                ctrl?.abort();
                ctrl = new AbortController();
                const res = await fetch(props.fetchUrl, { signal: ctrl.signal });
                if (res.ok) {
                    const arr = await res.json();
                    if (Array.isArray(arr)) {
                        // arr peut être des {ts,line} -> on mappe en string, puis sanitize + tronquage
                        const str = arr.map((it: any) => {
                            const raw = typeof it === "string" ? it : `[${it?.ts ?? ""}] ${it?.line ?? ""}`;
                            const s = sanitize(raw);
                            return s.length > 400 ? s.slice(0, 400) + " …" : s;
                        });
                        // ne pousse que la fin (tail) pour éviter trop d'infos
                        const start = Math.max(0, str.length - max);
                        const tail = str.slice(start);
                        // optimisation naïve : si même taille que la dernière fois, on ne repousse pas
                        if (tail.length !== lastLen) {
                            lastLen = tail.length;
                            push(tail);
                        }
                    }
                }
            } catch {}
            if (!stop) setTimeout(tick, pollMs);
        }
        tick();
        return () => {
            stop = true;
            ctrl?.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [("fetchUrl" in props) ? props.fetchUrl : null, max, pollMs]);

    // Controlled mode (props.lines)
    useEffect(() => {
        if (!("lines" in props) || !props.lines) return;
        const next = props.lines
            .map((s) => sanitize(String(s)))
            .map((s) => (s.length > 400 ? s.slice(0, 400) + " …" : s))
            .slice(-max);
        setData(next);
    }, [("lines" in props) ? props.lines : null, max]);

    // auto-scroll
    useEffect(() => {
        if (!autoScrollRef.current) return;
        const el = preRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [data]);

    const onScroll = (e: React.UIEvent<HTMLPreElement>) => {
        const el = e.currentTarget;
        autoScrollRef.current = el.scrollHeight - el.clientHeight - el.scrollTop < 16;
    };

    const text = useMemo(() => data.join("\n"), [data]);
    const clear = () => setData([]);

    return (
        <div className="logview-container">
            <div className="logview-toolbar">
                <span className="logview-count">{data.length} lignes</span>
                <div className="logview-actions">
                    <button className="btn btn-secondary btn-xs" onClick={clear} type="button">Clear</button>
                </div>
            </div>
            <pre ref={preRef} className="logview-pre" onScroll={onScroll} style={{ height }}>
        {text || "(aucun log)"}
      </pre>

            <style>{`
        .logview-container { display:flex; flex-direction:column; }
        .logview-toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
        .logview-count { font-size:12px; opacity:.7; }
        .logview-actions { display:flex; gap:6px; }
        .logview-pre{
          background:#0b0f14; color:#d4d4d4;
          border:1px solid #1f2937; border-radius:6px;
          padding:8px 10px; overflow:auto;
          font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
          font-size:12px; line-height:1.35;
          white-space:pre-wrap; word-break:break-word;
        }
        .btn{ border-radius:6px; padding:6px 10px; border:1px solid #cbd5e1; background:#fff; cursor:pointer; }
        .btn:hover{ background:#f8fafc; }
        .btn-xs{ padding:3px 8px; font-size:12px; }
        .btn-secondary{ border-color:#94a3b8; }
      `}</style>
        </div>
    );
}
