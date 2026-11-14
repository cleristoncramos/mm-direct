/**
 * Relatório técnico de UM experimento, para impressão / PDF.
 * Usado pela tela ao vivo (ChartBoard) e pelo histórico (HistoryPanel), para os dois PDFs serem iguais.
 *
 * Idioma: português (decisão de out/2026, até validação com o orientador). Os textos estão
 * todos neste arquivo.
 *
 * Regras de conteúdo:
 *  - só fatos medidos e configuração; nenhuma conclusão interpretativa gerada automaticamente;
 *  - cronologia e durações vêm dos eventos estruturados do Redis-IR (EVENT_JSON), nunca de frases do log;
 *  - gráficos viram imagens PNG antes da impressão (canvas oculto imprime em branco).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Chart as ChartJS, registerables } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { buildPhaseAnnotations, ExperimentPhases, sharedXMax, phasesFromEventList, TimelineEvent, fillThroughputGaps } from "../Charts/phaseAnnotations";

try {
    ChartJS.register(...registerables, annotationPlugin);
} catch (e) {
    console.error("Error registering ChartJS in ExperimentReport", e);
}

// ─── Tipos ───

export interface ReportEvent {
    event?: string;
    relativeMs?: number | string;
    timestampUs?: number | string;
    durationMs?: number | string;
    [key: string]: any;
}

export interface XY { x: number; y: number }

export interface ExperimentReportData {
    runId: string;
    folderId?: string | null;
    runStartUs: number | null;
    statusLabel: string;
    modeLabel: string;
    config: Record<string, any>;
    database?: {
        sizePreset?: string | null;
        records?: number | null;
        distinctTuples?: number | null;
        indexedLogSizeBytes?: number | null;
        generatedWith?: string | null;
        generatedAt?: string | null;
        restoredFromBackup?: boolean;
        restoreDurationMs?: number | null;
        syncDurationMs?: number | null;
    } | null;
    /** Eventos por nome (PRELOAD_STARTED, FAILURE_TRIGGERED, …) */
    events: Record<string, ReportEvent>;
    series: { throughput: XY[]; cpu: XY[]; memoryMb: XY[] };
    files?: { aofBytes?: number | null; indexedLogBytes?: number | null };
    reconstructed?: boolean;
    /** Fases do preload e da recuperação (results.json desde 22/10); ausente na tela ao vivo */
    /** Lista ordenada de eventos do log (results.eventList): falhas sucessivas e checkpoints */
    eventList?: TimelineEvent[] | null;
    /** Tuplas recuperadas de forma incremental e sob demanda (results.json) */
    recoverySplit?: { incremental?: number | null; onDemand?: number | null } | null;
    loadPhases?: {
        preloadCountS?: number | null; preloadReadS?: number | null; preloadRate?: number | null;
        recoveryCountS?: number | null; recoveryReadS?: number | null; recoveryRate?: number | null;
    } | null;
}

// ─── Formatação pt-BR ───

