import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import CpuChart from "./CpuChart";
import TransactionChart from "./TransferChart";
import MemoryChart from "./MemoryChart";
import { ScatterChart } from "./ScatterChart";
import { ExperimentVisualState, TelemetryStatus, TelemetryPoint } from "./types";
import TerminalController from "../TerminalController";
import { Chart as ChartJS, registerables } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { TECHNIQUE_LABEL, techniqueOf } from "../History/comparison";
import { ExperimentPhases, sharedXMax, PHASE_COLORS, phasesFromEventList, TimelineEvent } from "./phaseAnnotations";
import { UI, TIP } from "../../i18n/strings";
import { fmtSeconds, fmtPercent, fmtMB, fmtMicros } from "../../utils/format";
import { TooltipBadge } from "../Form/InputTypes";
import ExperimentReport, { ExperimentReportData, statusLabelFromVisualState } from "../Report/ExperimentReport";

try {
    ChartJS.register(...registerables, annotationPlugin);
} catch (e) {
    console.error("Error registering ChartJS in ChartBoard", e);
}

interface ChartBoardProps {
    cpuChart: boolean;
    transferChart: boolean;
    terminalLog: string[];
    onReloadButtonClick: (e: Event, chartConnections: WebSocket[]) => void;
    configData?: any;
    historyOpen?: boolean;
    onToggleHistory?: () => void;
}


const STATE_HIERARCHY: Record<ExperimentVisualState, number> = {
    IDLE: 0,
    PRELOADING: 1,
    STABLE_OPERATION: 2,
    FAILURE_TRIGGERED: 3,
    RECOVERING: 4,
    RECOVERED: 4.5,
    COMPLETED: 5,
    FAILED: 99
};

const UI_STATUS_MAP = UI.status as Record<ExperimentVisualState, string>;

