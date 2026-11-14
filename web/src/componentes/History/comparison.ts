/**
 * Cálculos da comparação entre experimentos (etapa 3 do histórico).
 *
 * Fonte dos tempos: eventos estruturados do results.json. Fonte das séries: /api/runs/:id/telemetry
 * ([segundo, comandos] e [segundo, cpu%, memKiB], segundos desde runStartUs).
 * Tudo aqui é fato medido; nenhuma conclusão é gerada.
 */
import { eventsFromResults, ReportEvent, XY } from "../Report/ExperimentReport";
import { RunSummary, summarizeRun, SIZE_LABEL } from "./runSummary";

const num = (v: any): number | null => (v === undefined || v === null || v === "" || isNaN(Number(v))) ? null : Number(v);

// ─── Estatística ───

export const mean = (xs: number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
/** Desvio-padrão amostral (n − 1); null com menos de 2 valores */
export const sd = (xs: number[]): number | null => {
    if (xs.length < 2) return null;
    const m = mean(xs)!;
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const finite = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x));

// ─── Métricas de um experimento ───

export interface RunMetrics {
    id: string;
    tag: string;
    sum: RunSummary;
    events: Record<string, ReportEvent>;
    runStartUs: number | null;
    /** Instantes (s desde o início) */
    stableStartAt: number | null;
    failureAt: number | null;
    recoveryStartAt: number | null;
    recoveryEndAt: number | null;
    /** Durações (s) */
    preloadS: number | null;
    stableS: number | null;
    downtimeS: number | null;
    recoveryS: number | null;
    /** Fases do preload e da recuperação: contagem do log e leitura efetiva (s), taxa de leitura (registros/s) */
    preloadCountS: number | null;
    preloadReadS: number | null;
    preloadRate: number | null;
    recoveryCountS: number | null;
    recoveryReadS: number | null;
    recoveryRate: number | null;
    /** Contagens */
    preloadedTuples: number | null;
    recoveredTuples: number | null;
    recordsProcessed: number | null;
    inconsistencies: number | null;
    /** Vazão média (ops/s) nos segundos com comandos, por janela */
    tpStable: number | null;
    tpRecovery: number | null;
    tpPost: number | null;
    tpPeak: number | null;
    cpuAvg: number | null;
    cpuPeak: number | null;
    memPeakMb: number | null;
    series: { throughput: XY[]; cpu: XY[]; memoryMb: XY[] };
    hasTelemetry: boolean;
    /** Modo de recuperação: instantânea (log indexado) ou padrão (log sequencial) */
    recoveryMode: RecoveryMode;
    /** Fim da carga submetida de novo após a falha (s desde o início) */
    workloadEndAt: number | null;
    /** "Workload runtime" da tese: da falha até o fim da carga (s) */
    workloadRunS: number | null;
}

export type RecoveryMode = "instant" | "standard";
const isOn = (v: any, dflt: boolean) => v === undefined || v === null || v === "" ? dflt : String(v).toUpperCase() === "ON" || v === true;
/** Modo de recuperação a partir da configuração do experimento (instant_recovery_state) */
export const recoveryModeOf = (run: any): RecoveryMode => {
    const cfg = run?.metadata?.config || {};
    return isOn(cfg.instantRecoveryState, true) ? "instant" : "standard";
};
export const RECOVERY_MODE_LABEL: Record<RecoveryMode, { en: string; pt: string; shortEn: string; shortPt: string }> = {
    instant: { en: "Instant recovery (indexed log)", pt: "Recuperação instantânea (log indexado)", shortEn: "Instant", shortPt: "Instantânea" },
    standard: { en: "Standard recovery (sequential log)", pt: "Recuperação padrão (log sequencial)", shortEn: "Standard", shortPt: "Padrão" },
};

const relSec = (ev: ReportEvent | undefined, runStartUs: number | null): number | null => {
    if (!ev) return null;
    const rel = num(ev.relativeMs);
    if (rel !== null) return rel / 1000;
    const ts = num(ev.timestampUs);
    return ts !== null && runStartUs !== null ? (ts - runStartUs) / 1e6 : null;
};
const durSec = (ev: ReportEvent | undefined) => { const d = num(ev?.durationMs); return d === null ? null : d / 1000; };

const windowAvg = (pts: XY[], from: number | null, to: number | null) => {
    if (from === null) return null;
    const ys = pts.filter((p) => p.x >= from && (to === null || p.x < to)).map((p) => p.y);
    return mean(ys);
};

