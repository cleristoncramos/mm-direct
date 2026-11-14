/**
 * Página do histórico de experimentos.
 * Interface em inglês (como a tela do experimento), dicas em português, relatórios PDF em português.
 * Textos: i18n/strings.ts (UI.history e TIP.history).
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { TECHNIQUE_LABEL, techniqueOf } from "./History/comparison";
import ExperimentReport, { ExperimentReportData, eventsFromResults, statusLabelFromResults, buildTimeline, phasesFromEvents } from "./Report/ExperimentReport";
import { summarizeRun, filterRuns, DEFAULT_FILTERS, RunFilters, RunStatusKey, RunSummary, STATUS_META, SIZE_LABEL } from "./History/runSummary";
import AnnotationsEditor from "./History/AnnotationsEditor";
import ComparisonView, { RUN_COLORS, RUN_TAGS, CompareTab, AlignMode } from "./History/ComparisonView";
import ComparisonReport from "./Report/ComparisonReport";
import ExportMenu from "./History/ExportMenu";
import { computeRunMetrics, downloadText } from "./History/comparison";
import TransactionChart from "./Charts/TransferChart";
import CpuChart from "./Charts/CpuChart";
import MemoryChart from "./Charts/MemoryChart";
import { TelemetryPoint } from "./Charts/types";
import { PHASE_COLORS, sharedXMax } from "./Charts/phaseAnnotations";
import { UI, TIP } from "../i18n/strings";
import { fmtNum, fmtDateTime } from "../utils/format";

const H = UI.history;
const API = "http://localhost:8081";

interface HistoryPanelProps {
    onBack: () => void;
}

const StatusBadge = ({ status }: { status: RunStatusKey }) => {
    const m = STATUS_META[status];
    return <span title={m.tip} className={`px-2 py-0.5 rounded-none text-[10px] font-bold border whitespace-nowrap ${m.cls}`}>{m.label}</span>;
};

const fmtS = (v: number | null, d = 2) => v === null ? "—" : `${fmtNum(v, d)} s`;

/** Por que um valor está vazio (dica em português) */
const missingReason = (sum: RunSummary, kind: "preload" | "stable" | "recovery") => {
    if (sum.status === "Missing") return TIP.history.missingNoResults;
    if (sum.status === "Failed") return TIP.history.missingFailed;
    if (sum.status === "Interrupted") return TIP.history.missingInterrupted;
    if (kind !== "preload" && sum.failureMode === "none") return TIP.history.missingNoFailure;
    return TIP.history.missingOld;
};

const inputCls = "bg-slate-950 border border-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500";
const selectCls = "bg-slate-950 border border-slate-800 px-1.5 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-blue-500";
const btnCls = "px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 rounded-none text-xs font-semibold transition text-slate-200";
const sectionTitle = "text-[11px] uppercase font-bold tracking-wider text-slate-400";

const toPoints = (rows: any[] | undefined, col: number, scale = 1): TelemetryPoint[] =>
    Array.isArray(rows)
        ? rows.map((r) => ({ runId: "", timestampUs: 0, relativeSeconds: Number(r[0]), value: Number(r[col]) * scale }))
            .filter((p) => Number.isFinite(p.relativeSeconds) && Number.isFinite(p.value))
        : [];

