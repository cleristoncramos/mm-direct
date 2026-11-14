import { useState, useEffect, useRef } from "react";
import { useExperimentStore } from "../../store/experimentStore";
import { UI, TIP } from "../../i18n/strings";
import { fmtBytes, fmtInt, fmtCompact, fmtApproxDuration, fmtElapsed, fmtDateTime } from "../../utils/format";
import { TooltipBadge } from "./InputTypes";

export interface DbStatus {
    exists: boolean;
    sizeBytes: number;
    records: number | null;
    distinctTuples: number | null;
    countsSource?: "redis-ir" | "aof" | "backup" | null;
    countsAt?: string | null;
    sizePreset?: string | null;
    path: string;
    backupExists: boolean;
    backupSizeBytes: number;
    isValid: boolean;
    lastValidation?: string;
}

interface SizePreset {
    key: string;
    label: string;
    records: number;
    tuples: number;
    seconds: number;
    diskBytes: number;
    indexedLogBytes: number;
    measured: boolean;
    /** Base pronta guardada na biblioteca (null se ainda não foi gerada) */
    library?: {
        records: number | null;
        distinctTuples: number | null;
        indexedLogSizeBytes: number;
        sequentialLogSizeBytes: number;
        createdAt: string | null;
    } | null;
}

interface SizePresetsResponse {
    defaultPreset: string;
    currentPreset: string | null;
    freeDiskBytes: number | null;
    presets: SizePreset[];
}

type PrepPhase = "idle" | "running" | "completed" | "failed";

interface PrepState {
    phase: PrepPhase;
    step: string | null;
    progress: number | null;
    startedAt: string | null;
    error: string | null;
}

interface DatabaseStatusSectionProps {
    isDisabled?: boolean;
    onStatusChange?: (status: DbStatus | null) => void;
    onPreparingChange?: (preparing: boolean) => void;
}

const API = "http://localhost:8081";
const CONTROL_WS = "ws://localhost:8081/control";