const ChartBoard = ({
    cpuChart,
    transferChart,
    terminalLog,
    onReloadButtonClick,
    configData = {},
    historyOpen = false,
    onToggleHistory
}: ChartBoardProps) => {
    // Espaço no cabeçalho do App onde a barra do experimento é desenhada (uma linha só)
    const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
    useEffect(() => {
        setToolbarSlot(document.getElementById("experiment-toolbar-slot"));
    }, []);

    // Menu "Export" (JSON / PDF): fecha ao clicar fora ou com Esc
    const [exportOpen, setExportOpen] = useState(false);
    const exportRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!exportOpen) return;
        const onDown = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExportOpen(false); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [exportOpen]);

    const [currentRunId, setCurrentRunId] = useState<string | null>(null);

    const processedRunStartedRef = useRef<string | null>(null);
    const currentRunIdRef = useRef<string | null>(null);

    const [runStartUs, setRunStartUs] = useState<number | null>(null);
    const runStartUsRef = useRef<number | null>(null);
    const activeRunId = currentRunId || "Aguardando";

    const triggerActivePdfPrint = () => {
        const originalTitle = document.title;
        document.title = activeRunId;
        window.print();
        document.title = originalTitle;
    };

    const [chartConnections, setChartConnections] = useState<WebSocket[]>([]);
    const [dataCPU, setDataCPU] = useState<TelemetryPoint[]>([]);
    const [dataTransfer, setDataTransfer] = useState<TelemetryPoint[]>([]);
    const [dataMemory, setDataMemory] = useState<TelemetryPoint[]>([]);

    // Agregação de Latência por Segundo
    const [dataScatter, setDataScatter] = useState<TelemetryPoint[]>([]);
    const latencyMapRef = useRef<Map<number, { normalSum: number; normalCount: number; abnormalSum: number; abnormalCount: number }>>(new Map());

    const [, setMaxMemoryUsage] = useState(0);
    const [showTerminal, setShowTerminal] = useState<boolean>(true);

    const [failureTime, setFailureTime] = useState<number | null>(null);
    const [recoveryStartTime, setRecoveryStartTime] = useState<number | null>(null);
    const [recoveryEndTime, setRecoveryEndTime] = useState<number | null>(null);
    const [stabilityTime, setStabilityTime] = useState<number | null>(null);
    // Instantes (s desde o início do experimento) do início/fim do preload
    const [preloadStartTime, setPreloadStartTime] = useState<number | null>(null);
    const [preloadEndTime, setPreloadEndTime] = useState<number | null>(null);
    // Relógio relativo ao início do experimento, para fechar visualmente fases em andamento
    const [nowRelative, setNowRelative] = useState<number | null>(null);
    const [, setRecoveryStartAtUtc] = useState<string | null>(null);
    const [, setRecoveryEndAtUtc] = useState<string | null>(null);

    const [isCpuConnected, setIsCpuConnected] = useState(false);
    const [isDataConnected, setIsDataConnected] = useState(false);
    const [isMemoryConnected, setIsMemoryConnected] = useState(false);
    const [isLatencyConnected, setIsLatencyConnected] = useState(false);

    // Estados da Telemetria para Fase 4
    const [cpuTelemetryState, setCpuTelemetryState] = useState<TelemetryStatus>("WAITING");
    const [memoryTelemetryState, setMemoryTelemetryState] = useState<TelemetryStatus>("WAITING");
    const [dataTelemetryState, setDataTelemetryState] = useState<TelemetryStatus>("WAITING");
    const [latencyTelemetryState, setLatencyTelemetryState] = useState<TelemetryStatus>("WAITING");

    // Selos de telemetria: aparecem só quando algo foge do normal. Dados chegando ou
    // experimento concluído não precisam de selo (o status global já informa).
    const renderTelemetryStatusBadge = (state: string, placeholder = false) => {
        const effectiveState = (experimentState === 'FAILED') ? 'FAILED' : state;
        let badgeColor = "";
        let label = "";

        switch (effectiveState) {
            case "RECEIVING":
            case "ACTIVE":
            case "COMPLETED":
                return null;
            case "DISABLED":
                badgeColor = "bg-slate-800 text-slate-400 border-slate-700";
                label = UI.telemetry.disabled;
                break;
            case "UNAVAILABLE":
                badgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/30";
                label = UI.telemetry.unavailable;
                break;
            case "FAILED":
            case "ERROR":
                badgeColor = "bg-rose-600/20 text-rose-300 border-rose-600/40";
                label = UI.telemetry.failed;
                break;
            case "WAITING":
            default:
                // "Aguardando" só faz sentido no lugar do gráfico vazio, não no título do card
                if (!placeholder || experimentState === "COMPLETED") return null;
                badgeColor = "bg-slate-800/60 text-slate-400 border-slate-700";
                label = UI.telemetry.waiting;
                break;
        }

        return (
            <span className={`px-2 py-0.5 border text-[10px] font-medium tracking-wide rounded-none ${badgeColor}`}>
                {label}
            </span>
        );
    };

    // Indicador de conexão: só aparece quando o canal está desconectado
    const renderDisconnected = (connected: boolean) => connected ? null : (
        <span className="px-1.5 py-0.5 border text-[10px] font-medium rounded-none bg-amber-500/10 text-amber-400 border-amber-500/30" title="Canal WebSocket desconectado; o painel tenta reconectar automaticamente.">
            {UI.telemetry.disconnected}
        </span>
    );

    const [reconnectTrigger, setReconnectTrigger] = useState(0);

    // Variáveis auxiliares para mesclar dados com mesmo timestamp
    const timestampsCpu = useRef<number[]>([]);
    const cpuUsage = useRef<number[]>([]);
    const timestampsMemory = useRef<number[]>([]);
    const memoryUsage = useRef<number[]>([]);

    // ─── FASE 5: MÁQUINA DE ESTADOS VISUAL DO EXPERIMENTO ───
    const [experimentState, setExperimentState] = useState<ExperimentVisualState>("IDLE");
    const [failureReason, setFailureReason] = useState<string | null>(null);

    const visualStateRef = useRef<ExperimentVisualState>("IDLE");
    // Eventos do experimento em ordem (para marcar todas as falhas e os checkpoints no gráfico)
    const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>([]);
    const liveEventKeysRef = useRef<Set<string>>(new Set());
    const structuredEventsRef = useRef<Record<string, any>>({});
    const lastParsedLogIndex = useRef<number>(0);

    // Duracoes congeladas de cada fase (em segundos)
    const [preloadDuration, setPreloadDuration] = useState<number | null>(null);
    const [stableDuration, setStableDuration] = useState<number | null>(null);
    const [recoveryDuration, setRecoveryDuration] = useState<number | null>(null);

    // Cronômetros em tempo real (em segundos)
    const [preloadElapsed, setPreloadElapsed] = useState<number | null>(null);
    const [stableElapsed, setStableElapsed] = useState<number | null>(null);
    const [recoveryElapsed, setRecoveryElapsed] = useState<number | null>(null);

    // Timestamps base dos cronometros
    const preloadStartTsRef = useRef<number | null>(null);
    const stableStartTsRef = useRef<number | null>(null);
    const recoveryStartTsRef = useRef<number | null>(null);

    // Status derivado diretamente do estado estruturado (Exigencia 3)
    const systemStatus = useMemo(() => UI_STATUS_MAP[experimentState], [experimentState]);

    const updateVisualState = (nextState: ExperimentVisualState, reason?: string) => {
        const current = visualStateRef.current;

        // Ao receber IDLE (CLEAR signal de nova execução)
        if (nextState === 'IDLE') {
            visualStateRef.current = 'IDLE';
            setExperimentState('IDLE');
            setFailureReason(null);
            setPreloadDuration(null);
            setStableDuration(null);
            setRecoveryDuration(null);
            setPreloadElapsed(null);
            setStableElapsed(null);
            setRecoveryElapsed(null);
            setFailureTime(null);
            setRecoveryStartTime(null);
            setRecoveryEndTime(null);
            setStabilityTime(null);
            setPreloadStartTime(null);
            setPreloadEndTime(null);
            setNowRelative(null);
            setRecoveryStartAtUtc(null);
            setRecoveryEndAtUtc(null);
            preloadStartTsRef.current = null;
            stableStartTsRef.current = null;
            recoveryStartTsRef.current = null;
            structuredEventsRef.current = {};
            lastParsedLogIndex.current = 0;
            liveEventKeysRef.current = new Set();
            setLiveEvents([]);

            setDataCPU([]);
            setDataTransfer([]);
            setDataMemory([]);
            setDataScatter([]);
            latencyMapRef.current = new Map();

            setCpuTelemetryState("WAITING");
            setMemoryTelemetryState("WAITING");
            setDataTelemetryState("WAITING");
            setLatencyTelemetryState("WAITING");
            return;
        }

        // Se estado atual é terminal (COMPLETED ou FAILED), desconsidera transições não-IDLE
        if (current === 'COMPLETED' || current === 'FAILED') {
            console.warn(`[State Machine] Transição ignorada a partir de estado terminal: ${current} -> ${nextState}`);
            return;
        }

        // Transição para FAILED (erro durante preload ou execução)
        if (nextState === 'FAILED') {
            visualStateRef.current = 'FAILED';
            if (reason) setFailureReason(reason);
            setExperimentState('FAILED');

            setCpuTelemetryState((prev) => (prev === "DISABLED" ? "DISABLED" : "FAILED"));
            setMemoryTelemetryState((prev) => (prev === "DISABLED" ? "DISABLED" : "FAILED"));
            setDataTelemetryState((prev) => (prev === "DISABLED" ? "DISABLED" : "FAILED"));
            setLatencyTelemetryState((prev) => (prev === "DISABLED" ? "DISABLED" : "FAILED"));
            return;
        }

        // Regra de Monotonicidade: avança somente se a hierarquia for >= a atual.
        // Exceção: falhas sucessivas (depois de recuperado, o banco pode falhar de novo).
        const nextFailureCycle = current === 'RECOVERED' && nextState === 'FAILURE_TRIGGERED';
        if (nextFailureCycle || STATE_HIERARCHY[nextState] >= STATE_HIERARCHY[current]) {
            visualStateRef.current = nextState;
            setExperimentState(nextState);
        } else {
            console.warn(`[State Machine] Transição regressiva inválida ignorada: ${current} -> ${nextState}`);
        }
    };

    // 1. Processamento de logs de terminal para detecção de eventos estruturados e transição de estados
    useEffect(() => {
        if (terminalLog.length === 0) return;

        const lines: string[] = [];
        for (let i = lastParsedLogIndex.current; i < terminalLog.length; i++) {
            const log = terminalLog[i];
            if (typeof log === "string") {
                log.split("\n").forEach((line) => {
                    if (line.trim()) lines.push(line);
                });
            }
        }
        lastParsedLogIndex.current = terminalLog.length;

        const matchKeyValues = (str: string) => {
            const obj: Record<string, string> = {};
            const regex = /([a-zA-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let match;
            while ((match = regex.exec(str)) !== null) {
                const key = match[1];
                const val = match[2] ?? match[3] ?? match[4];
                obj[key] = val;
            }
            return obj;
        };

        const cleanReason = (rawReason?: string) => {
            if (!rawReason) return UI.failure.defaultReason;
            let str = String(rawReason).trim();
            if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
                str = str.slice(1, -1).trim();
            }
            return str.replace(/^(experimento falhou|experiment failed)\s*:\s*/i, "") || UI.failure.defaultReason;
        };

        lines.forEach((log) => {
            let evtName: string | null = null;
            let evtObj: any = {};

            if (log.includes("EVENT_JSON ")) {
                try {
                    const jsonStr = log.substring(log.indexOf("EVENT_JSON ") + 11).trim();
                    evtObj = JSON.parse(jsonStr);
                    evtName = evtObj.event || null;
                } catch (e) { }
            } else if (log.includes("EVENT ")) {
                const eventStr = log.substring(log.indexOf("EVENT ") + 6).trim();
                const spaceIdx = eventStr.indexOf(" ");
                if (spaceIdx !== -1) {
                    evtName = eventStr.substring(0, spaceIdx);
                    evtObj = matchKeyValues(eventStr.substring(spaceIdx + 1));
                } else {
                    evtName = eventStr;
                }
            }

            if (!evtName) return;

            structuredEventsRef.current[evtName] = evtObj;

            // Lista ordenada de todos os eventos (falhas sucessivas, checkpoints) para as marcações
            if (evtObj.timestampUs !== undefined && evtName !== "RUN_STARTED") {
                const ts = Number(evtObj.timestampUs);
                const key = `${evtName}@${ts}`;
                if (Number.isFinite(ts) && !liveEventKeysRef.current.has(key)) {
                    liveEventKeysRef.current.add(key);
                    const cpId = evtObj.checkpointId ?? evtObj.checkpoint_id;
                    const item: TimelineEvent = { event: evtName, timestampUs: ts };
                    if (cpId !== undefined) item.checkpointId = Number(cpId);
                    if (evtObj.kind) item.kind = String(evtObj.kind);
                    setLiveEvents((prev) => [...prev, item]);
                }
            }

            const relSec = evtObj.relativeMs ? Number(evtObj.relativeMs) / 1000 : null;



            if (evtName === "RUN_STARTED") {
                if (processedRunStartedRef.current === evtObj.runId) {
                    // Already processed
                } else {
                    processedRunStartedRef.current = evtObj.runId;
                    console.log(`RUN_STARTED_RECEIVED runId=${evtObj.runId} runStartUs=${evtObj.runStartUs}`);
                    console.log("TELEMETRY_BUFFERS_CLEARED");

                    currentRunIdRef.current = evtObj.runId || null;
                    setCurrentRunId(evtObj.runId || null);

                    if (evtObj.runStartUs) {
                        runStartUsRef.current = Number(evtObj.runStartUs);
                        setRunStartUs(Number(evtObj.runStartUs));
                    }

                    // Clear buffers
                    liveEventKeysRef.current = new Set();
                    setLiveEvents([]);
                    setDataCPU([]);
                    setDataTransfer([]);
                    setDataMemory([]);
                    setDataScatter([]);

                    updateVisualState("IDLE");
                }
            } else if (evtName === "RUN_CONTINUED_AFTER_FAILURE") {
                if (evtObj.runId !== currentRunIdRef.current) {
                    console.warn('RUN_CONTINUED_IGNORED reason=unknown-run');
                } else {
                    console.debug('RUN_CONTINUED_ACCEPTED', evtObj.runId);
                }
            } else if (evtName === "PRELOAD_STARTED") {
                updateVisualState("PRELOADING");
                preloadStartTsRef.current = Date.now();
                setPreloadElapsed(0);
                setPreloadStartTime(relSec !== null ? relSec : 0);
            } else if (evtName === "PRELOAD_COMPLETED") {
                let dur = evtObj.durationMs ? Number(evtObj.durationMs) / 1000 : null;
                if (dur === null && evtObj.duration) dur = parseFloat(evtObj.duration);
                if (dur === null && preloadStartTsRef.current) dur = (Date.now() - preloadStartTsRef.current) / 1000;
                setPreloadDuration(dur !== null ? Math.max(0, dur) : 0);
                if (relSec !== null) setPreloadEndTime(relSec);
            } else if (evtName === "PRELOAD_FAILED") {
                const reasonText = cleanReason(evtObj.reason || evtObj.cause);
                updateVisualState("FAILED", reasonText);
            } else if (evtName === "STABLE_OPERATION_STARTED") {
                updateVisualState("STABLE_OPERATION");
                stableStartTsRef.current = Date.now();
                setStableElapsed(0);
                if (relSec !== null) setStabilityTime(relSec);
            } else if (evtName === "FAILURE_TRIGGERED") {
                updateVisualState("FAILURE_TRIGGERED");
                let dur = stableStartTsRef.current ? (Date.now() - stableStartTsRef.current) / 1000 : null;
                if (dur !== null) setStableDuration(Math.max(0, dur));
                if (relSec !== null) setFailureTime(relSec);
            } else if (evtName === "RECOVERY_STARTED") {
                updateVisualState("RECOVERING");
                recoveryStartTsRef.current = Date.now();
                setRecoveryElapsed(0);
                if (relSec !== null) setRecoveryStartTime(relSec);
                if (evtObj.timestampUs) setRecoveryStartAtUtc(new Date(Number(evtObj.timestampUs) / 1000).toISOString());
            } else if (evtName === "RECOVERY_COMPLETED") {
                let dur = evtObj.durationMs ? Number(evtObj.durationMs) / 1000 : null;
                if (dur === null && evtObj.duration) dur = parseFloat(evtObj.duration);
                if (dur === null && recoveryStartTsRef.current) dur = (Date.now() - recoveryStartTsRef.current) / 1000;
                setRecoveryDuration(dur !== null ? Math.max(0, dur) : 0);
                if (relSec !== null) setRecoveryEndTime(relSec);
                if (evtObj.timestampUs) setRecoveryEndAtUtc(new Date(Number(evtObj.timestampUs) / 1000).toISOString());
            } else if (evtName === "POST_RECOVERY_STABLE") {
                // O banco segue executando depois da recuperação até o fim da janela de observação
                // (ou até a próxima falha, quando há falhas sucessivas)
                updateVisualState("RECOVERED");
            } else if (evtName === "THREADS_CLEANUP_COMPLETED") {
                // Threads cleanup concluído
            } else if (evtName === "EXPERIMENT_COMPLETED") {
                if (structuredEventsRef.current["RECOVERY_COMPLETED"]) {
                    updateVisualState("COMPLETED");
                }
            } else if (evtName === "EXPERIMENT_FAILED") {
                const reasonText = cleanReason(evtObj.reason || evtObj.cause);
                updateVisualState("FAILED", reasonText);
            }
        });
    }, [terminalLog]);

    // Cronômetros de tempo real por fase
    useEffect(() => {
        if (experimentState !== "PRELOADING" || preloadDuration !== null) return;
        const start = preloadStartTsRef.current || Date.now();
        const interval = setInterval(() => {
            setPreloadElapsed((Date.now() - start) / 1000);
        }, 100);
        return () => clearInterval(interval);
    }, [experimentState, preloadDuration]);

    useEffect(() => {
        if (experimentState !== "STABLE_OPERATION" || stableDuration !== null) return;
        const start = stableStartTsRef.current || Date.now();
        const interval = setInterval(() => {
            setStableElapsed((Date.now() - start) / 1000);
        }, 100);
        return () => clearInterval(interval);
    }, [experimentState, stableDuration]);

    useEffect(() => {
        if (experimentState !== "RECOVERING" || recoveryDuration !== null) return;
        const start = recoveryStartTsRef.current || Date.now();
        const interval = setInterval(() => {
            setRecoveryElapsed((Date.now() - start) / 1000);
        }, 100);
        return () => clearInterval(interval);
    }, [experimentState, recoveryDuration]);

    const initialLoadText = useMemo(() => {
        if (preloadDuration !== null) {
            return fmtSeconds(preloadDuration);
        }
        if (preloadElapsed !== null && preloadElapsed > 0) {
            return fmtSeconds(preloadElapsed, 1);
        }
        return experimentState === 'FAILED' ? "N/A" : "—";
    }, [preloadDuration, preloadElapsed, experimentState]);

    const stableOperationText = useMemo(() => {
        if (experimentState === 'FAILED' && stableDuration === null && (stableElapsed === null || stableElapsed === 0)) {
            return "N/A";
        }
        // Meta da operação estável: tempo do modo por tempo ou do modo preload (o inativo vai como 0)
        const target = Number(configData?.restartAfterTime) > 0 ? Number(configData.restartAfterTime)
            : Number(configData?.preloadDatabaseAndRestart) > 0 ? Number(configData.preloadDatabaseAndRestart)
            : null;
        const targetStr = target ? ` ${UI.toolbar.target(fmtSeconds(target, 0))}` : "";

        if (stableDuration !== null) {
            return `${fmtSeconds(stableDuration)}${targetStr}`;
        }
        if (stableElapsed !== null && stableElapsed > 0) {
            return `${fmtSeconds(stableElapsed, 1)}${targetStr}`;
        }
        return experimentState === 'FAILED' ? "N/A" : "—";
    }, [stableDuration, stableElapsed, configData, experimentState]);

    const calculatedRecoveryTimeText = useMemo(() => {
        if (experimentState === 'FAILED' && recoveryDuration === null && (recoveryElapsed === null || recoveryElapsed === 0)) {
            return "N/A";
        }
        if (recoveryDuration !== null) {
            return fmtSeconds(recoveryDuration);
        }
        if (recoveryElapsed !== null && recoveryElapsed > 0) {
            return fmtSeconds(recoveryElapsed, 1);
        }
        return experimentState === 'FAILED' ? "N/A" : "—";
    }, [recoveryDuration, recoveryElapsed, experimentState]);


    // 2. Conectar e gerenciar WebSockets com reconexão automática e backoff progressivo
    useEffect(() => {
        let isComponentMounted = true;

        const connect = (
            url: string,
            onMessage: (data: any) => void,
            onStateChange: (connected: boolean) => void,
            onClearData?: () => void
        ) => {
            let socket: WebSocket | null = null;
            let retryDelay = 1000;
            let timer: any = null;

            const startConnection = () => {
                if (!isComponentMounted) return;

                console.log(`Tentando conectar ao WebSocket: ${url}`);
                socket = new WebSocket(url);

                socket.onopen = () => {
                    if (!isComponentMounted) {
                        socket?.close();
                        return;
                    }
                    console.log(`WebSocket conectado: ${url}`);
                    onStateChange(true);
                    retryDelay = 1000;
                    if (onClearData) onClearData();
                    setChartConnections((prev) => {
                        if (socket && !prev.includes(socket)) {
                            return [...prev, socket];
                        }
                        return prev;
                    });
                };

                socket.onmessage = (event) => {
                    if (!isComponentMounted) return;
                    onMessage(event.data);
                };

                socket.onerror = (err) => {
                    console.warn(`Erro no WebSocket: ${url}`, err);
                    onStateChange(false);
                };

                socket.onclose = () => {
                    if (!isComponentMounted) return;
                    console.log(`WebSocket desconectado: ${url}. Reconectando em ${retryDelay}ms...`);
                    onStateChange(false);

                    setChartConnections((prev) => {
                        if (socket) {
                            return prev.filter((s) => s !== socket);
                        }
                        return prev;
                    });

                    const jitter = Math.random() * 300; // Jitter de até 300ms para evitar colisões
                    timer = setTimeout(() => {
                        timer = null;
                        retryDelay = Math.min(retryDelay * 2, 8000);
                        startConnection();
                    }, retryDelay + jitter);
                };
            };

            startConnection();

            return {
                close: () => {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    if (socket) {
                        socket.onclose = null;
                        socket.onerror = null;
                        socket.onopen = null;
                        socket.close();
                    }
                }
            };
        };

        const MAX_POINTS = 1000;

        const isValidRelativeSecond = (sec: any): boolean => {
            if (typeof sec !== "number" || isNaN(sec)) return false;
            if (sec < 0 || sec > 86400) return false;
            return true;
        };

        const cpuConn = connect("ws://localhost:8081/cpu", (data) => {
            try {

                const message = JSON.parse(data);
                if (message.type === "STATUS") {
                    if (!message.runId) { console.log("STATUS_IGNORED reason=missing-runId"); return; }
                    if (message.runId !== currentRunIdRef.current) return;
                    if (visualStateRef.current !== 'FAILED') {
                        setCpuTelemetryState(message.status);
                    }
                    return;
                }
                if (message.type === "TELEMETRY") {
                    if (message.runId !== currentRunIdRef.current) return;
                    if (runStartUsRef.current === null || !Number.isFinite(message.timestampUs)) return;
                    const relSec = (message.timestampUs - runStartUsRef.current) / 1000000;
                    if (!isValidRelativeSecond(relSec)) return;
                    if (visualStateRef.current === 'FAILED' || visualStateRef.current === 'COMPLETED') return;

                    setCpuTelemetryState("RECEIVING"); console.log("TELEMETRY_CHANNEL_STATE channel=cpu state=RECEIVING");
                    setDataCPU((prev) => [...prev, { runId: currentRunIdRef.current as string, timestampUs: message.timestampUs, relativeSeconds: relSec, value: message.value } as TelemetryPoint].slice(-MAX_POINTS));
                }
            } catch (e) {
                console.error("Erro CPU WS parsing:", e);
            }
        }, setIsCpuConnected, () => {
            setDataCPU([]);
            timestampsCpu.current = [];
            cpuUsage.current = [];
        });

        const dataConn = connect("ws://localhost:8081/data", (data) => {
            try {

                const endMessage = "CSV file successfully processed";
                if (data !== endMessage) {
                    const message = JSON.parse(data);
                    if (message.type === "STATUS") {
                        if (!message.runId) { console.log("STATUS_IGNORED reason=missing-runId"); return; }
                        if (message.runId !== currentRunIdRef.current) return;
                        if (visualStateRef.current !== 'FAILED') {
                            setDataTelemetryState(message.status);
                        }
                        return;
                    }

                    if (message.type === "TELEMETRY") {
                        let accepted = true;
                        let reason = "";
                        if (message.runId !== currentRunIdRef.current) { accepted = false; reason = "stale-run"; }
                        else if (runStartUsRef.current === null) { accepted = false; reason = "no-run-start"; }
                        else if (!Number.isFinite(message.timestampUs)) { accepted = false; reason = "invalid-timestamp"; }

                        const relativeSecs = accepted ? (message.timestampUs - (runStartUsRef.current || 0)) / 1000000 : -1;
                        if (accepted && relativeSecs < 0) { accepted = false; reason = "negative-relative-sec"; }
                        if (accepted && (visualStateRef.current === 'FAILED' || visualStateRef.current === 'COMPLETED')) { accepted = false; reason = "terminal-state"; }

                        if (!accepted) {
                            console.log(`TELEMETRY_IGNORED reason=${reason} channel=/data`);
                        } else {
                            console.log(`TELEMETRY_ACCEPTED channel=/data`);
                            console.log(`CHANNEL=/data\nrunId=${message.runId}\ncurrentRunId=${currentRunId}\ntimestampUs=${message.timestampUs}\nrunStartUs=${runStartUs}\nvalue=${message.value}\naccepted=${accepted}\nreason=${reason}`);
                            setDataTelemetryState("RECEIVING"); console.log("TELEMETRY_CHANNEL_STATE channel=data state=RECEIVING");
                            setDataTransfer((prev) => [...prev, { runId: currentRunIdRef.current as string, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value } as TelemetryPoint].slice(-MAX_POINTS));
                        }
                    }

                }
            } catch (e) {
                console.error("Erro Data WS parsing:", e);
            }
        }, setIsDataConnected, () => {
            setDataTransfer([]);
        });

        const memoryConn = connect("ws://localhost:8081/memory", (data) => {
            try {

                const message = JSON.parse(data);
                if (message.type === "STATUS") {
                    if (!message.runId) { console.log("STATUS_IGNORED reason=missing-runId"); return; }
                    if (message.runId !== currentRunIdRef.current) return;
                    if (visualStateRef.current !== 'FAILED') {
                        setMemoryTelemetryState(message.status);
                    }
                    return;
                }
                if (message.type === "TELEMETRY") {
                    if (message.runId !== currentRunIdRef.current) return;
                    if (runStartUsRef.current === null || !Number.isFinite(message.timestampUs)) return;
                    const relSec = (message.timestampUs - runStartUsRef.current) / 1000000;
                    if (!isValidRelativeSecond(relSec)) return;
                    if (visualStateRef.current === 'FAILED' || visualStateRef.current === 'COMPLETED') return;

                    const usageMb = message.value / 1024;
                    setMemoryTelemetryState("RECEIVING"); console.log("TELEMETRY_CHANNEL_STATE channel=memory state=RECEIVING");
                    setDataMemory((prev) => [...prev, { runId: currentRunIdRef.current as string, timestampUs: message.timestampUs, relativeSeconds: relSec, value: usageMb } as TelemetryPoint].slice(-MAX_POINTS));
                    setMaxMemoryUsage((prev) => Math.max(prev, usageMb));
                }
            } catch (e) {
                console.error("Erro Memory WS parsing:", e);
            }
        }, setIsMemoryConnected, () => {
            setDataMemory([]);
            timestampsMemory.current = [];
            memoryUsage.current = [];
            setMaxMemoryUsage(0);
        });

        const latencyConn = connect("ws://localhost:8081/latencia", (data) => {
            try {
                console.log('LATENCIA_RAW', data);
                const message = JSON.parse(data);
                if (message.type === "STATUS") {
                    if (!message.runId) { console.log("STATUS_IGNORED reason=missing-runId"); return; }
                    if (message.runId !== currentRunIdRef.current) return;
                    if (visualStateRef.current !== 'FAILED') {
                        setLatencyTelemetryState(message.status);
                    }
                    return;
                }
                if (message.type !== "TELEMETRY") return;
                if (message.runId !== currentRunIdRef.current) return;
                if (runStartUsRef.current === null || !Number.isFinite(message.timestampUs)) return;
                const sec = Math.floor((message.timestampUs - runStartUsRef.current) / 1000000);
                if (!isValidRelativeSecond(sec)) return;
                if (visualStateRef.current === 'FAILED' || visualStateRef.current === 'COMPLETED') return;

                const val = message.value;
                const isNormal = message.metricType === 'N';

                setLatencyTelemetryState("RECEIVING"); console.log("TELEMETRY_CHANNEL_STATE channel=latencia state=RECEIVING");

                const map = latencyMapRef.current;
                if (!map.has(sec)) {
                    map.set(sec, { normalSum: 0, normalCount: 0, abnormalSum: 0, abnormalCount: 0 });
                }
                const entry = map.get(sec)!;
                if (isNormal) {
                    entry.normalSum += val;
                    entry.normalCount += 1;
                } else {
                    entry.abnormalSum += val;
                    entry.abnormalCount += 1;
                }
            } catch (e) {
                console.error("Erro Latency WS parsing:", e);
            }
        }, setIsLatencyConnected, () => {
            setDataScatter([]);
            latencyMapRef.current.clear();
        });

        const latencyInterval = setInterval(() => {
            const map = latencyMapRef.current;
            const sortedSecs = Array.from(map.keys()).sort((a, b) => a - b);
            const aggregated: TelemetryPoint[] = [];
            sortedSecs.forEach((sec) => {
                const entry = map.get(sec)!;
                const baseTimestampUs = (runStartUsRef.current || 0) + sec * 1000000;
                if (entry.normalCount > 0) {
                    aggregated.push({
                        runId: currentRunIdRef.current as string,
                        timestampUs: baseTimestampUs,
                        relativeSeconds: sec,
                        value: Math.round((entry.normalSum / entry.normalCount) * 100) / 100,
                        metricType: 'N'
                    } as TelemetryPoint);
                }
                if (entry.abnormalCount > 0) {
                    aggregated.push({
                        runId: currentRunIdRef.current as string,
                        timestampUs: baseTimestampUs,
                        relativeSeconds: sec,
                        value: Math.round((entry.abnormalSum / entry.abnormalCount) * 100) / 100,
                        metricType: 'A'
                    } as TelemetryPoint);
                }
            });
            setDataScatter(aggregated);
        }, 1000);

        return () => {
            isComponentMounted = false;
            cpuConn.close();
            dataConn.close();
            memoryConn.close();
            latencyConn.close();
            clearInterval(latencyInterval);
        };
    }, [reconnectTrigger]);

    // Relógio relativo ao início do experimento (só enquanto o experimento está em andamento)
    useEffect(() => {
        if (runStartUs === null || experimentState === "COMPLETED" || experimentState === "FAILED") return;
        const tick = () => setNowRelative(Math.max(0, (Date.now() * 1000 - runStartUs) / 1000000));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [runStartUs, experimentState]);

    // Fases do experimento compartilhadas por todos os gráficos
    const experimentPhases = useMemo<ExperimentPhases>(() => {
        const now = (experimentState === "COMPLETED" || experimentState === "FAILED") ? null : nowRelative;
        // Com a lista de eventos: todas as falhas e os checkpoints. Sem ela: os valores avulsos.
        const fromList = phasesFromEventList(liveEvents, runStartUs);
        if (fromList && fromList.preloadStart !== null) {
            return { ...fromList, now };
        }
        return {
            preloadStart: preloadStartTime,
            preloadEnd: preloadEndTime,
            failure: failureTime,
            recoveryStart: recoveryStartTime,
            recoveryEnd: recoveryEndTime,
            now,
        };
    }, [preloadStartTime, preloadEndTime, failureTime, recoveryStartTime, recoveryEndTime, nowRelative, experimentState, liveEvents, runStartUs]);

    // Eixo temporal comum: mesmo intervalo [0, xMax] em throughput, CPU, memória e latência
    const chartsXMax = useMemo(() => sharedXMax([
        dataTransfer.length ? dataTransfer[dataTransfer.length - 1].relativeSeconds : null,
        dataCPU.length ? Math.max(...dataCPU.map((d) => d.relativeSeconds)) : null,
        dataMemory.length ? Math.max(...dataMemory.map((d) => d.relativeSeconds)) : null,
        dataScatter.length ? dataScatter[dataScatter.length - 1].relativeSeconds : null,
        preloadEndTime, failureTime, recoveryStartTime, recoveryEndTime,
        experimentPhases.now,
    ], experimentPhases.now !== null), [dataTransfer, dataCPU, dataMemory, dataScatter, preloadEndTime, failureTime, recoveryStartTime, recoveryEndTime, experimentPhases.now]);

    // Metadados do experimento em andamento (base usada, restauração do backup) para o relatório PDF
    const [currentRunMeta, setCurrentRunMeta] = useState<{ folderId: string | null; metadata: any } | null>(null);
    useEffect(() => {
        if (!currentRunId) { setCurrentRunMeta(null); return; }
        let cancelled = false;
        fetch("http://localhost:8081/api/runs/current")
            .then((r) => r.json())
            .then((j) => { if (!cancelled) setCurrentRunMeta(j); })
            .catch(() => { /* relatório sai sem a seção da base */ });
        return () => { cancelled = true; };
    }, [currentRunId]);

    // Dados do relatório PDF (mesmo componente do histórico)
    const reportData = useMemo<ExperimentReportData | null>(() => {
        if (!currentRunId) return null;
        const toXY = (arr: TelemetryPoint[]) => arr.map((p) => ({ x: p.relativeSeconds, y: p.value }));
        return {
            runId: currentRunId,
            folderId: currentRunMeta?.folderId ?? null,
            runStartUs,
            statusLabel: statusLabelFromVisualState(experimentState),
            modeLabel: TECHNIQUE_LABEL[techniqueOf({ metadata: { config: configData || {} } })].pt,
            config: configData || {},
            database: currentRunMeta?.metadata?.database ?? null,
            events: { ...structuredEventsRef.current },
            series: { throughput: toXY(dataTransfer), cpu: toXY(dataCPU), memoryMb: toXY(dataMemory) },
        };
        // structuredEventsRef muda junto com experimentState e os tempos de fase listados abaixo
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentRunId, currentRunMeta, runStartUs, experimentState, configData, dataTransfer, dataCPU, dataMemory,
        preloadStartTime, preloadEndTime, failureTime, recoveryStartTime, recoveryEndTime, stableDuration]);

    // Modo de recuperação do setup
    const isDirectMode = useMemo(() => {
        const state = configData?.instantRecoveryState || "ON";
        return state.toUpperCase() === "ON";
    }, [configData]);

    const getBrasiliaISOString = (dateInput?: Date) => {
        const date = dateInput || new Date();

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });

        const parts = formatter.formatToParts(date);
        const p: any = {};
        parts.forEach(part => p[part.type] = part.value);

        const tzParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Sao_Paulo',
            timeZoneName: 'longOffset'
        }).formatToParts(date);
        const nameVal = tzParts.find(pt => pt.type === 'timeZoneName')?.value || 'GMT-03:00';

        let offsetStr = '-03:00';
        if (nameVal === 'GMT') {
            offsetStr = '+00:00';
        } else {
            const match = nameVal.match(/GMT([+-])(\d+)(?::(\d+))?/);
            if (match) {
                const sign = match[1];
                const hours = match[2].padStart(2, '0');
                const minutes = (match[3] || '00').padStart(2, '0');
                offsetStr = `${sign}${hours}:${minutes}`;
            }
        }

        const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
        return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}${offsetStr}`;
    };

    const downloadActiveJsonReport = () => {
        let peakThroughput = 0;
        let averageThroughput = 0;
        let totalCommands = 0;

        if (dataTransfer.length > 0) {
            const counts = dataTransfer.map(item => item.value);
            peakThroughput = Math.max(...counts);
            const sum = counts.reduce((acc, curr) => acc + curr, 0);
            averageThroughput = parseFloat((sum / counts.length).toFixed(2));
            totalCommands = sum;
        }

        let peakCpu = 0;
        let averageCpu = 0;
        if (dataCPU.length > 0) {
            const cpus = dataCPU.map(item => item.value);
            peakCpu = Math.max(...cpus);
            const sumCpu = cpus.reduce((acc, curr) => acc + curr, 0);
            averageCpu = parseFloat((sumCpu / cpus.length).toFixed(2));
        }

        let peakMemory = 0;
        let averageMemory = 0;
        if (dataMemory.length > 0) {
            const mems = dataMemory.map(item => item.value);
            peakMemory = Math.max(...mems);
            const sumMem = mems.reduce((acc, curr) => acc + curr, 0);
            averageMemory = parseFloat((sumMem / mems.length).toFixed(2));
        }

        const startedTime = new Date(Date.now() - (dataTransfer.length > 0 ? dataTransfer[dataTransfer.length - 1].relativeSeconds * 1000 : 0));
        const failTime = failureTime !== null ? new Date(Date.now() - (dataTransfer.length > 0 ? (dataTransfer[dataTransfer.length - 1].relativeSeconds - failureTime) * 1000 : 0)) : null;
        const recStartTime = recoveryStartTime !== null ? new Date(Date.now() - (dataTransfer.length > 0 ? (dataTransfer[dataTransfer.length - 1].relativeSeconds - recoveryStartTime) * 1000 : 0)) : null;
        const recEndTime = recoveryEndTime !== null ? new Date(Date.now() - (dataTransfer.length > 0 ? (dataTransfer[dataTransfer.length - 1].relativeSeconds - recoveryEndTime) * 1000 : 0)) : null;
        const stabTime = stabilityTime !== null ? new Date(Date.now() - (dataTransfer.length > 0 ? (dataTransfer[dataTransfer.length - 1].relativeSeconds - stabilityTime) * 1000 : 0)) : null;

        const report = {
            runId: activeRunId,
            mode: isDirectMode ? "MM-DIRECT (B-Tree)" : "Tradicional (AOF)",
            timezone: "America/Sao_Paulo",
            startedAtUtc: startedTime.toISOString(),
            startedAtLocal: getBrasiliaISOString(startedTime),
            failureAtUtc: failTime !== null ? failTime.toISOString() : null,
            failureAtLocal: failTime !== null ? getBrasiliaISOString(failTime) : null,
            recoveryStartAtUtc: recStartTime !== null ? recStartTime.toISOString() : null,
            recoveryStartAtLocal: recStartTime !== null ? getBrasiliaISOString(recStartTime) : null,
            recoveryEndAtUtc: recEndTime !== null ? recEndTime.toISOString() : null,
            recoveryEndAtLocal: recEndTime !== null ? getBrasiliaISOString(recEndTime) : null,
            stabilityAtUtc: stabTime !== null ? stabTime.toISOString() : null,
            stabilityAtLocal: stabTime !== null ? getBrasiliaISOString(stabTime) : null,
            recoveryDurationSeconds: (recoveryStartTime !== null && recoveryEndTime !== null) ? (recoveryEndTime - recoveryStartTime) : null,
            status: stabilityTime ? "Estável" : "Interrompido",
            config: configData,
            throughputSummary: {
                peakThroughput,
                averageThroughput,
                totalCommands
            },
            cpuSummary: {
                peakCpu,
                averageCpu
            },
            memorySummary: {
                peakMemory,
                averageMemory
            }
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(report, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `report_${activeRunId}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    };

    return (
        <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans w-full">
            {/* Barra do experimento, desenhada dentro do cabeçalho do App (uma única linha):
                ID + status | tempos | Export ▾, History, End experiment */}
            {toolbarSlot && createPortal(
                <div className="flex items-center gap-4 w-full min-w-0 print:hidden">
                    {/* Experimento e status, ao lado da marca */}
                    <div className="flex items-center gap-2.5 min-w-0 border-l border-slate-700 pl-4">
                        <span className="text-xs font-mono text-slate-400 truncate max-w-[200px]" title={`${UI.toolbar.run}: ${activeRunId}`}>{activeRunId}</span>
                        <span className={`px-2 py-0.5 rounded-none border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                            experimentState === "COMPLETED" ? "bg-emerald-950/60 border-emerald-600/60 text-emerald-300" :
                            experimentState === "STABLE_OPERATION" ? "bg-blue-950/60 border-blue-600/50 text-blue-300" :
                            experimentState === "PRELOADING" ? "bg-cyan-950/60 border-cyan-600/50 text-cyan-300" :
                            experimentState === "RECOVERING" ? "bg-amber-950/60 border-amber-600/50 text-amber-300" :
                            experimentState === "RECOVERED" ? "bg-emerald-950/40 border-emerald-700/50 text-emerald-300" :
                            experimentState === "FAILURE_TRIGGERED" || experimentState === "FAILED" ? "bg-rose-950/60 border-rose-600/60 text-rose-300" :
                            "bg-slate-800 border-slate-700 text-slate-300"
                        }`}>
                            {/* Único elemento animado da tela: só enquanto uma fase está em andamento */}
                            {(experimentState === "PRELOADING" || experimentState === "STABLE_OPERATION" || experimentState === "RECOVERING" || experimentState === "RECOVERED") && (
                                <span className="w-1.5 h-1.5 bg-current animate-pulse"></span>
                            )}
                            {systemStatus}
                        </span>
                    </div>

                    {/* Tempos medidos, compactos (rótulo e valor na mesma linha) */}
                    <div className="flex-1 flex justify-center items-center gap-2 min-w-0">
                        {[
                            { label: UI.toolbar.preload, value: initialLoadText, color: "text-cyan-300", tip: TIP.preload },
                            { label: UI.toolbar.stableOp, value: stableOperationText, color: "text-blue-300", tip: TIP.stableOp },
                            { label: UI.toolbar.recovery, value: calculatedRecoveryTimeText, color: "text-amber-300", tip: TIP.recovery },
                        ].map((m) => (
                            <div key={m.label} title={m.label} className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-none px-2.5 py-1 whitespace-nowrap">
                                {/* Em telas estreitas só o valor aparece (rótulo no title), para manter uma linha */}
                                <span className="hidden xl:flex text-[10px] uppercase tracking-wider text-slate-500 items-center">{m.label}<TooltipBadge text={m.tip} /></span>
                                <span className={`font-mono text-xs font-semibold ${m.color}`}>{m.value}</span>
                            </div>
                        ))}
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {(!isCpuConnected || !isDataConnected || !isMemoryConnected || !isLatencyConnected) && (
                            <button
                                onClick={() => setReconnectTrigger(prev => prev + 1)}
                                className="px-3 py-1.5 bg-amber-600/90 hover:bg-amber-600 text-white rounded-none text-xs font-semibold transition"
                            >
                                {UI.toolbar.reconnect}
                            </button>
                        )}

                        <div className="relative" ref={exportRef}>
                            <button
                                onClick={() => setExportOpen((o) => !o)}
                                aria-haspopup="menu"
                                aria-expanded={exportOpen}
                                className={`px-3 py-1.5 border rounded-none text-xs font-semibold transition flex items-center gap-1.5 ${
                                    exportOpen ? "bg-slate-700 border-slate-600 text-white" : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                                }`}
                            >
                                {UI.toolbar.export}
                                <svg className={`w-3 h-3 transition-transform ${exportOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {exportOpen && (
                                <div role="menu" className="absolute right-0 top-full mt-1 w-44 bg-slate-900 border border-slate-700 shadow-2xl z-50 py-1">
                                    <button
                                        role="menuitem"
                                        title={TIP.exportJson}
                                        onClick={() => { setExportOpen(false); downloadActiveJsonReport(); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 flex justify-between items-center"
                                    >
                                        {UI.toolbar.exportJsonItem}<span className="text-[10px] text-slate-500 font-mono">.json</span>
                                    </button>
                                    <button
                                        role="menuitem"
                                        title={TIP.exportPdf}
                                        onClick={() => { setExportOpen(false); triggerActivePdfPrint(); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 flex justify-between items-center"
                                    >
                                        {UI.toolbar.exportPdfItem}<span className="text-[10px] text-slate-500 font-mono">.pdf</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {onToggleHistory && (
                            <button
                                onClick={onToggleHistory}
                                className={`px-3 py-1.5 border rounded-none text-xs font-semibold transition flex items-center gap-1.5 ${
                                    historyOpen ? "bg-slate-700 border-slate-600 text-white" : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                                }`}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {UI.toolbar.history}
                            </button>
                        )}

                        <button
                            onClick={(e) => onReloadButtonClick(e as unknown as Event, chartConnections)}
                            title={TIP.endExperiment}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-none text-xs font-semibold transition"
                        >
                            {UI.toolbar.end}
                        </button>
                    </div>
                </div>,
                toolbarSlot
            )}

            {/* Conteúdo Principal com padding */}
            <div className="print:hidden p-6 space-y-6 flex flex-col flex-1">

                {/* Banner de falha do experimento */}
                {experimentState === 'FAILED' && (
                    <div className="bg-rose-950/70 border border-rose-600/70 border-l-4 border-l-rose-500 px-4 py-3 w-full">
                        <h3 className="font-semibold text-rose-200 text-sm">{UI.failure.title}</h3>
                        <p className="text-xs text-rose-300/90 font-mono mt-1 whitespace-normal break-words select-text leading-relaxed">
                            {failureReason || UI.failure.defaultReason}
                        </p>
                    </div>
                )}

                {/* Legenda única: séries do throughput + faixas de fase (mesmo eixo em todos os gráficos) */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2 bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                    <span className="flex items-center gap-3">
                        <span className="text-slate-500 uppercase tracking-wider text-[10px]">{UI.charts.throughput}</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span>{UI.charts.seriesStable}</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block"></span>{UI.charts.seriesRecovery}</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500 inline-block"></span>{UI.charts.seriesPostRecovery}</span>
                    </span>
                    <span className="flex items-center gap-3">
                        <span className="text-slate-500 uppercase tracking-wider text-[10px] flex items-center">{UI.charts.phases}<TooltipBadge text={TIP.phases} /></span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border" style={{ background: PHASE_COLORS.preload.fill, borderColor: PHASE_COLORS.preload.border }}></span>{UI.charts.preload}</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 inline-block border-t-2 border-dashed" style={{ borderColor: PHASE_COLORS.failure }}></span>{UI.charts.failure}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border" style={{ background: PHASE_COLORS.downtime.fill, borderColor: PHASE_COLORS.downtime.border }}></span>{UI.charts.restart}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border" style={{ background: PHASE_COLORS.recovery.fill, borderColor: PHASE_COLORS.recovery.border }}></span>{UI.charts.recovery}</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 inline-block border-t-2" style={{ borderColor: PHASE_COLORS.recovered }}></span>{UI.charts.recovered}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block border border-dashed" style={{ background: PHASE_COLORS.checkpoint.fill, borderColor: PHASE_COLORS.checkpoint.border }}></span>{UI.charts.checkpoint}</span>
                    </span>
                    <span className="text-slate-600 ml-auto">{UI.charts.axisNote}</span>
                </div>

                {/* Throughput */}
                <div className="bg-slate-900 border border-slate-800 rounded-none p-5 flex flex-col">
                    <div className="flex justify-between items-center mb-3">
                        <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
                            <span>{UI.charts.throughput}</span>
                            <span className="text-xs font-normal text-slate-500">{UI.charts.throughputUnit}</span>
                            <TooltipBadge text={TIP.throughput} />
                        </h2>
                        <div className="flex items-center gap-2">
                            {renderDisconnected(isDataConnected)}
                            {renderTelemetryStatusBadge(dataTelemetryState)}
                        </div>
                    </div>
                    <div className="w-full">
                        {transferChart && (
                            experimentState === 'FAILED' && dataTransfer.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-[280px] bg-slate-950/60 border border-slate-800 text-center p-6">
                                    <div className="text-sm font-medium text-rose-300">{UI.charts.noDataPreloadFailed}</div>
                                </div>
                            ) : dataTransfer.length > 0 ? (
                                <TransactionChart
                                    data={dataTransfer}
                                    chartMode="default"
                                    failureTime={failureTime}
                                    recoveryStartTime={recoveryStartTime}
                                    recoveryEndTime={recoveryEndTime}
                                    stabilityTime={stabilityTime}
                                    phases={experimentPhases}
                                    xMax={chartsXMax}
                                    recoveryMetadata={structuredEventsRef.current["RECOVERY_COMPLETED"] ? {
                                    loadedTuples: Number(structuredEventsRef.current["RECOVERY_COMPLETED"].loadedTuples ?? structuredEventsRef.current["RECOVERY_COMPLETED"].loaded_tuples),
                                    inconsistencies: Number(structuredEventsRef.current["RECOVERY_COMPLETED"].inconsistencies ?? 0),
                                    recordsProcessed: Number(structuredEventsRef.current["RECOVERY_COMPLETED"].recordsProcessed ?? structuredEventsRef.current["RECOVERY_COMPLETED"].records_processed ?? 0)
                                } : null}
                                />
                            ) : experimentState === "PRELOADING" ? (
                                <div className="flex flex-col items-center justify-center h-[280px] bg-cyan-950/15 border border-cyan-900/40 text-center space-y-2">
                                    <span className="px-2 py-0.5 border text-xs font-semibold rounded-none bg-cyan-500/10 text-cyan-300 border-cyan-500/30 font-mono">
                                        {UI.charts.preloadPlaceholder(initialLoadText)}
                                    </span>
                                    <div className="text-xs text-slate-400">{UI.charts.preloadPlaceholderHint}</div>
                                    <div className="text-[11px] text-slate-500">{UI.charts.preloadPlaceholderHint2}</div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-[280px] text-xs text-slate-500 space-y-2">
                                    {renderTelemetryStatusBadge(dataTelemetryState, true)}
                                    <div>{UI.charts.startingBenchmark}</div>
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* Monitores de sistema: CPU, memória e latência (mesmo eixo x do throughput) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        {
                            key: "cpu", title: UI.charts.cpu, unit: UI.charts.cpuUnit, tip: TIP.cpu,
                            connected: isCpuConnected, state: cpuTelemetryState, show: cpuChart,
                            value: dataCPU.length > 0 ? fmtPercent(dataCPU[dataCPU.length - 1].value) : null,
                            empty: UI.charts.noDataCpu, hasData: dataCPU.length > 0,
                            chart: <CpuChart chartMode="minimalist" data={dataCPU} phases={experimentPhases} xMax={chartsXMax} />,
                        },
                        {
                            key: "memory", title: UI.charts.memory, unit: "MB", tip: TIP.memory,
                            connected: isMemoryConnected, state: memoryTelemetryState, show: true,
                            value: dataMemory.length > 0 ? fmtMB(dataMemory[dataMemory.length - 1].value) : null,
                            empty: UI.charts.noDataMemory, hasData: dataMemory.length > 0,
                            chart: <MemoryChart chartMode="minimalist" data={dataMemory} phases={experimentPhases} xMax={chartsXMax} />,
                        },
                        {
                            key: "latency", title: UI.charts.latency, unit: UI.charts.latencyUnit, tip: TIP.latency,
                            connected: isLatencyConnected, state: latencyTelemetryState, show: true,
                            value: dataScatter.length > 0 ? fmtMicros(Number(dataScatter[dataScatter.length - 1].value || 0)) : null,
                            empty: UI.charts.noDataLatency, hasData: dataScatter.length > 0,
                            chart: <ScatterChart chartMode="minimalist" data={dataScatter} phases={experimentPhases} xMax={chartsXMax} />,
                        },
                    ].map((m) => (
                        <div key={m.key} className="bg-slate-900 border border-slate-800 rounded-none p-4 space-y-3">
                            <div className="flex justify-between items-start gap-2">
                                <div className="min-w-0">
                                    <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                                        <span>{m.title}</span>
                                        <span className="text-[11px] font-normal text-slate-500">{m.unit}</span>
                                        <TooltipBadge text={m.tip} />
                                    </h3>
                                    <div className="mt-1 flex gap-1.5">
                                        {renderDisconnected(m.connected)}
                                        {renderTelemetryStatusBadge(m.state)}
                                    </div>
                                </div>
                                {m.value !== null && (
                                    <span className="text-lg font-semibold font-mono text-slate-100 whitespace-nowrap">{m.value}</span>
                                )}
                            </div>
                            <div className="w-full">
                                {m.show && (
                                    experimentState === 'FAILED' && !m.hasData ? (
                                        <div className="flex items-center justify-center h-[160px] bg-slate-950/60 border border-slate-800 text-center p-4 text-xs text-rose-300">
                                            {m.empty}
                                        </div>
                                    ) : m.hasData ? (
                                        m.chart
                                    ) : (
                                        <div className="flex items-center justify-center h-[160px] border border-slate-800/60">
                                            {renderTelemetryStatusBadge(m.state, true)}
                                        </div>
                                    )
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Terminal */}
                <div className="flex justify-start">
                    <button
                        onClick={() => setShowTerminal(!showTerminal)}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-none text-xs font-semibold transition"
                    >
                        {showTerminal ? UI.terminal.hide : UI.terminal.show}
                    </button>
                </div>

                {/* Terminal em Destaque (Renderizado na base de toda a área analítica de gráficos) */}
                {showTerminal && (
                    <div className="bg-slate-900 border border-slate-800 rounded-none p-4 shadow-2xl">
                        <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                            <h2 className="text-xs uppercase font-bold tracking-wider text-slate-400">{UI.terminal.title}</h2>
                        </div>
                        <TerminalController value={terminalLog} />
                    </div>
                )}
            </div>
            <ExperimentReport data={reportData} active={!historyOpen} />
        </div>
    );
};

export default ChartBoard;