export const computeRunMetrics = (run: any, telemetry: any | null, tag: string): RunMetrics => {
    const res = run?.results || {};
    const events = eventsFromResults(res);
    const runStartUs = num(res.runStartUs) ?? num(telemetry?.runStartUs);
    const stableStartAt = relSec(events.STABLE_OPERATION_STARTED, runStartUs);
    const failureAt = relSec(events.FAILURE_TRIGGERED, runStartUs);
    const recoveryStartAt = relSec(events.RECOVERY_STARTED, runStartUs);
    const recoveryEndAt = relSec(events.RECOVERY_COMPLETED, runStartUs);
    const workloadEndAt = relSec(events.WORKLOAD_FINISHED ?? events.WORKLOAD_STOPPED, runStartUs);

    const rows = (arr: any[] | undefined, col: number, scale = 1): XY[] =>
        Array.isArray(arr) ? arr.map((r) => ({ x: Number(r[0]), y: Number(r[col]) * scale })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    const throughput = rows(telemetry?.throughput, 1);
    const cpu = rows(telemetry?.monitoring, 1);
    const memoryMb = rows(telemetry?.monitoring, 2, 1 / 1024);

    const peak = (pts: XY[]) => pts.length ? pts.reduce((m, p) => Math.max(m, p.y), -Infinity) : null;

    return {
        id: run.id,
        tag,
        sum: summarizeRun(run),
        events,
        runStartUs,
        stableStartAt, failureAt, recoveryStartAt, recoveryEndAt,
        preloadS: durSec(events.PRELOAD_COMPLETED) ?? num(res.preloadDurationSeconds),
        stableS: stableStartAt !== null && failureAt !== null ? failureAt - stableStartAt : num(res.stableOperationSeconds),
        downtimeS: failureAt !== null && recoveryStartAt !== null ? recoveryStartAt - failureAt : null,
        recoveryS: durSec(events.RECOVERY_COMPLETED) ?? num(res.recoveryDurationSeconds),
        preloadCountS: num(res.preloadCountSeconds),
        preloadReadS: num(res.preloadReadSeconds),
        preloadRate: num(res.preloadReadRecordsPerSecond),
        recoveryCountS: num(res.recoveryCountSeconds),
        recoveryReadS: num(res.recoveryReadSeconds),
        recoveryRate: num(res.recoveryReadRecordsPerSecond),
        preloadedTuples: num(events.PRELOAD_COMPLETED?.loadedTuples) ?? num(res.preloadedTuples),
        recoveredTuples: num(events.RECOVERY_COMPLETED?.loadedTuples) ?? num(res.recoveredTuples),
        recordsProcessed: num(events.RECOVERY_COMPLETED?.recordsProcessed),
        inconsistencies: num(events.RECOVERY_COMPLETED?.inconsistencies),
        tpStable: windowAvg(throughput, stableStartAt, failureAt),
        tpRecovery: windowAvg(throughput, recoveryStartAt, recoveryEndAt),
        tpPost: windowAvg(throughput, recoveryEndAt, null),
        tpPeak: peak(throughput),
        cpuAvg: mean(cpu.map((p) => p.y)),
        cpuPeak: peak(cpu),
        memPeakMb: peak(memoryMb),
        series: { throughput, cpu, memoryMb },
        hasTelemetry: throughput.length > 0 || cpu.length > 0,
        recoveryMode: recoveryModeOf(run),
        workloadEndAt,
        workloadRunS: failureAt !== null && workloadEndAt !== null && workloadEndAt > failureAt ? workloadEndAt - failureAt : null,
    };
};

/** Desloca uma série para t = 0 no instante da falha */
export const alignAtFailure = (pts: XY[], failureAt: number | null): XY[] =>
    failureAt === null ? [] : pts.map((p) => ({ x: +(p.x - failureAt).toFixed(3), y: p.y }));

// ─── Idioma ───
// A página do histórico é em inglês; os relatórios PDF, em português. Rótulos têm as duas versões.

export type Lang = "en" | "pt";
type L = { en: string; pt: string };

// ─── Linhas da tabela lado a lado ───

export type MetricGroup = "times" | "data" | "throughput";
export const METRIC_GROUP_LABEL: Record<MetricGroup, L> = {
    times: { en: "Times", pt: "Tempos" },
    data: { en: "Data", pt: "Dados" },
    throughput: { en: "Throughput and resources", pt: "Vazão e recursos" },
};

export interface MetricRow {
    key: string;
    label: L;
    unit: L;
    decimals: number;
    get: (m: RunMetrics) => number | null;
    source: string;
    group: MetricGroup;
}

const U = (en: string, pt = en): L => ({ en, pt });

export const METRIC_ROWS: MetricRow[] = [
    { key: "preloadS", label: U("Preload"), unit: U("s"), decimals: 3, get: (m) => m.preloadS, source: "PRELOAD_STARTED → PRELOAD_COMPLETED", group: "times" },
    { key: "preloadCountS", label: U("  · counting the log", "  · contagem do log"), unit: U("s"), decimals: 3, get: (m) => m.preloadCountS, source: "PRELOAD_STARTED → PRELOAD_INDEX_OPEN", group: "times" },
    { key: "preloadReadS", label: U("  · reading the log", "  · leitura do log"), unit: U("s"), decimals: 3, get: (m) => m.preloadReadS, source: "PRELOAD_INDEX_OPEN → PRELOAD_COMPLETED", group: "times" },
    { key: "stableS", label: U("Stable operation until failure", "Operação estável até a falha"), unit: U("s"), decimals: 3, get: (m) => m.stableS, source: "STABLE_OPERATION_STARTED → FAILURE_TRIGGERED", group: "times" },
    { key: "downtimeS", label: U("Failure → recovery start", "Falha → início da recuperação"), unit: U("s"), decimals: 3, get: (m) => m.downtimeS, source: "FAILURE_TRIGGERED → RECOVERY_STARTED", group: "times" },
    { key: "recoveryS", label: U("Recovery", "Recuperação"), unit: U("s"), decimals: 3, get: (m) => m.recoveryS, source: "RECOVERY_STARTED → RECOVERY_COMPLETED", group: "times" },
    { key: "recoveryCountS", label: U("  · counting the log", "  · contagem do log"), unit: U("s"), decimals: 3, get: (m) => m.recoveryCountS, source: "RECOVERY_STARTED → PRELOAD_INDEX_OPEN", group: "times" },
    { key: "recoveryReadS", label: U("  · reading the log", "  · leitura do log"), unit: U("s"), decimals: 3, get: (m) => m.recoveryReadS, source: "PRELOAD_INDEX_OPEN → RECOVERY_COMPLETED", group: "times" },
    { key: "workloadRunS", label: U("Workload runtime after the failure", "Execução da carga após a falha"), unit: U("s"), decimals: 3, get: (m) => m.workloadRunS, source: "FAILURE_TRIGGERED → WORKLOAD_FINISHED", group: "times" },
    { key: "preloadRate", label: U("Log read rate, preload", "Taxa de leitura do log, preload"), unit: U("records/s", "registros/s"), decimals: 0, get: (m) => m.preloadRate, source: "registros / tempo de leitura", group: "data" },
    { key: "recoveryRate", label: U("Log read rate, recovery", "Taxa de leitura do log, recuperação"), unit: U("records/s", "registros/s"), decimals: 0, get: (m) => m.recoveryRate, source: "registros / tempo de leitura", group: "data" },
    { key: "preloadedTuples", label: U("Tuples loaded in preload", "Tuplas no preload"), unit: U(""), decimals: 0, get: (m) => m.preloadedTuples, source: "PRELOAD_COMPLETED.loadedTuples", group: "data" },
    { key: "recoveredTuples", label: U("Tuples loaded in recovery", "Tuplas na recuperação"), unit: U(""), decimals: 0, get: (m) => m.recoveredTuples, source: "RECOVERY_COMPLETED.loadedTuples", group: "data" },
    { key: "recordsProcessed", label: U("Log records processed in recovery", "Registros processados na recuperação"), unit: U(""), decimals: 0, get: (m) => m.recordsProcessed, source: "RECOVERY_COMPLETED.recordsProcessed", group: "data" },
    { key: "inconsistencies", label: U("Inconsistencies", "Inconsistências"), unit: U(""), decimals: 0, get: (m) => m.inconsistencies, source: "RECOVERY_COMPLETED.inconsistencies", group: "data" },
    { key: "tpStable", label: U("Mean throughput, stable operation", "Vazão média na operação estável"), unit: U("ops/s"), decimals: 1, get: (m) => m.tpStable, source: "datasets.csv (segundos com comandos)", group: "throughput" },
    { key: "tpRecovery", label: U("Mean throughput, during recovery", "Vazão média durante a recuperação"), unit: U("ops/s"), decimals: 1, get: (m) => m.tpRecovery, source: "datasets.csv (segundos com comandos)", group: "throughput" },
    { key: "tpPost", label: U("Mean throughput, after recovery", "Vazão média após a recuperação"), unit: U("ops/s"), decimals: 1, get: (m) => m.tpPost, source: "datasets.csv (segundos com comandos)", group: "throughput" },
    { key: "tpPeak", label: U("Peak throughput", "Vazão de pico"), unit: U("ops/s"), decimals: 0, get: (m) => m.tpPeak, source: "datasets.csv", group: "throughput" },
    { key: "cpuAvg", label: U("Mean CPU", "CPU média"), unit: U("% core", "% núcleo"), decimals: 1, get: (m) => m.cpuAvg, source: "system_monitoring.csv", group: "throughput" },
    { key: "cpuPeak", label: U("Peak CPU", "CPU de pico"), unit: U("% core", "% núcleo"), decimals: 1, get: (m) => m.cpuPeak, source: "system_monitoring.csv", group: "throughput" },
    { key: "memPeakMb", label: U("Peak resident memory", "Memória residente de pico"), unit: U("MB"), decimals: 1, get: (m) => m.memPeakMb, source: "system_monitoring.csv", group: "throughput" },
];

/** Diferença em relação à referência (RUN A): absoluta e percentual */
export const delta = (v: number | null, ref: number | null) => {
    if (v === null || ref === null) return null;
    return { abs: v - ref, pct: ref !== 0 ? ((v - ref) / Math.abs(ref)) * 100 : null };
};

// ─── Configuração e comparabilidade ───

export interface ConfigField {
    key: string;
    label: L;
    get: (run: any, lang: Lang) => string;
    /** Diferença que muda o que está sendo medido (base, modo, carga) */
    critical: boolean;
}

const cfgOf = (run: any) => run?.metadata?.config || {};
const dbOf = (run: any) => run?.metadata?.database || null;

export const CONFIG_FIELDS: ConfigField[] = [
    {
        // Não é "crítica": comparar a recuperação instantânea com a padrão na mesma situação é o objetivo
        key: "mode", label: U("Recovery mode", "Modo de recuperação"), critical: false,
        get: (r, l) => RECOVERY_MODE_LABEL[recoveryModeOf(r)][l],
    },
    {
        key: "base", label: U("Database (records / tuples)", "Base (registros / tuplas)"), critical: true, get: (r, l) => {
            const db = dbOf(r);
            const n = (v: any) => v == null ? "?" : new Intl.NumberFormat(l === "pt" ? "pt-BR" : "en-US").format(Number(v));
            if (db && (db.records != null || db.distinctTuples != null)) return `${n(db.records)} / ${n(db.distinctTuples)}`;
            const t = num(r?.results?.preloadedTuples);
            return t !== null ? `? / ${n(t)} (${l === "pt" ? "pelo preload" : "from preload"})` : (l === "pt" ? "não registrada" : "not recorded");
        },
    },
    { key: "size", label: U("Database size", "Tamanho da base"), critical: false, get: (r, l) => { const p = dbOf(r)?.sizePreset; return p ? (SIZE_LABEL[l][p] || p) : "—"; } },
    {
        key: "failure", label: U("Simulated failure", "Falha simulada"), critical: true, get: (r, l) => {
            const c = cfgOf(r);
            if (Number(c.restartAfterTime) > 0) return `${l === "pt" ? "por tempo" : "time-based"} · ${c.restartAfterTime} s`;
            if (Number(c.preloadDatabaseAndRestart) > 0) return `${l === "pt" ? "após o preload" : "after preload"} · ${c.preloadDatabaseAndRestart} s`;
            return l === "pt" ? "nenhuma" : "none";
        },
    },
    { key: "memtier", label: U("Load (memtier)", "Carga (memtier)"), critical: true, get: (r) => { const c = cfgOf(r); return (c.memtierBenchmarkState || "OFF").toUpperCase() === "ON" ? (c.memtierBenchmarkParameters || "ON") : "OFF"; } },
    {
        // usleep(server.indexer_time_interval) no instant_recovery.c → microssegundos
        key: "indexer", label: U("Indexer interval", "Intervalo do indexador"), critical: false, get: (r, l) => {
            const v = num(cfgOf(r).indexerTimeInterval);
            return v === null ? "—" : `${new Intl.NumberFormat(l === "pt" ? "pt-BR" : "en-US").format(v)} µs`;
        },
    },
    { key: "sync", label: U("Synchronous indexing", "Indexação síncrona"), critical: false, get: (r) => String(cfgOf(r).instantRecoverySynchronous ?? "—") },
    { key: "checkpoint", label: U("Checkpoint"), critical: false, get: (r) => { const c = cfgOf(r); return c.checkpointState === "ON" ? `ON · ${c.checkpointTimeInterval} s` : String(c.checkpointState || "—"); } },
    { key: "restartDelay", label: U("Restart delay", "Atraso do reinício"), critical: false, get: (r) => { const v = cfgOf(r).restartDaleyTime; return v !== undefined ? `${v} s` : "—"; } },
    {
        key: "cache", label: U("Database restored from backup before start", "Base restaurada do backup antes do início"), critical: false, get: (r, l) => {
            const db = dbOf(r);
            if (!db) return l === "pt" ? "não registrado" : "not recorded";
            return db.restoredFromBackup ? (l === "pt" ? "sim (cache quente)" : "yes (warm cache)") : (l === "pt" ? "não" : "no");
        },
    },
];

export interface ConfigDiff { field: ConfigField; values: string[]; differs: boolean }

export const compareConfigs = (runs: any[], lang: Lang): ConfigDiff[] =>
    CONFIG_FIELDS.map((field) => {
        const values = runs.map((r) => field.get(r, lang));
        return { field, values, differs: new Set(values).size > 1 };
    });

// ─── Grupos de repetição ───

/** Campos que definem "o mesmo experimento repetido" */
const FINGERPRINT_KEYS = ["mode", "base", "failure", "memtier", "indexer", "sync", "checkpoint", "restartDelay"];

export const fingerprintOf = (run: any) =>
    CONFIG_FIELDS.filter((f) => FINGERPRINT_KEYS.includes(f.key)).map((f) => `${f.key}=${f.get(run, "en")}`).join("|");

export interface Stat { mean: number | null; sd: number | null; n: number; min: number | null; max: number | null }

const stat = (xs: (number | null)[]): Stat => {
    const v = finite(xs);
    return { mean: mean(v), sd: sd(v), n: v.length, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
};

export interface RepetitionGroup {
    key: string;
    runs: any[];
    describe: { key: string; label: string; value: string }[];
    preload: Stat;
    preloadRead: Stat;
    recoveryRead: Stat;
    stable: Stat;
    downtime: Stat;
    recovery: Stat;
    preloadedTuples: Stat;
}

/** Agrupa os experimentos COMPLETOS por configuração; grupos com mais execuções primeiro */
export const groupRepetitions = (runs: any[], lang: Lang): RepetitionGroup[] => {
    const byKey = new Map<string, any[]>();
    runs.filter((r) => summarizeRun(r).status === "Completed").forEach((r) => {
        const k = fingerprintOf(r);
        byKey.set(k, [...(byKey.get(k) || []), r]);
    });
    return [...byKey.entries()].map(([key, rs]) => {
        const ms = rs.map((r) => computeRunMetrics(r, null, ""));
        return {
            key,
            runs: rs,
            describe: CONFIG_FIELDS.filter((f) => FINGERPRINT_KEYS.includes(f.key)).map((f) => ({ key: f.key, label: f.label[lang], value: f.get(rs[0], lang) })),
            preload: stat(ms.map((m) => m.preloadS)),
            preloadRead: stat(ms.map((m) => m.preloadReadS)),
            recoveryRead: stat(ms.map((m) => m.recoveryReadS)),
            stable: stat(ms.map((m) => m.stableS)),
            downtime: stat(ms.map((m) => m.downtimeS)),
            recovery: stat(ms.map((m) => m.recoveryS)),
            preloadedTuples: stat(ms.map((m) => m.preloadedTuples)),
        };
    }).sort((a, b) => b.runs.length - a.runs.length || a.key.localeCompare(b.key));
};

/** Resumo de uma linha do grupo: "MM-DIRECT · 1,000,000 / 5,000 · time-based · 30 s" */
export const groupHeadline = (g: RepetitionGroup) => {
    const v = (k: string) => g.describe.find((d) => d.key === k)?.value || "";
    return `${v("mode").startsWith("MM") ? "MM-DIRECT" : "AOF"} · ${v("base")} · ${v("failure")}`;
};

// ─── CSV (padrão do Excel em português: ";" como separador e "," como decimal) ───

export const toCsv = (rows: (string | number | null | undefined)[][]) => {
    const cell = (v: string | number | null | undefined) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
        const s = String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
};

export const downloadText = (content: string, filename: string, mime = "text/csv;charset=utf-8") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Para cada grupo, os parâmetros que variam entre os grupos exibidos (ex.: "Intervalo do indexador: 500"),
 * para os grupos não parecerem iguais no resumo.
 */
export const groupDistinctions = (groups: RepetitionGroup[]): string[] => {
    if (groups.length < 2) return groups.map(() => "");
    const labels = groups[0].describe.map((d) => d.label);
    const varying = labels.filter((l) => new Set(groups.map((g) => g.describe.find((d) => d.label === l)?.value)).size > 1);
    return groups.map((g) => varying.map((l) => `${l}: ${g.describe.find((d) => d.label === l)?.value}`).join(" · "));
};