const nf = (d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v: any): number | null => (v === undefined || v === null || v === "" || isNaN(Number(v))) ? null : Number(v);
export const brNum = (v: any, d = 3) => { const n = num(v); return n === null ? "—" : nf(d).format(n); };
export const brSec = (v: any, d = 3) => { const n = num(v); return n === null ? "—" : `${nf(d).format(n)} s`; };
const brInt = (v: any) => { const n = num(v); return n === null ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(n)); };
const brBytes = (v: any) => {
    const n = num(v);
    if (n === null) return "—";
    if (n >= 1024 ** 3) return `${nf(2).format(n / 1024 ** 3)} GB`;
    if (n >= 1024 ** 2) return `${nf(1).format(n / 1024 ** 2)} MB`;
    return `${nf(0).format(n / 1024)} KB`;
};
const clock = (us: any) => {
    const n = num(us);
    if (n === null) return "—";
    const d = new Date(n / 1000);
    const hms = d.toLocaleTimeString("pt-BR", { hour12: false, timeZone: "America/Sao_Paulo" });
    return `${hms}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};
const dateTime = (us: any) => {
    const n = num(us);
    if (n === null) return "—";
    return new Date(n / 1000).toLocaleString("pt-BR", { hour12: false, timeZone: "America/Sao_Paulo" });
};

// ─── Status ───

/** experimentStatus gravado no results.json → rótulo do relatório */
export const statusLabelFromResults = (s?: string | null) => ({
    "Completed": "Completo (falha e recuperação concluídas)",
    "No failure": "Concluído sem falha simulada",
    "Failed": "Falhou",
    "Interrupted": "Interrompido",
} as Record<string, string>)[s || ""] || "Desconhecido";

/** Estado visual da tela ao vivo → rótulo do relatório */
export const statusLabelFromVisualState = (s: string) => ({
    IDLE: "Aguardando início",
    PRELOADING: "Em andamento (preload)",
    STABLE_OPERATION: "Em andamento (operação estável)",
    FAILURE_TRIGGERED: "Em andamento (falha simulada)",
    RECOVERING: "Em andamento (recuperação)",
    COMPLETED: "Completo (falha e recuperação concluídas)",
    FAILED: "Falhou",
} as Record<string, string>)[s] || s;

// ─── Derivações a partir dos eventos ───

const relSecOf = (ev: ReportEvent | undefined, runStartUs: number | null): number | null => {
    if (!ev) return null;
    const rel = num(ev.relativeMs);
    if (rel !== null) return rel / 1000;
    const ts = num(ev.timestampUs);
    return ts !== null && runStartUs !== null ? (ts - runStartUs) / 1e6 : null;
};
const durSecOf = (ev: ReportEvent | undefined) => { const d = num(ev?.durationMs); return d === null ? null : d / 1000; };

/**
 * Fases dos gráficos. Com a lista completa de eventos (results.eventList, desde 14/11/2026) inclui
 * falhas sucessivas e checkpoints; sem ela, usa o último evento de cada tipo.
 */
export const phasesFromEvents = (events: Record<string, ReportEvent>, runStartUs: number | null, eventList?: TimelineEvent[] | null): ExperimentPhases => {
    const fromList = phasesFromEventList(eventList, runStartUs);
    if (fromList) return { ...fromList, now: null };
    return {
        preloadStart: relSecOf(events.PRELOAD_STARTED, runStartUs),
        preloadEnd: relSecOf(events.PRELOAD_COMPLETED, runStartUs),
        failure: relSecOf(events.FAILURE_TRIGGERED, runStartUs),
        recoveryStart: relSecOf(events.RECOVERY_STARTED, runStartUs),
        recoveryEnd: relSecOf(events.RECOVERY_COMPLETED, runStartUs),
        now: null,
    };
};

/** results.json (campo events, chaves camelCase) → mapa por nome do evento */
const RESULT_EVENT_KEYS: Record<string, string> = {
    preloadStart: "PRELOAD_STARTED", preloadEnd: "PRELOAD_COMPLETED", stableOperationStart: "STABLE_OPERATION_STARTED",
    failureTimerStart: "FAILURE_TIMER_STARTED", failureTriggered: "FAILURE_TRIGGERED", recoveryStart: "RECOVERY_STARTED",
    recoveryEnd: "RECOVERY_COMPLETED", experimentCompleted: "EXPERIMENT_COMPLETED", experimentFailed: "EXPERIMENT_FAILED",
    workloadResumed: "WORKLOAD_RESUMED", postRecoveryStable: "POST_RECOVERY_STABLE",
    workloadFinished: "WORKLOAD_FINISHED", workloadStopped: "WORKLOAD_STOPPED",
};
export const eventsFromResults = (results: any): Record<string, ReportEvent> => {
    const out: Record<string, ReportEvent> = {};
    const evs = results?.events || {};
    Object.entries(evs).forEach(([k, v]: [string, any]) => {
        if (!v || typeof v !== "object") return;
        out[v.event || RESULT_EVENT_KEYS[k] || k] = v;
    });
    return out;
};

const TIMELINE: { event: string; label: string; labelEn: string }[] = [
    { event: "PRELOAD_STARTED", label: "Início do preload", labelEn: "Preload started" },
    { event: "PRELOAD_COMPLETED", label: "Fim do preload", labelEn: "Preload completed" },
    { event: "STABLE_OPERATION_STARTED", label: "Início da operação estável", labelEn: "Stable operation started" },
    { event: "FAILURE_TRIGGERED", label: "Falha simulada", labelEn: "Simulated failure" },
    { event: "RUN_CONTINUED_AFTER_FAILURE", label: "Reinício do Redis-IR", labelEn: "Redis-IR restarted" },
    { event: "RECOVERY_STARTED", label: "Início da recuperação", labelEn: "Recovery started" },
    { event: "WORKLOAD_RESUMED", label: "Carga submetida de novo", labelEn: "Workload resubmitted" },
    { event: "RECOVERY_COMPLETED", label: "Fim da recuperação", labelEn: "Recovery completed" },
    { event: "WORKLOAD_FINISHED", label: "Fim da carga", labelEn: "Workload finished" },
    { event: "WORKLOAD_STOPPED", label: "Carga interrompida", labelEn: "Workload stopped" },
    { event: "EXPERIMENT_COMPLETED", label: "Fim do experimento", labelEn: "Experiment completed" },
    { event: "EXPERIMENT_FAILED", label: "Experimento falhou", labelEn: "Experiment failed" },
];

/** Linhas da cronologia (usadas no PDF e no painel do histórico) */
export const buildTimeline = (ev: Record<string, ReportEvent>, runStartUs: number | null, lang: "pt" | "en" = "pt") => {
    const stableStart = relSecOf(ev.STABLE_OPERATION_STARTED, runStartUs);
    const failureAt = relSecOf(ev.FAILURE_TRIGGERED, runStartUs);
    const recStart = relSecOf(ev.RECOVERY_STARTED, runStartUs);
    const stableS = stableStart !== null && failureAt !== null ? failureAt - stableStart : null;
    const downtimeS = failureAt !== null && recStart !== null ? recStart - failureAt : null;
    const en = lang === "en";
    const sec = (v: number | null) => en ? (v === null ? "—" : `${v.toFixed(3)} s`) : brSec(v);
    return TIMELINE.filter((t) => ev[t.event]).map((t) => {
        const e = ev[t.event];
        let detail = "";
        if (t.event === "PRELOAD_COMPLETED") detail = `${en ? "Preload duration" : "Duração do preload"}: ${sec(durSecOf(e))}`;
        if (t.event === "FAILURE_TRIGGERED" && stableS !== null) detail = `${en ? "Stable operation" : "Operação estável"}: ${sec(stableS)}`;
        if (t.event === "RECOVERY_STARTED" && downtimeS !== null) detail = `${en ? "Since failure" : "Desde a falha"}: ${sec(downtimeS)}`;
        if (t.event === "RECOVERY_COMPLETED") detail = `${en ? "Recovery duration" : "Duração da recuperação"}: ${sec(durSecOf(e))}`;
        if (t.event === "EXPERIMENT_FAILED" && e.reason) detail = String(e.reason);
        if (t.event === "WORKLOAD_RESUMED" && failureAt !== null) {
            const r = relSecOf(e, runStartUs);
            if (r !== null) detail = `${en ? "Since failure" : "Desde a falha"}: ${sec(r - failureAt)}`;
        }
        if ((t.event === "WORKLOAD_FINISHED" || t.event === "WORKLOAD_STOPPED") && failureAt !== null) {
            const r = relSecOf(e, runStartUs);
            if (r !== null) detail = `${en ? "Workload runtime after the failure" : "Execução da carga após a falha"}: ${sec(r - failureAt)}`;
        }
        return { event: t.event, label: en ? t.labelEn : t.label, rel: relSecOf(e, runStartUs), clock: clock(e.timestampUs), detail };
    }).sort((a, b) => (a.rel ?? Infinity) - (b.rel ?? Infinity));
};

// ─── Gráficos como imagem ───

const whiteBackground = {
    id: "whiteBackground",
    beforeDraw: (chart: any) => {
        const { ctx, width, height } = chart;
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    },
};

export const renderChartImage = (opts: {
    width: number; height: number; title: string; yTitle: string;
    datasets: { label: string; data: XY[]; color: string }[];
    phases: ExperimentPhases; xMax?: number; yMin?: number;
    /** Padrão: 0 e "Tempo desde o início do experimento (s)" */
    xMin?: number; xTitle?: string;
    /** Marcas adicionais (ex.: fim da recuperação de cada experimento no relatório comparativo) */
    extraAnnotations?: Record<string, any>;
}): string | null => {
    if (opts.datasets.every((d) => d.data.length === 0)) return null;
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;";
    const canvas = document.createElement("canvas");
    canvas.width = opts.width;
    canvas.height = opts.height;
    holder.appendChild(canvas);
    document.body.appendChild(holder);
    const font = { family: "Times New Roman", size: 18 };
    try {
        const chart = new ChartJS(canvas, {
            type: "line",
            data: {
                datasets: opts.datasets.map((d) => ({
                    label: d.label,
                    data: [...d.data].sort((a, b) => a.x - b.x),
                    borderColor: d.color,
                    backgroundColor: d.color,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.15,
                    fill: false,
                })),
            },
            options: {
                responsive: false,
                animation: false,
                devicePixelRatio: 1,
                scales: {
                    x: {
                        type: "linear", min: opts.xMin ?? 0, max: opts.xMax,
                        grid: { color: "#e2e8f0" }, ticks: { color: "#000", font },
                        title: { display: true, text: opts.xTitle || "Tempo desde o início do experimento (s)", color: "#000", font },
                    },
                    y: {
                        min: opts.yMin,
                        grid: { color: "#e2e8f0" }, ticks: { color: "#000", font },
                        title: { display: true, text: opts.yTitle, color: "#000", font },
                    },
                },
                plugins: {
                    legend: { display: opts.datasets.length > 1, labels: { color: "#000", font } },
                    title: { display: true, text: opts.title, color: "#000", font: { ...font, size: 20, weight: "bold" } },
                    annotation: { annotations: { ...buildPhaseAnnotations(opts.phases, { compact: true }), ...(opts.extraAnnotations || {}) } },
                } as any,
            },
            plugins: [whiteBackground],
        } as any);
        const url = chart.toBase64Image("image/png", 1);
        chart.destroy();
        return url;
    } catch (e) {
        console.error("Falha ao gerar imagem do gráfico do relatório:", e);
        return null;
    } finally {
        document.body.removeChild(holder);
    }
};

// ─── Componente ───

const Th = ({ children }: { children: React.ReactNode }) => <th className="p-1.5 border border-black text-left font-semibold">{children}</th>;
const Td = ({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) => (
    <td className={`p-1 border border-black align-top ${mono ? "font-mono" : ""}`}>{children}</td>
);

/**
 * active=false: o relatório não é montado (ex.: tela ao vivo escondida enquanto o histórico está aberto),
 * para nunca haver dois relatórios na mesma impressão.
 */
const ExperimentReport = ({ data, active = true }: { data: ExperimentReportData | null; active?: boolean }) => {
    const [images, setImages] = useState<{ throughput: string | null; cpu: string | null; memory: string | null }>({ throughput: null, cpu: null, memory: null });

    const ev = data?.events || {};
    const runStartUs = data?.runStartUs ?? null;
    const phases = useMemo(() => phasesFromEvents(ev, runStartUs, data?.eventList), [ev, runStartUs, data?.eventList]);

    const preloadS = durSecOf(ev.PRELOAD_COMPLETED);
    const recoveryS = durSecOf(ev.RECOVERY_COMPLETED);
    const stableStart = relSecOf(ev.STABLE_OPERATION_STARTED, runStartUs);
    const failureAt = relSecOf(ev.FAILURE_TRIGGERED, runStartUs);
    const stableS = stableStart !== null && failureAt !== null ? failureAt - stableStart : null;
    const recStart = relSecOf(ev.RECOVERY_STARTED, runStartUs);
    const downtimeS = failureAt !== null && recStart !== null ? recStart - failureAt : null;
    // "Workload runtime" da tese: da falha até o fim da carga submetida de novo no reinício
    const workloadEnd = relSecOf(ev.WORKLOAD_FINISHED ?? ev.WORKLOAD_STOPPED, runStartUs);
    const workloadRunS = failureAt !== null && workloadEnd !== null && workloadEnd > failureAt ? workloadEnd - failureAt : null;

    const cfg = data?.config || {};
    const failureMode = Number(cfg.restartAfterTime) > 0 ? "Por tempo" : Number(cfg.preloadDatabaseAndRestart) > 0 ? "Após o preload" : "Sem falha simulada";
    const failureTarget = Number(cfg.restartAfterTime) > 0 ? Number(cfg.restartAfterTime) : Number(cfg.preloadDatabaseAndRestart) > 0 ? Number(cfg.preloadDatabaseAndRestart) : null;
    const restarts = Number(cfg.restartAfterTime) > 0 ? cfg.numberRestartsAfterTime : cfg.numberRestartsAfterPreloading;

    const series = data?.series || { throughput: [], cpu: [], memoryMb: [] };
    const stats = (arr: XY[]) => {
        if (arr.length === 0) return { avg: null as number | null, peak: null as number | null };
        const ys = arr.map((p) => p.y);
        return { avg: ys.reduce((a, b) => a + b, 0) / ys.length, peak: ys.reduce((m, y) => Math.max(m, y), -Infinity) };
    };
    const tp = stats(series.throughput);
    const cpu = stats(series.cpu);
    const mem = stats(series.memoryMb);

    const xMax = useMemo(() => sharedXMax([
        ...[series.throughput, series.cpu, series.memoryMb].map((a) => a.length ? Math.max(...a.map((p) => p.x)) : null),
        phases.recoveryEnd, relSecOf(ev.EXPERIMENT_COMPLETED, runStartUs),
    ]), [series, phases, ev, runStartUs]);

    // Gera as imagens sempre que os dados mudam (fica pronto antes de o usuário clicar em imprimir)
    useEffect(() => {
        if (!data || !active) return;
        const id = setTimeout(() => {
            setImages({
                throughput: renderChartImage({ width: 1400, height: 380, title: "Vazão de comandos", yTitle: "ops/s", datasets: [{ label: "Vazão", data: fillThroughputGaps(series.throughput, 0), color: "#1d4ed8" }], phases, xMax, yMin: 0 }),
                cpu: renderChartImage({ width: 680, height: 380, title: "Uso de CPU (redis-server)", yTitle: "% de um núcleo", datasets: [{ label: "CPU", data: series.cpu, color: "#0369a1" }], phases, xMax, yMin: 0 }),
                memory: renderChartImage({ width: 680, height: 380, title: "Memória residente (redis-server)", yTitle: "MB", datasets: [{ label: "Memória", data: series.memoryMb, color: "#4338ca" }], phases, xMax, yMin: 0 }),
            });
        }, 300); // agrupa atualizações rápidas da telemetria ao vivo
        return () => clearTimeout(id);
    }, [data, active, series, phases, xMax]);

    if (!data || !active) return null;

    const db = data.database;
    const lp = data.loadPhases || null;
    const restoredNote = db?.restoredFromBackup
        ? `A base foi restaurada do backup imediatamente antes do início${num(db.restoreDurationMs) !== null ? ` (${brInt(db.restoreDurationMs)} ms)` : ""}; o log indexado estava, portanto, no cache de disco do sistema operacional (cache quente).${num(db.syncDurationMs) !== null ? ` Em seguida foi executado sync (${brInt(db.syncDurationMs)} ms) para gravar as cópias no disco antes do início, de modo que a escrita pendente não concorresse com a leitura do preload.` : ""}`
        : null;

    const timeline = buildTimeline(ev, runStartUs);

    return createPortal(
        <div className="print-root"><div className="print-report bg-white text-black font-serif leading-relaxed text-sm p-4 w-full">
            <div className="text-center space-y-1 border-b-2 border-double border-black pb-3 mb-5">
                <h1 className="text-xl font-bold tracking-wide">Relatório Técnico Experimental — MM-DIRECT</h1>
                <p className="text-xs">
                    Experimento <strong className="font-mono">{data.runId}</strong>
                    {data.folderId && data.folderId !== data.runId && <> (pasta <span className="font-mono">{data.folderId}</span>)</>}
                    {" · "}Início: {dateTime(runStartUs)}
                </p>
                <p className="text-xs">Modo: <strong>{data.modeLabel}</strong> · Situação: <strong>{data.statusLabel}</strong></p>
            </div>

            <div className="space-y-5">
                <section>
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">I. Resultados medidos</h2>
                    <table className="w-full text-xs border-collapse">
                        <thead><tr><Th>Medida</Th><Th>Valor</Th><Th>Origem</Th></tr></thead>
                        <tbody>
                            <tr><Td>Duração do preload</Td><Td mono>{brSec(preloadS)}</Td><Td>PRELOAD_STARTED → PRELOAD_COMPLETED</Td></tr>
                            {lp && num(lp.preloadReadS) !== null && <>
                                <tr><Td>&nbsp;&nbsp;· contagem do log antes da leitura</Td><Td mono>{brSec(lp.preloadCountS)}</Td><Td>PRELOAD_STARTED → PRELOAD_INDEX_OPEN</Td></tr>
                                <tr><Td>&nbsp;&nbsp;· leitura do log indexado</Td><Td mono>{brSec(lp.preloadReadS)}{num(lp.preloadRate) !== null && ` (${brInt(lp.preloadRate)} registros/s)`}</Td><Td>PRELOAD_INDEX_OPEN → PRELOAD_COMPLETED</Td></tr>
                            </>}
                            <tr><Td>Operação estável até a falha</Td><Td mono>{brSec(stableS)}{failureTarget !== null && ` (configurado: ${brSec(failureTarget, 0)})`}</Td><Td>STABLE_OPERATION_STARTED → FAILURE_TRIGGERED</Td></tr>
                            <tr><Td>Intervalo entre a falha e o início da recuperação</Td><Td mono>{brSec(downtimeS)}</Td><Td>FAILURE_TRIGGERED → RECOVERY_STARTED</Td></tr>
                            <tr><Td>Duração da recuperação</Td><Td mono>{brSec(recoveryS)}</Td><Td>RECOVERY_STARTED → RECOVERY_COMPLETED</Td></tr>
                            {lp && num(lp.recoveryReadS) !== null && <>
                                <tr><Td>&nbsp;&nbsp;· contagem do log antes da leitura</Td><Td mono>{brSec(lp.recoveryCountS)}</Td><Td>RECOVERY_STARTED → PRELOAD_INDEX_OPEN</Td></tr>
                                <tr><Td>&nbsp;&nbsp;· leitura do log indexado</Td><Td mono>{brSec(lp.recoveryReadS)}{num(lp.recoveryRate) !== null && ` (${brInt(lp.recoveryRate)} registros/s)`}</Td><Td>PRELOAD_INDEX_OPEN → RECOVERY_COMPLETED</Td></tr>
                            </>}
                            <tr><Td>Tuplas carregadas no preload</Td><Td mono>{brInt(ev.PRELOAD_COMPLETED?.loadedTuples)}</Td><Td>PRELOAD_COMPLETED</Td></tr>
                            <tr><Td>Tuplas carregadas na recuperação</Td><Td mono>{brInt(ev.RECOVERY_COMPLETED?.loadedTuples)}</Td><Td>RECOVERY_COMPLETED</Td></tr>
                            {data.recoverySplit && num(data.recoverySplit.onDemand) !== null && (
                                <tr><Td>&nbsp;&nbsp;· incrementalmente / sob demanda</Td><Td mono>{brInt(data.recoverySplit.incremental)} / {brInt(data.recoverySplit.onDemand)}</Td><Td>Log do Redis-IR (DB loaded from Indexed Log)</Td></tr>
                            )}
                            {workloadRunS !== null && (
                                <tr><Td>{ev.WORKLOAD_FINISHED ? "Execução da carga após a falha" : "Execução da carga após a falha (interrompida)"}</Td><Td mono>{brSec(workloadRunS)}</Td><Td>{ev.WORKLOAD_FINISHED ? "FAILURE_TRIGGERED → WORKLOAD_FINISHED" : "FAILURE_TRIGGERED → WORKLOAD_STOPPED"}</Td></tr>
                            )}
                            <tr><Td>Registros do log processados na recuperação</Td><Td mono>{brInt(ev.RECOVERY_COMPLETED?.recordsProcessed)}</Td><Td>RECOVERY_COMPLETED</Td></tr>
                            <tr><Td>Inconsistências na recuperação</Td><Td mono>{brInt(ev.RECOVERY_COMPLETED?.inconsistencies)}</Td><Td>RECOVERY_COMPLETED</Td></tr>
                        </tbody>
                    </table>
                    {(phases.extraCycles?.length ?? 0) > 0 && (
                        <>
                            <h3 className="text-xs font-bold mt-3 mb-1">Falhas sucessivas</h3>
                            <table className="w-full text-xs border-collapse">
                                <thead><tr><Th>Falha</Th><Th>Instante da falha</Th><Th>Início da recuperação</Th><Th>Fim da recuperação</Th><Th>Duração da recuperação</Th></tr></thead>
                                <tbody>
                                    {[{ failure: phases.failure as number, recoveryStart: phases.recoveryStart, recoveryEnd: phases.recoveryEnd }, ...(phases.extraCycles || [])].map((c, i) => (
                                        <tr key={i}>
                                            <Td>{i + 1}</Td><Td mono>{brSec(c.failure)}</Td><Td mono>{brSec(c.recoveryStart)}</Td><Td mono>{brSec(c.recoveryEnd)}</Td>
                                            <Td mono>{c.recoveryStart !== null && c.recoveryEnd !== null ? brSec(c.recoveryEnd - c.recoveryStart) : "—"}</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}
                    {(phases.checkpoints?.length ?? 0) > 0 && (
                        <>
                            <h3 className="text-xs font-bold mt-3 mb-1">Checkpoints</h3>
                            <table className="w-full text-xs border-collapse">
                                <thead><tr><Th>Checkpoint</Th><Th>Tipo</Th><Th>Início</Th><Th>Fim</Th><Th>Duração</Th><Th>Situação</Th></tr></thead>
                                <tbody>
                                    {(phases.checkpoints || []).map((cp, i) => (
                                        <tr key={i}>
                                            <Td>{cp.id ?? i + 1}</Td><Td>{cp.kind === "MFU" ? "TuCC-MFU" : "TuCC (completo)"}</Td>
                                            <Td mono>{brSec(cp.start)}</Td><Td mono>{brSec(cp.end)}</Td>
                                            <Td mono>{cp.end !== null ? brSec(cp.end - cp.start) : "—"}</Td>
                                            <Td>{cp.end === null ? "em andamento" : cp.interrupted ? "interrompido" : "concluído"}</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="text-[10px] mt-1">Tempos em segundos desde o início do experimento (eventos CHECKPOINT_STARTED / CHECKPOINT_FINISHED do Redis-IR).</p>
                        </>
                    )}
                </section>

                <section>
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">II. Base experimental</h2>
                    {db ? (
                        <table className="w-full text-xs border-collapse">
                            <tbody>
                                <tr><Td>Tamanho</Td><Td mono>{db.sizePreset ? ({ small: "Pequena", medium: "Média", large: "Grande", xlarge: "Muito grande" } as Record<string, string>)[db.sizePreset] || db.sizePreset : "Não registrado (base gerada sem preset de tamanho)"}</Td></tr>
                                <tr><Td>Registros no log / tuplas distintas</Td><Td mono>{brInt(db.records)} / {brInt(db.distinctTuples)}</Td></tr>
                                <tr><Td>Tamanho do log indexado no início</Td><Td mono>{brBytes(db.indexedLogSizeBytes)}</Td></tr>
                                <tr><Td>Gerada com (memtier)</Td><Td mono>{db.generatedWith || "—"}</Td></tr>
                                <tr><Td>Gerada em</Td><Td mono>{db.generatedAt ? new Date(db.generatedAt).toLocaleString("pt-BR", { hour12: false, timeZone: "America/Sao_Paulo" }) : "—"}</Td></tr>
                                <tr><Td>Restaurada do backup antes do início</Td><Td mono>{db.restoredFromBackup ? `Sim (cópia ${brInt(db.restoreDurationMs)} ms${num(db.syncDurationMs) !== null ? `; sync ${brInt(db.syncDurationMs)} ms` : ""})` : "Não"}</Td></tr>
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-xs">Informação da base não registrada para este experimento.</p>
                    )}
                </section>

                <section>
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">III. Configuração do experimento</h2>
                    <table className="w-full text-xs border-collapse">
                        <thead><tr><Th>Parâmetro</Th><Th>Valor</Th></tr></thead>
                        <tbody>
                            <tr><Td>Recuperação instantânea (log indexado)</Td><Td mono>{cfg.instantRecoveryState || "—"}</Td></tr>
                            <tr><Td>Indexação síncrona</Td><Td mono>{cfg.instantRecoverySynchronous || "—"}</Td></tr>
                            <tr><Td>Intervalo do indexador (indexer_time_interval)</Td><Td mono>{num(cfg.indexerTimeInterval) !== null ? `${brInt(cfg.indexerTimeInterval)} µs` : "—"}</Td></tr>
                            <tr><Td>Checkpoint</Td><Td mono>{cfg.checkpointState || "—"}{cfg.checkpointState === "ON" && ` (intervalo ${cfg.checkpointTimeInterval} s)`}</Td></tr>
                            <tr><Td>Falha simulada</Td><Td mono>{failureMode}{failureTarget !== null && ` · ${brSec(failureTarget, 0)} após o início da operação estável · ${restarts ?? "—"} reinício(s)`}</Td></tr>
                            <tr><Td>Atraso do reinício</Td><Td mono>{cfg.restartDaleyTime !== undefined ? `${cfg.restartDaleyTime} s` : "—"}</Td></tr>
                            <tr><Td>Carga (memtier)</Td><Td mono>{cfg.memtierBenchmarkState || "—"}</Td></tr>
                            <tr><Td>Parâmetros do memtier</Td><Td mono>{cfg.memtierBenchmarkParameters || "—"}</Td></tr>
                            <tr><Td>Intervalo do monitoramento de CPU/memória</Td><Td mono>{cfg.systemMonitoringTimeInterval ? `${cfg.systemMonitoringTimeInterval} s` : "—"}</Td></tr>
                        </tbody>
                    </table>
                </section>

                <section className="break-inside-avoid">
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">IV. Cronologia de eventos</h2>
                    {timeline.length > 0 ? (
                        <table className="w-full text-xs border-collapse">
                            <thead><tr><Th>Evento</Th><Th>Horário</Th><Th>t (s desde o início)</Th><Th>Observação</Th></tr></thead>
                            <tbody>
                                {timeline.map((t) => (
                                    <tr key={t.event}><Td>{t.label}</Td><Td mono>{t.clock}</Td><Td mono>{brNum(t.rel, 3)}</Td><Td>{t.detail}</Td></tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-xs">Nenhum evento estruturado registrado.</p>
                    )}
                </section>

                <section>
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">V. Vazão e recursos</h2>
                    <table className="w-full text-xs border-collapse">
                        <thead><tr><Th>Medida</Th><Th>Média</Th><Th>Pico</Th><Th>Base do cálculo</Th></tr></thead>
                        <tbody>
                            <tr><Td>Vazão de comandos (ops/s)</Td><Td mono>{brNum(tp.avg, 1)}</Td><Td mono>{brNum(tp.peak, 0)}</Td><Td>Comandos executados por segundo, nos segundos com comandos</Td></tr>
                            <tr><Td>CPU do redis-server (% de um núcleo)</Td><Td mono>{brNum(cpu.avg, 1)}</Td><Td mono>{brNum(cpu.peak, 1)}</Td><Td>Amostras do top durante todo o experimento</Td></tr>
                            <tr><Td>Memória residente (MB)</Td><Td mono>{brNum(mem.avg, 1)}</Td><Td mono>{brNum(mem.peak, 1)}</Td><Td>Amostras do top durante todo o experimento</Td></tr>
                            {data.files && (
                                <tr><Td>Arquivos ao final (log sequencial / log indexado)</Td><Td mono>{brBytes(data.files.aofBytes)}</Td><Td mono>{brBytes(data.files.indexedLogBytes)}</Td><Td>Tamanho em disco</Td></tr>
                            )}
                        </tbody>
                    </table>
                </section>

                <section className="break-inside-avoid">
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">VI. Gráficos</h2>
                    {images.throughput || images.cpu || images.memory ? (
                        <>
                            {images.throughput && <img src={images.throughput} alt="Vazão de comandos" className="w-full border border-black" />}
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {images.cpu && <img src={images.cpu} alt="Uso de CPU" className="w-full border border-black" />}
                                {images.memory && <img src={images.memory} alt="Memória residente" className="w-full border border-black" />}
                            </div>
                            <p className="text-[10px] mt-1">
                                Faixas: preload (ciano), reinicialização entre a falha e a recuperação (vermelho), recuperação (âmbar); linha tracejada = falha simulada; linha verde = fim da recuperação; faixa violeta tracejada = checkpoint.
                                Eixo horizontal em segundos desde o início do experimento, igual em todos os gráficos.
                            </p>
                        </>
                    ) : (
                        <p className="text-xs">
                            {data.reconstructed
                                ? "Sem séries temporais: os CSVs de vazão e de CPU/memória deste experimento não foram salvos (resultados reconstruídos a partir do log)."
                                : "Sem séries temporais registradas."}
                        </p>
                    )}
                </section>

                <section className="break-inside-avoid">
                    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">VII. Notas metodológicas</h2>
                    <ul className="text-xs list-disc pl-5 space-y-0.5">
                        <li>Durações e cronologia calculadas a partir dos eventos estruturados registrados pelo Redis-IR (EVENT_JSON), com resolução de microssegundos.</li>
                        <li>CPU medida pelo top em escala de um núcleo: valores acima de 100% indicam uso de mais de um núcleo.</li>
                        {restoredNote && <li>{restoredNote}</li>}
                        {data.reconstructed && <li>Resultados reconstruídos a partir do logs.txt após o experimento.</li>}
                    </ul>
                </section>
            </div>
        </div></div>,
        document.body
    );
};

export default ExperimentReport;