const DatabaseStatusSection = ({ isDisabled = false, onStatusChange, onPreparingChange }: DatabaseStatusSectionProps) => {
    const store = useExperimentStore();
    const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
    const [backendOnline, setBackendOnline] = useState<boolean>(true);
    const [prep, setPrep] = useState<PrepState>({ phase: "idle", step: null, progress: null, startedAt: null, error: null });
    const [elapsed, setElapsed] = useState<number>(0);
    const [lastResult, setLastResult] = useState<{ duration: number } | null>(null);
    const [sizeInfo, setSizeInfo] = useState<SizePresetsResponse | null>(null);
    const [selectedSize, setSelectedSize] = useState<string>("medium");
    const sizeTouchedRef = useRef(false);
    const [selecting, setSelecting] = useState<boolean>(false);
    const [selectError, setSelectError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
    // Fechada por padrão, como as demais seções do sidebar
    const [isOpen, setIsOpen] = useState<boolean>(false);

    const onStatusChangeRef = useRef(onStatusChange);
    onStatusChangeRef.current = onStatusChange;
    const onPreparingChangeRef = useRef(onPreparingChange);
    onPreparingChangeRef.current = onPreparingChange;

    const fetchDbStatus = async () => {
        try {
            const res = await fetch(`${API}/api/database-status`);
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                setDbStatus(data);
                setBackendOnline(true);
                onStatusChangeRef.current?.(data);
            }
        } catch (e) {
            console.error("Erro ao buscar status do banco:", e);
            setBackendOnline(false);
        }
    };

    const fetchSizePresets = async () => {
        try {
            const res = await fetch(`${API}/api/database-size-presets`);
            if (!res.ok) return;
            const data: SizePresetsResponse = await res.json();
            setSizeInfo(data);
            // Sugere o tamanho da base atual (ou o padrão) até o usuário escolher outro
            if (!sizeTouchedRef.current) setSelectedSize(data.currentPreset || data.defaultPreset);
        } catch (e) {
            console.error("Erro ao buscar tamanhos de base:", e);
        }
    };

    // Status inicial
    useEffect(() => {
        fetchDbStatus();
        fetchSizePresets();
    }, []);

    // Avisa o formulário quando a preparação começa/termina (bloqueia o START)
    useEffect(() => {
        onPreparingChangeRef.current?.(prep.phase === "running");
    }, [prep.phase]);

    // Canal /control: eventos DATABASE_PREPARATION_* em tempo real
    useEffect(() => {
        let socket: WebSocket | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let mounted = true;

        const connect = () => {
            if (!mounted) return;
            socket = new WebSocket(CONTROL_WS);

            socket.onmessage = (event) => {
                let msg: any;
                try { msg = JSON.parse(String(event.data)); } catch { return; }

                if (msg.type === "PREPARATION_STATE") {
                    // Estado atual ao conectar (ex.: página recarregada no meio do Load database)
                    setPrep({
                        phase: msg.phase ?? "idle",
                        step: msg.step ?? null,
                        progress: msg.progress ?? null,
                        startedAt: msg.startedAt ?? null,
                        error: msg.error ?? null,
                    });
                    return;
                }
                if (msg.type !== "EVENT") return;

                switch (msg.event) {
                    case "DATABASE_PREPARATION_STARTED":
                        setLastResult(null);
                        setPrep({ phase: "running", step: "Starting", progress: null, startedAt: msg.startedAt ?? new Date().toISOString(), error: null });
                        break;
                    case "DATABASE_PREPARATION_PROGRESS":
                        setPrep((prev) => ({
                            ...prev,
                            phase: "running",
                            step: msg.step ?? prev.step,
                            // null = progresso indeterminado (ex.: primeiro lote da indexação)
                            progress: "progress" in msg ? msg.progress : prev.progress,
                            startedAt: msg.startedAt ?? prev.startedAt,
                        }));
                        break;
                    case "DATABASE_PREPARATION_COMPLETED":
                        setPrep((prev) => ({ ...prev, phase: "completed", step: null, progress: 100, error: null }));
                        setLastResult({ duration: Number(msg.duration) || 0 });
                        fetchDbStatus();
                        fetchSizePresets();
                        break;
                    case "DATABASE_PREPARATION_FAILED":
                        setPrep((prev) => ({ ...prev, phase: "failed", step: null, error: msg.reason || UI.db.failedGeneric }));
                        fetchDbStatus();
                        break;
                }
            };

            socket.onclose = () => {
                if (!mounted) return;
                retryTimer = setTimeout(connect, 3000);
            };
            socket.onerror = () => {
                socket?.close();
            };
        };

        connect();
        return () => {
            mounted = false;
            if (retryTimer) clearTimeout(retryTimer);
            if (socket) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, []);

    // Cronômetro da preparação
    useEffect(() => {
        if (prep.phase !== "running" || !prep.startedAt) return;
        const start = new Date(prep.startedAt).getTime();
        const tick = () => setElapsed(Math.max(0, (Date.now() - start) / 1000));
        tick();
        const id = setInterval(tick, 500);
        return () => clearInterval(id);
    }, [prep.phase, prep.startedAt]);

    const startLoadDatabase = async () => {
        if (prep.phase === "running" || isDisabled) return;
        const preset = sizeInfo?.presets.find((p) => p.key === selectedSize);
        const summary = preset
            ? UI.db.sizeSummary(preset.label, fmtCompact(preset.records), fmtCompact(preset.tuples), fmtApproxDuration(preset.seconds), fmtBytes(preset.diskBytes))
            : "";
        if (preset?.library || (preset && preset.seconds > 15 * 60)) {
            const ok = window.confirm(
                `${summary}\n\n` +
                (preset?.library ? UI.db.confirmReplaceStored(preset.label) : "") +
                UI.db.confirmContinue
            );
            if (!ok) return;
        }
        setLastResult(null);
        setPrep({ phase: "running", step: "Starting", progress: null, startedAt: new Date().toISOString(), error: null });
        try {
            const res = await fetch(`${API}/api/prepare-database`, {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=UTF-8" },
                body: JSON.stringify({ memtierBenchmarkParameters: store.memtierBenchmarkParameters, sizePreset: selectedSize }),
            });
            const data = await res.json().catch(() => ({}));
            // Os eventos do /control normalmente já atualizaram o estado; a resposta HTTP é o fallback.
            if (res.ok && data.success) {
                setPrep((prev) => ({ ...prev, phase: "completed", step: null, progress: 100, error: null }));
                if (typeof data.duration === "number") setLastResult({ duration: data.duration });
            } else {
                setPrep((prev) => ({ ...prev, phase: "failed", step: null, error: data.error || `Erro HTTP ${res.status}` }));
            }
        } catch (e) {
            setPrep((prev) => ({ ...prev, phase: "failed", step: null, error: UI.db.backendUnavailable }));
        } finally {
            fetchDbStatus();
        }
    };

    // Seleciona a base pronta do tamanho escolhido (não gera nada; leva segundos)
    const selectDatabase = async (presetKey: string) => {
        setSelecting(true);
        setSelectError(null);
        try {
            const res = await fetch(`${API}/api/select-database`, {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=UTF-8" },
                body: JSON.stringify({ sizePreset: presetKey }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) setSelectError(data.error || `HTTP ${res.status}`);
        } catch (e) {
            setSelectError(UI.db.backendUnavailable);
        } finally {
            setSelecting(false);
            fetchDbStatus();
            fetchSizePresets();
        }
    };

    const cancelLoadDatabase = async () => {
        try {
            await fetch(`${API}/api/prepare-database/cancel`, { method: "POST" });
        } catch (e) {
            console.error("Erro ao cancelar preparação:", e);
        }
    };

    const isRunning = prep.phase === "running";
    const needsInstantRecovery = store.instantRecoveryState;
    const blocksStart = needsInstantRecovery && dbStatus !== null && !dbStatus.isValid;

    // Exceção ao "fechada por padrão": abre sozinha quando há algo que impede o START
    // (base vazia) ou quando o Load database falha, para o aviso não ficar escondido.
    useEffect(() => {
        if (blocksStart || prep.phase === "failed") setIsOpen(true);
    }, [blocksStart, prep.phase]);

    const selectedPreset = sizeInfo?.presets.find((p) => p.key === selectedSize) || null;
    const currentPresetLabel = sizeInfo?.presets.find((p) => p.key === dbStatus?.sizePreset)?.label || null;
    const notEnoughDisk = !!(selectedPreset && sizeInfo?.freeDiskBytes != null && sizeInfo.freeDiskBytes < selectedPreset.diskBytes);

    const countsLabel =
        dbStatus?.countsSource === "redis-ir" ? UI.db.countedByRedis :
        dbStatus?.countsSource === "aof" ? UI.db.countedFromAof :
        dbStatus?.countsSource === "backup" ? UI.db.countedFromBackup :
        null;

    // Resumo mostrado no cabeçalho quando a seção está fechada (ex.: "Medium · 1M rec")
    const collapsedSummary = isRunning
        ? `${prep.step || UI.db.preparing} · ${fmtElapsed(elapsed)}`
        : dbStatus?.isValid
            ? [currentPresetLabel, dbStatus.records != null ? `${fmtCompact(dbStatus.records)} rec` : null].filter(Boolean).join(" · ")
            : "";
    const needsAttention = blocksStart || prep.phase === "failed";

    const statusBadge = !backendOnline ? (
        <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 text-[9px] font-semibold">
            {UI.db.offline}
        </span>
    ) : isRunning ? (
        <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-[9px] font-semibold animate-pulse">
            {UI.db.loading}
        </span>
    ) : dbStatus?.isValid ? (
        <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[9px] font-semibold">
            {UI.db.ready}
        </span>
    ) : (
        <span className="px-1.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[9px] font-semibold">
            {UI.db.empty}
        </span>
    );

    const toggle = () => setIsOpen((o) => !o);

    return (
        <div className={`w-full mb-2 border border-slate-800 rounded-none transition-colors ${
            needsAttention
                ? "border-rose-500/50 border-l-2 border-l-rose-500 bg-slate-800/30"
                : isOpen ? "bg-slate-800/30 border-l-2 border-l-blue-500" : "bg-slate-900/60 hover:bg-slate-800/20"
        }`}>
            {/* Cabeçalho recolhível — mesmo padrão das demais seções do sidebar */}
            <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                aria-controls="db-section-body"
                onClick={toggle}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                className="w-full flex justify-between items-center gap-2 px-3 py-2 text-left cursor-pointer select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 group"
            >
                <div className="flex items-center min-w-0">
                    <h3 className={`font-semibold text-xs uppercase tracking-wider whitespace-nowrap transition-colors ${
                        needsAttention ? "text-rose-400" : isOpen ? "text-blue-400" : "text-slate-300 group-hover:text-blue-400"
                    }`}>
                        {UI.db.title}
                    </h3>
                    <TooltipBadge text={TIP.dbPanel} />
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                    {!isOpen && collapsedSummary && (
                        <span className="text-[9px] font-mono text-slate-500 truncate">{collapsedSummary}</span>
                    )}
                    {isOpen && dbStatus?.backupExists && (
                        <span className="text-[9px] font-semibold text-blue-400" title="Backup restored automatically on every START">{UI.db.backup}</span>
                    )}
                    {statusBadge}
                    <svg
                        className={`w-4 h-4 shrink-0 text-slate-400 group-hover:text-blue-400 transition-transform duration-300 ${isOpen ? "rotate-180 text-blue-400" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {/* Corpo: continua montado quando fechado (WebSocket e cronômetro seguem ativos) */}
            <div
                id="db-section-body"
                className={`transition-all duration-300 ease-in-out ${
                    isOpen ? "max-h-[2000px] opacity-100 pt-2 border-t border-slate-800/60" : "max-h-0 opacity-0 overflow-hidden border-t-0"
                }`}
            >

            {/* Detalhes da base */}
            {dbStatus?.isValid && !isRunning && (
                <div className="px-3 pb-1.5 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="flex flex-col">
                        <span className="text-slate-500 uppercase text-[9px] flex items-center">{UI.db.records}<TooltipBadge text={TIP.dbCounts} /></span>
                        <span className="text-slate-200">{fmtInt(dbStatus.records)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-slate-500 uppercase text-[9px]">{UI.db.tuples}</span>
                        <span className="text-slate-200">{fmtInt(dbStatus.distinctTuples)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-slate-500 uppercase text-[9px]">{UI.db.size}</span>
                        <span className="text-slate-200">{fmtBytes(dbStatus.sizeBytes)}</span>
                    </div>
                    <div className="col-span-3 text-[9px] text-slate-500">
                        {countsLabel ?? UI.db.notVerified}
                        {currentPresetLabel && <> · {currentPresetLabel.toLowerCase()} database</>}
                    </div>
                </div>
            )}

            {/* Progresso da preparação */}
            {isRunning && (
                <div className="px-3 pb-2 space-y-1">
                    <div className="flex justify-between text-[10px] font-mono text-cyan-300">
                        <span>{prep.step || UI.db.preparing}</span>
                        <span>{fmtElapsed(elapsed)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 overflow-hidden">
                        {prep.progress !== null ? (
                            <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, prep.progress))}%` }} />
                        ) : (
                            <div className="h-full w-1/3 bg-cyan-500/70 animate-pulse" />
                        )}
                    </div>
                    {prep.progress !== null && (
                        <div className="text-[9px] text-slate-500 font-mono">{prep.progress}%</div>
                    )}
                </div>
            )}

            {prep.phase === "completed" && lastResult && (
                <div className="mx-3 mb-2 p-1.5 bg-emerald-950/40 border border-emerald-700/50 text-[10px] text-emerald-300 font-mono">
                    {UI.db.loadedIn(fmtElapsed(lastResult.duration))}
                </div>
            )}

            {prep.phase === "failed" && prep.error && (
                <div className="mx-3 mb-2 p-1.5 bg-rose-950/60 border border-rose-700/60 text-[10px] text-rose-300 font-mono break-words">
                    {prep.error}
                </div>
            )}

            {/* Tamanho da base (controlado pela geração: -n e --key-maximum do memtier) */}
            {!isRunning && sizeInfo && (
                <div className="px-3 pb-2 space-y-1">
                    <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 flex items-center">{UI.db.sizeLabel}<TooltipBadge text={TIP.dbSize} /></span>
                    <div className="grid grid-cols-4 gap-1">
                        {sizeInfo.presets.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                disabled={isDisabled || selecting}
                                onClick={() => {
                                    sizeTouchedRef.current = true;
                                    setSelectedSize(p.key);
                                    setSelectError(null);
                                    // Base pronta de outro tamanho: só seleciona
                                    if (p.library && p.key !== dbStatus?.sizePreset) selectDatabase(p.key);
                                }}
                                title={`${p.library ? UI.db.baseReady : UI.db.baseMissing} · ${fmtInt(p.records)} records · ${fmtInt(p.tuples)} tuples`}
                                className={`relative py-1 text-[9px] font-semibold rounded-none border transition ${
                                    selectedSize === p.key
                                        ? "bg-cyan-900/60 border-cyan-500 text-cyan-200"
                                        : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                                } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {p.label}
                                {/* Base pronta guardada (verde) ou ainda não gerada (vazio) */}
                                <span className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 ${p.library ? "bg-emerald-400" : "border border-slate-600"}`} aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                    {selecting && <div className="text-[9px] font-mono text-cyan-300">{UI.db.selecting}</div>}
                    {selectError && <div className="text-[9px] font-mono text-rose-400 break-words">{selectError}</div>}
                    {selectedPreset && !selecting && (selectedPreset.library ? (
                        <div className="text-[9px] font-mono text-emerald-300/90">
                            {UI.db.baseReady} · {fmtCompact(selectedPreset.library.records ?? selectedPreset.records)} records ·{" "}
                            {fmtCompact(selectedPreset.library.distinctTuples ?? selectedPreset.tuples)} tuples · {fmtBytes(selectedPreset.library.indexedLogSizeBytes)}
                            {selectedPreset.library.createdAt && ` · ${UI.db.generatedOn(fmtDateTime(new Date(selectedPreset.library.createdAt)))}`}
                        </div>
                    ) : (
                        <div className={`text-[9px] font-mono ${notEnoughDisk ? "text-rose-400" : "text-slate-500"}`}>
                            {fmtCompact(selectedPreset.records)} records · {fmtCompact(selectedPreset.tuples)} tuples ·{" "}
                            {UI.db.notGeneratedLine(fmtApproxDuration(selectedPreset.seconds), fmtBytes(selectedPreset.diskBytes))}
                            {!selectedPreset.measured && ` (${UI.db.estimate})`}
                            {notEnoughDisk && sizeInfo.freeDiskBytes != null && ` — ${UI.db.onlyFree(fmtBytes(sizeInfo.freeDiskBytes))}`}
                            {currentPresetLabel && dbStatus?.sizePreset !== selectedPreset.key && (
                                <span className="block text-amber-300/90 mt-0.5">{UI.db.startUsesOther(currentPresetLabel, selectedPreset.label)}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Ações: gerar só é o caminho principal quando o tamanho escolhido ainda não tem base.
                Com a base pronta, gerar de novo fica recolhido em "Advanced". */}
            {!isRunning && selectedPreset?.library && (
                <div className="px-3 pb-1">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="w-full flex items-center justify-between text-[9px] uppercase font-bold tracking-wider text-slate-500 hover:text-slate-300"
                        aria-expanded={showAdvanced}
                    >
                        <span>{UI.db.advanced}</span>
                        <svg className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
            )}
            <div className={`px-3 pb-2 flex flex-col gap-1 ${!isRunning && selectedPreset?.library && !showAdvanced ? "hidden" : ""}`}>
                {!isRunning && <div className="text-[9px] text-slate-500">{UI.db.generateHint}</div>}
                {!isRunning ? (
                    <button
                        type="button"
                        onClick={startLoadDatabase}
                        disabled={isDisabled || !backendOnline || notEnoughDisk || selecting}
                        className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded-none transition ${
                            isDisabled || !backendOnline || notEnoughDisk || selecting
                                ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60"
                                : selectedPreset?.library
                                    ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600"
                                    : "bg-cyan-700 hover:bg-cyan-600 text-white border border-cyan-600"
                        }`}
                        title="Gera a base experimental (memtier → log sequencial → log indexado) e guarda na biblioteca de bases"
                    >
                        {selectedPreset
                            ? (selectedPreset.library ? UI.db.regenerate(selectedPreset.label) : UI.db.generate(selectedPreset.label))
                            : (dbStatus?.isValid ? UI.db.reload : UI.db.load)}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={cancelLoadDatabase}
                        className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded-none bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 transition"
                    >
                        {UI.db.cancel}
                    </button>
                )}
            </div>

            {blocksStart && !isRunning && (
                <div className="mx-3 mb-2 p-2 bg-rose-950/80 border border-rose-600 text-[10px] text-rose-300 font-mono space-y-1">
                    <span className="font-bold text-rose-200 block">{UI.db.cannotStart}</span>
                    <span>{UI.db.emptyHint}</span>
                </div>
            )}
            </div>
        </div>
    );
};

export default DatabaseStatusSection;