const HistoryPanel = ({ onBack }: HistoryPanelProps) => {
    const [runs, setRuns] = useState<any[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [comparisonMode, setComparisonMode] = useState<boolean>(false);
    const [selectedExperiments, setSelectedExperiments] = useState<string[]>([]);
    const [warningMessage, setWarningMessage] = useState<string | null>(null);

    const [comparisonTelemetries, setComparisonTelemetries] = useState<Map<string, any>>(new Map());
    const [loadingTelemetry, setLoadingTelemetry] = useState<boolean>(false);
    const telemetryCacheRef = useRef<Map<string, any>>(new Map());

    const [selectedTelemetry, setSelectedTelemetry] = useState<any>(null);
    const [loadingSelectedTelemetry, setLoadingSelectedTelemetry] = useState<boolean>(false);
    const [showArchived, setShowArchived] = useState<boolean>(false);
    const [filters, setFilters] = useState<RunFilters>(DEFAULT_FILTERS);
    const [listError, setListError] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<boolean>(false);
    const [compareTab, setCompareTab] = useState<CompareTab>("side");
    const [alignMode, setAlignMode] = useState<AlignMode>("failure");

    // Telemetria do experimento selecionado
    useEffect(() => {
        if (!selectedRunId) {
            setSelectedTelemetry(null);
            return;
        }
        let cancelled = false;
        setSelectedTelemetry(null);
        setLoadingSelectedTelemetry(true);
        fetch(`${API}/api/runs/${selectedRunId}/telemetry`)
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setSelectedTelemetry(data); })
            .catch((err) => console.error("Erro ao carregar telemetria do experimento:", err))
            .finally(() => { if (!cancelled) setLoadingSelectedTelemetry(false); });
        return () => { cancelled = true; };
    }, [selectedRunId]);

    // Lista de experimentos (ativos ou arquivados)
    const loadRunsList = (archived = showArchived, keepId: string | null = selectedRunId) => {
        fetch(`${API}/api/runs${archived ? "?archived=1" : ""}`)
            .then((res) => res.json())
            .then((data) => {
                const arr = Array.isArray(data) ? data : [];
                setRuns(arr);
                setListError(null);
                if (!keepId || !arr.some((r) => r.id === keepId)) {
                    setSelectedRunId(arr.length > 0 ? arr[0].id : null);
                }
            })
            .catch((err) => {
                console.error("Erro ao carregar experimentos:", err);
                setListError(H.listError);
            });
    };

    useEffect(() => {
        setSelectedExperiments([]);
        loadRunsList(showArchived, null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showArchived]);

    const summaries = useMemo(() => (Array.isArray(runs) ? runs.map(summarizeRun) : []), [runs]);
    const visibleSummaries = useMemo(() => filterRuns(summaries, filters), [summaries, filters]);
    const summaryById = useMemo(() => new Map(summaries.map((x) => [x.id, x] as [string, RunSummary])), [summaries]);
    const filtersActive = filters.q !== "" || filters.status !== "" || filters.mode !== "";

    const applyAnnotations = (runId: string, annotations: any) => {
        setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, annotations } : r)));
    };

    // Arquiva (src/runs/_archive/) ou restaura
    const toggleArchive = async (run: any) => {
        const toArchive = !run.archived;
        if (!window.confirm(toArchive ? H.archiveConfirm(run.id) : H.restoreConfirm(run.id))) return;
        setBusyAction(true);
        try {
            const res = await fetch(`${API}/api/runs/${run.id}/${toArchive ? "archive" : "unarchive"}`, { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
            const idx = visibleSummaries.findIndex((x) => x.id === run.id);
            const next = visibleSummaries[idx + 1]?.id || visibleSummaries[idx - 1]?.id || null;
            loadRunsList(showArchived, next);
            setSelectedRunId(next);
        } catch (e: any) {
            setWarningMessage(H.archiveFailed(toArchive ? "archive" : "restore", e?.message || String(e)));
        } finally {
            setBusyAction(false);
        }
    };

    const selectedRun = useMemo(
        () => (Array.isArray(runs) ? (runs.find((r) => r.id === selectedRunId) || null) : null),
        [runs, selectedRunId]
    );

    // Dados do relatório PDF de um experimento (mesmo componente da tela ao vivo; em português)
    const historyReportData = useMemo<ExperimentReportData | null>(() => {
        if (!selectedRun) return null;
        const res = selectedRun.results || {};
        const meta = selectedRun.metadata || {};
        const tel = selectedTelemetry;
        const rows = (arr: any[] | undefined, col: number, scale = 1) =>
            Array.isArray(arr) ? arr.map((r) => ({ x: Number(r[0]), y: Number(r[col]) * scale })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
        const cfg = meta.config || {};
        return {
            runId: res.runId || selectedRun.id,
            folderId: selectedRun.id,
            runStartUs: res.runStartUs ? Number(res.runStartUs) : (tel?.runStartUs ? Number(tel.runStartUs) : null),
            statusLabel: statusLabelFromResults(res.experimentStatus),
            modeLabel: TECHNIQUE_LABEL[techniqueOf(selectedRun)].pt,
            config: cfg,
            database: meta.database ?? null,
            events: eventsFromResults(res),
            series: {
                throughput: rows(tel?.throughput, 1),
                cpu: rows(tel?.monitoring, 1),
                memoryMb: rows(tel?.monitoring, 2, 1 / 1024),
            },
            files: { aofBytes: res.aofSizeBytes ?? null, indexedLogBytes: res.indexedLogSizeBytes ?? null },
            reconstructed: !!res.reconstructed,
            recoverySplit: { incremental: res.incrementalTuples ?? null, onDemand: res.onDemandTuples ?? null },
            eventList: Array.isArray(res.eventList) ? res.eventList : null,
            loadPhases: {
                preloadCountS: res.preloadCountSeconds ?? null, preloadReadS: res.preloadReadSeconds ?? null, preloadRate: res.preloadReadRecordsPerSecond ?? null,
                recoveryCountS: res.recoveryCountSeconds ?? null, recoveryReadS: res.recoveryReadSeconds ?? null, recoveryRate: res.recoveryReadRecordsPerSecond ?? null,
            },
        };
    }, [selectedRun, selectedTelemetry]);

    // Séries e fases do experimento selecionado (gráficos da página, mesmas cores e faixas da tela ao vivo)
    const detailCharts = useMemo(() => {
        if (!selectedRun) return null;
        const res = selectedRun.results || {};
        const events = eventsFromResults(res);
        const runStartUs = res.runStartUs ? Number(res.runStartUs) : (selectedTelemetry?.runStartUs ? Number(selectedTelemetry.runStartUs) : null);
        const phases = phasesFromEvents(events, runStartUs, Array.isArray(res.eventList) ? res.eventList : null);
        const throughput = toPoints(selectedTelemetry?.throughput, 1);
        const cpu = toPoints(selectedTelemetry?.monitoring, 1);
        const memory = toPoints(selectedTelemetry?.monitoring, 2, 1 / 1024);
        const last = (a: TelemetryPoint[]) => a.length ? Math.max(...a.map((p) => p.relativeSeconds)) : null;
        const xMax = sharedXMax([last(throughput), last(cpu), last(memory), phases.recoveryEnd]);
        const rec = events.RECOVERY_COMPLETED;
        return {
            phases, throughput, cpu, memory, xMax,
            recoveryMetadata: rec ? {
                loadedTuples: Number(rec.loadedTuples ?? 0),
                inconsistencies: Number(rec.inconsistencies ?? 0),
                recordsProcessed: Number(rec.recordsProcessed ?? 0),
            } : null,
        };
    }, [selectedRun, selectedTelemetry]);

    // Experimentos selecionados para comparação (ordem da seleção)
    const selectedRuns = useMemo(() => {
        if (!Array.isArray(runs)) return [];
        return selectedExperiments
            .map((id) => runs.find((r) => r.id === id))
            .filter((r): r is any => r !== undefined);
    }, [runs, selectedExperiments]);

    const comparisonMetrics = useMemo(
        () => selectedRuns.map((r, i) => computeRunMetrics(r, comparisonTelemetries.get(r.id) || null, RUN_TAGS[i])),
        [selectedRuns, comparisonTelemetries]
    );
    // Grupos de repetição: experimentos visíveis na lista (com os filtros)
    const listRunsForGroups = useMemo(() => {
        const ids = new Set(visibleSummaries.map((x) => x.id));
        return runs.filter((r) => ids.has(r.id));
    }, [runs, visibleSummaries]);

    const toggleExperiment = (id: string) => {
        setSelectedExperiments((current) => {
            if (current.includes(id)) {
                setWarningMessage(null);
                return current.filter((item) => item !== id);
            }
            if (current.length >= 3) {
                setWarningMessage(H.limit3);
                setTimeout(() => setWarningMessage(null), 3000);
                return current;
            }
            setWarningMessage(null);
            return [...current, id];
        });
    };

    const toggleComparisonMode = () => {
        setComparisonMode(!comparisonMode);
        setSelectedExperiments([]);
        setWarningMessage(null);
    };

    // Telemetria dos experimentos em comparação
    useEffect(() => {
        if (selectedExperiments.length === 0) {
            setComparisonTelemetries(new Map());
            return;
        }
        // Cada experimento é buscado uma vez só (cache por id). Antes, cada clique de seleção
        // buscava todos de novo e uma resposta antiga, chegando depois, sobrescrevia a nova:
        // o último experimento escolhido ficava sem curvas no relatório (14/11/2026).
        let cancelled = false;
        const cache = telemetryCacheRef.current;
        const showFromCache = () => {
            const map = new Map();
            selectedExperiments.forEach((id) => { if (cache.has(id)) map.set(id, cache.get(id)); });
            setComparisonTelemetries(map);
        };
        const pendingActive = new Set<string>();
        const missing = selectedExperiments.filter((id) => !cache.has(id));
        showFromCache();
        if (missing.length === 0) {
            setLoadingTelemetry(false);
            return;
        }
        setLoadingTelemetry(true);
        Promise.all(missing.map((id) =>
            fetch(`${API}/api/runs/${id}/telemetry`)
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                    if (!data || !Array.isArray(data.throughput)) return;
                    cache.set(id, data);
                    // Um experimento ainda em execução tem curvas parciais: não fica guardado.
                    if (runs.find((r) => r.id === id)?.active) { pendingActive.add(id); }
                })
                .catch(() => {})
        )).then(() => {
            if (cancelled) { pendingActive.forEach((id) => cache.delete(id)); return; }
            showFromCache();
            pendingActive.forEach((id) => cache.delete(id));
            setLoadingTelemetry(false);
        });
        return () => { cancelled = true; };
    }, [selectedExperiments]);

    const downloadJsonReport = (run: any) => {
        if (!run?.report) return;
        downloadText(JSON.stringify(run.report, null, 2), `report_${run.id}.json`, "application/json");
    };

    const downloadComparativeJsonReport = () => {
        if (selectedRuns.length === 0) return;
        const exportObject = {
            exportedAt: new Date().toISOString(),
            comparisonMode: true,
            baselineRunId: selectedRuns[0]?.id,
            experiments: selectedRuns.map((run, index) => ({
                tag: RUN_TAGS[index],
                isBaseline: index === 0,
                runId: run.id,
                annotations: run.annotations || null,
                metadata: run.metadata,
                results: run.results,
                report: run.report,
            })),
        };
        downloadText(JSON.stringify(exportObject, null, 2), `comparison_${selectedRuns.map((r) => r.id.replace(/^run_/, "")).join("_")}.json`, "application/json");
    };

    // Impressão: o título da janela vira o nome sugerido do PDF
    const triggerPdfPrint = () => {
        const originalTitle = document.title;
        document.title = comparisonMode
            ? (compareTab === "repetitions" ? "repeticoes" : `comparacao_${selectedRuns.map((r) => r.id.replace(/^run_/, "")).join("_")}`)
            : `relatorio_${(selectedRunId || "experimento").replace(/^run_/, "")}`;
        window.print();
        document.title = originalTitle;
    };

    return (
        <div className="flex flex-col min-h-full bg-slate-950 text-slate-100 font-sans">
            <div className="print:hidden px-6 py-4 space-y-4">

                {/* Linha de título (sem faixa: o History do cabeçalho também volta) */}
                <div className="flex items-center justify-between gap-4">
                    <h1 className="text-base font-semibold text-slate-200">{H.title}</h1>
                    <button onClick={onBack} title={TIP.history.back} className="text-xs text-slate-400 hover:text-slate-100 flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        {H.back}
                    </button>
                </div>

                {warningMessage && (
                    <div className="border-l-2 border-amber-500 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs flex justify-between items-center">
                        <span>{warningMessage}</span>
                        <button onClick={() => setWarningMessage(null)} className="text-amber-400 hover:text-amber-200" aria-label="Dismiss">✕</button>
                    </div>
                )}

                <div className="flex flex-col lg:flex-row gap-4 items-start">
                    {/* Lista de experimentos */}
                    <aside className="w-full lg:w-80 lg:flex-shrink-0 bg-slate-900 border border-slate-800 p-4 space-y-3 lg:sticky lg:top-4">
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3 gap-2">
                            <h2 className="text-sm font-semibold text-slate-200">
                                {showArchived ? H.archived : H.experiments}{" "}
                                <span className="text-slate-500 font-normal">
                                    ({filtersActive ? H.countOf(visibleSummaries.length, summaries.length) : summaries.length})
                                </span>
                            </h2>
                            <button
                                onClick={toggleComparisonMode}
                                title={TIP.history.compare}
                                className={`px-2.5 py-1 text-[11px] font-semibold border rounded-none transition whitespace-nowrap ${
                                    comparisonMode ? "bg-blue-600 text-white border-blue-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                                }`}
                            >
                                {comparisonMode ? H.exitCompare : H.compare}
                            </button>
                        </div>

                        {/* Filtros */}
                        <div className="space-y-2">
                            <input
                                value={filters.q}
                                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                                placeholder={H.search}
                                title={TIP.history.search}
                                className={`w-full ${inputCls}`}
                            />
                            <div className="grid grid-cols-3 gap-1.5">
                                <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as RunFilters["status"] })} title={TIP.history.status} className={selectCls}>
                                    <option value="">{H.status}</option>
                                    {(["Completed", "No failure", "Failed", "Interrupted", "Missing"] as RunStatusKey[]).map((k) => (
                                        <option key={k} value={k}>{STATUS_META[k].label}</option>
                                    ))}
                                </select>
                                <select value={filters.mode} onChange={(e) => setFilters({ ...filters, mode: e.target.value as RunFilters["mode"] })} title={TIP.history.mode} className={selectCls}>
                                    <option value="">{H.mode}</option>
                                    <option value="MM-DIRECT">MM-DIRECT</option>
                                    <option value="AOF">AOF</option>
                                </select>
                                <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as RunFilters["sort"] })} title={TIP.history.sort} className={selectCls}>
                                    <option value="newest">{H.sortNewest}</option>
                                    <option value="oldest">{H.sortOldest}</option>
                                    <option value="recoveryAsc">{H.sortRecAsc}</option>
                                    <option value="recoveryDesc">{H.sortRecDesc}</option>
                                </select>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                                <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer select-none" title={TIP.history.showArchived}>
                                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}
                                        className="rounded-none border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 w-3.5 h-3.5" />
                                    {H.showArchived}
                                </label>
                                {filtersActive && (
                                    <button onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} className="text-blue-400 hover:text-blue-300">
                                        {H.clearFilters}
                                    </button>
                                )}
                            </div>
                        </div>

                        {comparisonMode && (
                            <p className="text-[11px] text-blue-300 border-l-2 border-blue-600 bg-blue-950/30 px-2 py-1.5">{H.compareHint}</p>
                        )}
                        {listError && <p className="text-[11px] text-rose-300 border-l-2 border-rose-600 bg-rose-950/30 px-2 py-1.5">{listError}</p>}

                        <div className="space-y-1.5 overflow-y-auto max-h-[calc(100vh-330px)] pr-1 custom-scrollbar">
                            {visibleSummaries.length === 0 ? (
                                <p className="text-xs text-slate-500 text-center py-8">
                                    {summaries.length === 0 ? (showArchived ? H.emptyArchived : H.emptyActive) : H.emptyFiltered}
                                </p>
                            ) : (
                                visibleSummaries.map((sum) => {
                                    const isComparable = sum.status === "Completed";
                                    const selectedIndex = selectedExperiments.indexOf(sum.id);
                                    const isSelectedInComp = selectedIndex !== -1;
                                    const isSelected = comparisonMode ? isSelectedInComp : selectedRunId === sum.id;
                                    const isDisabledInComp = comparisonMode && !isComparable;
                                    const label = sum.annotations.label;
                                    const tags = sum.annotations.tags || [];

                                    const handleCardClick = () => {
                                        if (comparisonMode) {
                                            if (isComparable) toggleExperiment(sum.id);
                                        } else {
                                            setSelectedRunId(sum.id);
                                        }
                                    };

                                    return (
                                        <div
                                            key={sum.id}
                                            onClick={handleCardClick}
                                            title={isDisabledInComp ? TIP.history.notComparable : undefined}
                                            className={`p-2.5 border-l-2 border transition relative ${
                                                isDisabledInComp ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-slate-800/40"
                                            } ${
                                                isSelected ? "bg-slate-800/60 border-slate-700 border-l-blue-500" : "bg-slate-950/40 border-slate-800/80 border-l-transparent"
                                            }`}
                                        >
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        {comparisonMode && isSelectedInComp && (
                                                            <span className="px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: RUN_COLORS[selectedIndex] }}>
                                                                {RUN_TAGS[selectedIndex]}
                                                            </span>
                                                        )}
                                                        <span className={`truncate text-xs font-semibold ${label ? "text-slate-100" : "font-mono text-slate-200"}`}>{label || sum.id}</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                                                        {fmtDateTime(sum.startedAt)}
                                                        {label && <> · <span className="font-mono">{sum.id}</span></>}
                                                    </div>
                                                </div>
                                                <StatusBadge status={sum.status} />
                                            </div>

                                            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                                                <div><span className="text-slate-500 block">{H.preload}</span><span className="font-mono text-cyan-300">{fmtS(sum.preloadS)}</span></div>
                                                <div><span className="text-slate-500 block">{H.stableOp}</span><span className="font-mono text-slate-300">{fmtS(sum.stableS, 1)}</span></div>
                                                <div><span className="text-slate-500 block">{H.recovery}</span><span className="font-mono text-amber-300">{fmtS(sum.recoveryS)}</span></div>
                                            </div>

                                            <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
                                                <span className="px-1 py-px border border-slate-700 text-slate-400">{sum.mode}</span>
                                                {sum.sizePreset && <span className="px-1 py-px border border-slate-700 text-slate-400">{H.base(SIZE_LABEL.en[sum.sizePreset] || sum.sizePreset)}</span>}
                                                {sum.preloadedTuples !== null && <span className="px-1 py-px border border-slate-700 text-slate-400">{H.tuples(fmtNum(sum.preloadedTuples, 0))}</span>}
                                                {!sum.memtier && <span className="px-1 py-px border border-slate-700 text-slate-500">{H.noLoad}</span>}
                                                {sum.reconstructed && <span className="px-1 py-px border border-slate-700 text-slate-500" title={TIP.history.reconstructed}>{H.reconstructed}</span>}
                                                {tags.map((t) => (
                                                    <button key={t} onClick={(e) => { e.stopPropagation(); setFilters({ ...filters, q: t }); }}
                                                        title={TIP.history.tagFilter}
                                                        className="px-1 py-px border border-blue-900 bg-blue-950/40 text-blue-300 hover:border-blue-600">
                                                        #{t}
                                                    </button>
                                                ))}
                                            </div>

                                            {comparisonMode && (
                                                <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex justify-between items-center">
                                                    <span className="text-[9px] text-slate-500">
                                                        {isComparable ? (isSelectedInComp ? H.selected : H.clickToSelect) : H.notComparable}
                                                    </span>
                                                    <input type="checkbox" readOnly disabled={isDisabledInComp} checked={isSelectedInComp}
                                                        className="rounded-none border-slate-800 bg-slate-900 text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </aside>

                    {/* Área principal */}
                    <main className="flex-1 min-w-0 space-y-4">
                        {comparisonMode ? (
                            <ComparisonView
                                tab={compareTab}
                                setTab={setCompareTab}
                                align={alignMode}
                                setAlign={setAlignMode}
                                metrics={comparisonMetrics}
                                rawRuns={selectedRuns}
                                listRuns={listRunsForGroups}
                                loading={loadingTelemetry}
                                onCompare={(ids) => { setSelectedExperiments(ids); setCompareTab("side"); }}
                                onExportJson={downloadComparativeJsonReport}
                                onPrint={triggerPdfPrint}
                            />
                        ) : selectedRun ? (
                            (() => {
                                const sum = summaryById.get(selectedRun.id) || summarizeRun(selectedRun);
                                const res = selectedRun.results || {};
                                const cfg = selectedRun.metadata?.config || {};
                                const timeline = buildTimeline(eventsFromResults(res), res.runStartUs ? Number(res.runStartUs) : null, "en");
                                const failureTarget = sum.failureMode === "time" ? Number(cfg.restartAfterTime) : sum.failureMode === "preload" ? Number(cfg.preloadDatabaseAndRestart) : null;
                                const folder = `src/runs/${selectedRun.archived ? "_archive/" : ""}${selectedRun.id}`;
                                const tp = selectedRun.report?.throughputSummary?.averageThroughput;
                                const memPeak = selectedRun.report?.memorySummary?.peakMemory;
                                const charts = detailCharts;
                                const hasSeries = !!charts && (charts.throughput.length > 0 || charts.cpu.length > 0);
                                const cards = [
                                    { key: "preload", label: H.preload, tip: TIP.history.preload, value: fmtS(sum.preloadS, 3), color: "text-cyan-300", sub: sum.preloadedTuples !== null ? H.tuples(fmtNum(sum.preloadedTuples, 0)) : null, missing: sum.preloadS === null ? missingReason(sum, "preload") : null, sub2: sum.preloadReadS !== null ? H.readCount(fmtS(sum.preloadReadS, 3), fmtS(sum.preloadCountS, 3)) : null },
                                    { key: "stable", label: H.stableOp, tip: TIP.history.stableOp, value: fmtS(sum.stableS, 3), color: "text-slate-100", sub: failureTarget ? H.configured(`${failureTarget} s`) : H.noFailure, missing: sum.stableS === null ? missingReason(sum, "stable") : null },
                                    { key: "recovery", label: H.recovery, tip: TIP.history.recovery, value: fmtS(sum.recoveryS, 3), color: "text-amber-300", sub: sum.recoveredTuples !== null ? H.tuples(fmtNum(sum.recoveredTuples, 0)) : null, missing: sum.recoveryS === null ? missingReason(sum, "recovery") : null, sub2: sum.recoveryReadS !== null ? H.readCount(fmtS(sum.recoveryReadS, 3), fmtS(sum.recoveryCountS, 3)) : null },
                                    { key: "res", label: H.resources, tip: TIP.history.resources, value: tp ? `${fmtNum(tp, 0)} ops/s` : "—", color: "text-slate-100", sub: memPeak ? `${fmtNum(memPeak, 1)} MB` : null, missing: !tp ? TIP.history.missingTelemetry : null },
                                ];
                                return (
                                    <div className="bg-slate-900 border border-slate-800 p-5 space-y-5">
                                        {/* Cabeçalho do experimento */}
                                        <div className="flex justify-between items-start gap-4 border-b border-slate-800 pb-4">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h2 className="text-lg font-semibold text-white truncate">{sum.annotations.label || selectedRun.id}</h2>
                                                    <StatusBadge status={sum.status} />
                                                    {selectedRun.archived && <span className="px-2 py-0.5 text-[10px] font-bold border border-slate-600 text-slate-400">{H.archivedBadge}</span>}
                                                </div>
                                                <p className="text-xs text-slate-400 mt-1">
                                                    {sum.annotations.label && <><span className="font-mono">{selectedRun.id}</span> · </>}
                                                    {fmtDateTime(sum.startedAt)} · {sum.mode}
                                                    {sum.sizePreset && <> · {H.base(SIZE_LABEL.en[sum.sizePreset] || sum.sizePreset)}</>}
                                                </p>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button
                                                    onClick={() => toggleArchive(selectedRun)}
                                                    disabled={busyAction || sum.status === "Running"}
                                                    title={selectedRun.archived ? TIP.history.restore : TIP.history.archive}
                                                    className={btnCls}
                                                >
                                                    {selectedRun.archived ? H.restore : H.archive}
                                                </button>
                                                <ExportMenu items={[
                                                    { label: H.exportJson, ext: ".json", tip: TIP.history.exportJson, disabled: !selectedRun.report, onClick: () => downloadJsonReport(selectedRun) },
                                                    { label: H.exportPdf, ext: ".pdf", tip: TIP.history.exportPdf, onClick: triggerPdfPrint },
                                                ]} />
                                            </div>
                                        </div>

                                        {/* Tempos e recursos */}
                                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                                            {cards.map((c) => (
                                                <div key={c.key} className="bg-slate-950/50 border border-slate-800 p-3" title={c.missing || c.tip}>
                                                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{c.label}</span>
                                                    <div className={`text-xl font-semibold mt-1 font-mono ${c.value === "—" ? "text-slate-600" : c.color}`}>{c.value}</div>
                                                    <div className="text-[10px] text-slate-500 min-h-[14px]">{c.sub || ""}</div>
                                                    {"sub2" in c && c.sub2 && <div className="text-[10px] text-slate-500" title={TIP.history.readCount}>{c.sub2}</div>}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Gráficos */}
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                <h3 className={sectionTitle}>{H.charts}</h3>
                                                <div className="flex items-center gap-4 text-[10px] text-slate-400">
                                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border" style={{ background: PHASE_COLORS.preload.fill, borderColor: PHASE_COLORS.preload.border }}></span>{UI.charts.preload}</span>
                                                    <span className="flex items-center gap-1.5"><span className="w-3 inline-block border-t-2 border-dashed" style={{ borderColor: PHASE_COLORS.failure }}></span>{UI.charts.failure}</span>
                                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border" style={{ background: PHASE_COLORS.downtime.fill, borderColor: PHASE_COLORS.downtime.border }}></span>{UI.charts.restart}</span>
                                                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border" style={{ background: PHASE_COLORS.recovery.fill, borderColor: PHASE_COLORS.recovery.border }}></span>{UI.charts.recovery}</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 inline-block border-t-2" style={{ borderColor: PHASE_COLORS.recovered }}></span>{UI.charts.recovered}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border border-dashed" style={{ background: PHASE_COLORS.checkpoint.fill, borderColor: PHASE_COLORS.checkpoint.border }}></span>{UI.charts.checkpoint}</span>
                                                </div>
                                            </div>
                                            {loadingSelectedTelemetry ? (
                                                <div className="h-[120px] flex items-center justify-center text-xs text-slate-500 border border-slate-800">{H.loadingSeries}</div>
                                            ) : !hasSeries || !charts ? (
                                                <div className="h-[120px] flex items-center justify-center text-xs text-slate-500 border border-slate-800" title={sum.reconstructed ? TIP.history.reconstructed : undefined}>{H.noSeries}</div>
                                            ) : (
                                                <>
                                                    {charts.throughput.length > 0 && (
                                                        <div className="bg-slate-950/40 border border-slate-800 p-3">
                                                            <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1" title={TIP.throughput}>{UI.charts.throughput} <span className="normal-case tracking-normal font-normal text-slate-600">({UI.charts.throughputUnit})</span></h4>
                                                            <TransactionChart
                                                                data={charts.throughput}
                                                                chartMode="default"
                                                                failureTime={charts.phases.failure}
                                                                recoveryStartTime={charts.phases.recoveryStart}
                                                                recoveryEndTime={charts.phases.recoveryEnd}
                                                                recoveryMetadata={charts.recoveryMetadata}
                                                                phases={charts.phases}
                                                                xMax={charts.xMax}
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div className="bg-slate-950/40 border border-slate-800 p-3">
                                                            <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1" title={TIP.cpu}>{UI.charts.cpu} <span className="normal-case tracking-normal font-normal text-slate-600">({UI.charts.cpuUnit})</span></h4>
                                                            {charts.cpu.length > 0 ? <CpuChart chartMode="minimalist" data={charts.cpu} phases={charts.phases} xMax={charts.xMax} />
                                                                : <div className="h-[160px] flex items-center justify-center text-xs text-slate-500">{H.noSeries}</div>}
                                                        </div>
                                                        <div className="bg-slate-950/40 border border-slate-800 p-3">
                                                            <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1" title={TIP.memory}>{UI.charts.memory} <span className="normal-case tracking-normal font-normal text-slate-600">(MB)</span></h4>
                                                            {charts.memory.length > 0 ? <MemoryChart chartMode="minimalist" data={charts.memory} phases={charts.phases} xMax={charts.xMax} />
                                                                : <div className="h-[160px] flex items-center justify-center text-xs text-slate-500">{H.noSeries}</div>}
                                                        </div>
                                                    </div>
                                                    <p className="text-[10px] text-slate-500">{UI.charts.axisNote}</p>
                                                </>
                                            )}
                                        </div>

                                        {/* Cronologia e parâmetros */}
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                            <div className="bg-slate-950/40 border border-slate-800 p-4 space-y-2">
                                                <h3 className={sectionTitle}>{H.timeline}</h3>
                                                {timeline.length === 0 ? (
                                                    <p className="text-xs text-slate-500" title={missingReason(sum, "preload")}>{H.noEvents}</p>
                                                ) : (
                                                    <table className="w-full text-xs">
                                                        <tbody>
                                                            {timeline.map((t) => (
                                                                <tr key={t.event} className="border-b border-slate-800/60 last:border-0" title={t.detail || undefined}>
                                                                    <td className="py-1 text-slate-400">{t.label}</td>
                                                                    <td className="py-1 text-right font-mono text-[11px] text-slate-500 whitespace-nowrap">{t.clock}</td>
                                                                    <td className="py-1 pl-3 text-right font-mono text-[11px] text-slate-200 whitespace-nowrap">{t.rel === null ? "—" : `${fmtNum(t.rel, 3)} s`}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                            <div className="bg-slate-950/40 border border-slate-800 p-4 space-y-2">
                                                <h3 className={sectionTitle}>{H.parameters}</h3>
                                                <table className="w-full text-xs">
                                                    <tbody>
                                                        {([
                                                            [H.params.instantRecovery, cfg.instantRecoveryState || "—", undefined],
                                                            [H.params.indexer, cfg.indexerTimeInterval != null && cfg.indexerTimeInterval !== "" ? `${fmtNum(Number(cfg.indexerTimeInterval), 0)} µs` : "—", TIP.history.indexer],
                                                            [H.params.checkpoint, cfg.checkpointState === "ON" ? `ON · ${cfg.checkpointTimeInterval} s` : (cfg.checkpointState || "—"), undefined],
                                                            [H.params.failure, sum.failureMode === "time" ? H.params.failureTime(`${failureTarget} s`) : sum.failureMode === "preload" ? H.params.failurePreload(`${failureTarget} s`) : H.params.none, undefined],
                                                            [H.params.memtier, cfg.memtierBenchmarkState || "—", cfg.memtierBenchmarkParameters || undefined],
                                                        ] as [string, string, string | undefined][]).map(([k, v, tip]) => (
                                                            <tr key={k} className="border-b border-slate-800/60 last:border-0" title={tip}>
                                                                <td className="py-1 text-slate-400">{k}</td>
                                                                <td className="py-1 text-right font-mono text-[11px] text-slate-200">{v}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <AnnotationsEditor
                                            key={selectedRun.id}
                                            runId={selectedRun.id}
                                            initial={sum.annotations}
                                            onSaved={(a) => applyAnnotations(selectedRun.id, a)}
                                        />

                                        {/* Arquivos */}
                                        <details className="text-xs text-slate-400">
                                            <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wider font-bold text-slate-500 hover:text-slate-300">{H.files}</summary>
                                            <ul className="font-mono text-[11px] mt-2 space-y-0.5">
                                                <li className="text-slate-300">{folder}/</li>
                                                {["metadata.json", "results.json", "logs.txt", "datasets.csv", "system_monitoring.csv", "export/report.json", "annotations.json"].map((f) => (
                                                    <li key={f} className="pl-4 text-slate-500">{f}</li>
                                                ))}
                                            </ul>
                                        </details>
                                    </div>
                                );
                            })()
                        ) : (
                            <div className="bg-slate-900 border border-slate-800 p-16 text-center">
                                <p className="text-sm text-slate-500">{H.selectOne}</p>
                            </div>
                        )}
                    </main>
                </div>
            </div>

            {/* Relatórios para impressão (português), portados para o <body> */}
            <ComparisonReport
                kind={compareTab}
                metrics={comparisonMetrics}
                rawRuns={selectedRuns}
                listRuns={listRunsForGroups}
                active={comparisonMode}
            />
            <ExperimentReport data={historyReportData} active={!comparisonMode} />
        </div>
    );
};

export default HistoryPanel;
