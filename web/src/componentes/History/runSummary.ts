/**
 * Resumo de um experimento do histórico, calculado a partir do results.json (eventos estruturados).
 * Usado na lista, nos filtros e no cabeçalho do detalhe.
 */

export type RunStatusKey = "Completed" | "No failure" | "Failed" | "Interrupted" | "Running" | "Missing";

export interface RunAnnotations {
    label?: string;
    notes?: string;
    tags?: string[];
    updatedAt?: string;
}

export interface RunSummary {
    id: string;
    archived: boolean;
    status: RunStatusKey;
    mode: "MM-DIRECT" | "AOF";
    startedAt: Date | null;
    preloadS: number | null;
    stableS: number | null;
    recoveryS: number | null;
    /** Fases (22/10): contagem do log antes de abrir o cursor e leitura efetiva */
    preloadCountS: number | null;
    preloadReadS: number | null;
    recoveryCountS: number | null;
    recoveryReadS: number | null;
    preloadedTuples: number | null;
    recoveredTuples: number | null;
    sizePreset: string | null;
    memtier: boolean;
    failureMode: "time" | "preload" | "none";
    reconstructed: boolean;
    annotations: RunAnnotations;
}

const num = (v: any): number | null => (v === undefined || v === null || v === "" || isNaN(Number(v))) ? null : Number(v);

/** Rótulo em inglês (página do histórico); dica em português */
export const STATUS_META: Record<RunStatusKey, { label: string; tip: string; cls: string }> = {
    "Completed": { label: "Completed", tip: "Preload, falha simulada e recuperação concluídos (RECOVERY_COMPLETED registrado).", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    "No failure": { label: "No failure", tip: "Experimento terminou sem falha simulada configurada.", cls: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
    "Failed": { label: "Failed", tip: "O Redis-IR registrou EXPERIMENT_FAILED (ex.: log indexado vazio).", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
    "Interrupted": { label: "Interrupted", tip: "O experimento foi encerrado antes de concluir a recuperação (ex.: End experiment durante a execução).", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
    "Running": { label: "Running", tip: "Experimento em andamento.", cls: "bg-blue-500/10 text-blue-300 border-blue-500/30" },
    "Missing": { label: "No results", tip: "A pasta não tem results.json nem logs suficientes para reconstruí-lo.", cls: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
};

export const SIZE_LABEL: Record<"en" | "pt", Record<string, string>> = {
    en: { small: "Small", medium: "Medium", large: "Large", xlarge: "X-Large" },
    pt: { small: "Pequena", medium: "Média", large: "Grande", xlarge: "Muito grande" },
};

export const summarizeRun = (run: any): RunSummary => {
    const res = run?.results || null;
    const meta = run?.metadata || {};
    const cfg = meta.config || {};
    let status: RunStatusKey = "Missing";
    if (run?.active) status = "Running";
    else if (res?.experimentStatus && STATUS_META[res.experimentStatus as RunStatusKey]) status = res.experimentStatus;
    else if (res) status = res.status === "Estável" ? "Completed" : "Interrupted"; // results.json antigo

    const tsMs = num(res?.runStartUs) !== null ? Number(res.runStartUs) / 1000
        : meta.timestamp ? Date.parse(meta.timestamp)
        : num(String(run?.id || "").replace(/^run_/, ""));
    const failureMode = Number(cfg.restartAfterTime) > 0 ? "time" : Number(cfg.preloadDatabaseAndRestart) > 0 ? "preload" : "none";

    return {
        id: run?.id,
        archived: !!run?.archived,
        status,
        mode: (cfg.instantRecoveryState || "ON").toUpperCase() === "ON" ? "MM-DIRECT" : "AOF",
        startedAt: tsMs && Number.isFinite(tsMs) ? new Date(tsMs) : null,
        preloadS: num(res?.preloadDurationSeconds),
        stableS: num(res?.stableOperationSeconds),
        recoveryS: num(res?.recoveryDurationSeconds),
        preloadCountS: num(res?.preloadCountSeconds),
        preloadReadS: num(res?.preloadReadSeconds),
        recoveryCountS: num(res?.recoveryCountSeconds),
        recoveryReadS: num(res?.recoveryReadSeconds),
        preloadedTuples: num(res?.preloadedTuples),
        recoveredTuples: num(res?.recoveredTuples),
        sizePreset: meta.database?.sizePreset || null,
        memtier: (cfg.memtierBenchmarkState || "OFF").toUpperCase() === "ON",
        failureMode,
        reconstructed: !!res?.reconstructed,
        annotations: run?.annotations || {},
    };
};

export type SortKey = "newest" | "oldest" | "recoveryAsc" | "recoveryDesc";

export interface RunFilters {
    q: string;
    status: "" | RunStatusKey;
    mode: "" | "MM-DIRECT" | "AOF";
    sort: SortKey;
}

export const DEFAULT_FILTERS: RunFilters = { q: "", status: "", mode: "", sort: "newest" };

export const filterRuns = (summaries: RunSummary[], f: RunFilters): RunSummary[] => {
    const q = f.q.trim().toLowerCase();
    const out = summaries.filter((s) => {
        if (f.status && s.status !== f.status) return false;
        if (f.mode && s.mode !== f.mode) return false;
        if (q) {
            const hay = [s.id, s.annotations.label, s.annotations.notes, ...(s.annotations.tags || [])].filter(Boolean).join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
    const t = (s: RunSummary) => s.startedAt?.getTime() ?? 0;
    const rec = (s: RunSummary, dir: 1 | -1) => s.recoveryS === null ? Infinity : dir * s.recoveryS; // sem recuperação vai para o fim
    out.sort((a, b) => {
        switch (f.sort) {
            case "oldest": return t(a) - t(b);
            case "recoveryAsc": return rec(a, 1) - rec(b, 1);
            case "recoveryDesc": return rec(a, -1) - rec(b, -1);
            default: return t(b) - t(a);
        }
    });
    return out;
};
