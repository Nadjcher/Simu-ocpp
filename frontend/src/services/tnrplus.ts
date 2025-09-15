// services/tnrplus.ts — client minimal pour /api/tnrplus/*
import { API_BASE } from "@/lib/apiBase";

type Json = Record<string, any>;
const base = API_BASE || "";

async function http<T=any>(method: string, path: string, body?: any, raw?: boolean): Promise<T> {
    const url = `${base}${path}`;
    const res = await fetch(url, {
        method,
        headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
        body: body == null || body instanceof FormData ? body : JSON.stringify(body),
        credentials: "include",
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return raw ? (await res.text() as any) : await res.json();
}

export type ExecMeta = { executionId: string; scenarioId: string; timestamp: string; passed: boolean; metrics?: Json };

export const tnrplus = {
    executions: () => http<ExecMeta[]>("GET", "/api/tnrplus/executions"),
    compare: (payload: {
        baseline: string; current: string;
        ignoreKeys?: string[]; strictOrder?: boolean; allowExtras?: boolean; numberTolerance?: number;
    }) => http<Json>("POST", "/api/tnrplus/compare", payload),
    exportCsv: (payload: any) => http<string>("POST", "/api/tnrplus/compare/export", payload, true),
};
