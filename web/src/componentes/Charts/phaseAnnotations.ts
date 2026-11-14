import { UI } from "../../i18n/strings";

// Faixas de fase do experimento (preload, falha, reinicialização, recuperação) compartilhadas
// por todos os gráficos, para que throughput, CPU, memória e latência usem o mesmo eixo
// temporal e as mesmas marcações.

export interface ExperimentPhases {
    preloadStart: number | null;
    preloadEnd: number | null;
    failure: number | null;
    recoveryStart: number | null;
    recoveryEnd: number | null;
    /** Instante mais recente conhecido (s) — fecha visualmente fases ainda em andamento */
    now: number | null;
    /** Falhas seguintes à primeira (falhas sucessivas), cada uma com sua recuperação */
    extraCycles?: FailureCycle[];
    /** Períodos de checkpoint (como na Fig. 31 da tese) */
    checkpoints?: CheckpointPeriod[];
}

export interface FailureCycle {
    failure: number;
    recoveryStart: number | null;
    recoveryEnd: number | null;
}

export interface CheckpointPeriod {
    id: number | null;
    kind?: string | null;
    start: number;
    /** null enquanto o checkpoint está em andamento */
    end: number | null;
    /** Interrompido por falha, fim da carga ou encerramento */
    interrupted: boolean;
}

/** Evento como gravado em results.eventList (ou recebido ao vivo) */
export interface TimelineEvent {
    event: string;
    timestampUs: number | string;
    checkpointId?: number;
    kind?: string;
}

/**
 * Fases a partir da lista ordenada de eventos do log: preload, a primeira falha nos campos
 * principais, as falhas seguintes em extraCycles e os checkpoints. Um checkpoint sem evento de
 * fim termina na falha seguinte (interrompido) ou fica aberto (em andamento).
 */
export const phasesFromEventList = (list: TimelineEvent[] | null | undefined, runStartUs: number | null): Omit<ExperimentPhases, "now"> | null => {
    if (!Array.isArray(list) || list.length === 0 || !runStartUs) return null;
    const rel = (e: TimelineEvent) => (Number(e.timestampUs) - runStartUs) / 1e6;
    const evs = [...list].filter((e) => Number.isFinite(Number(e.timestampUs))).sort((a, b) => Number(a.timestampUs) - Number(b.timestampUs));
    const first = (name: string) => { const e = evs.find((x) => x.event === name); return e ? rel(e) : null; };

    const cycles: FailureCycle[] = [];
    evs.forEach((e, i) => {
        if (e.event !== "FAILURE_TRIGGERED") return;
        const nextFailure = evs.findIndex((x, j) => j > i && x.event === "FAILURE_TRIGGERED");
        const until = nextFailure === -1 ? evs.length : nextFailure;
        const window = evs.slice(i + 1, until);
        const rs = window.find((x) => x.event === "RECOVERY_STARTED");
        const re = window.find((x) => x.event === "RECOVERY_COMPLETED");
        cycles.push({ failure: rel(e), recoveryStart: rs ? rel(rs) : null, recoveryEnd: re ? rel(re) : null });
    });

    const checkpoints: CheckpointPeriod[] = [];
    evs.forEach((e, i) => {
        if (e.event !== "CHECKPOINT_STARTED") return;
        const rest = evs.slice(i + 1);
        const end = rest.find((x) => (x.event === "CHECKPOINT_FINISHED" || x.event === "CHECKPOINT_INTERRUPTED") && Number(x.checkpointId) === Number(e.checkpointId));
        const stop = rest.find((x) => x.event === "FAILURE_TRIGGERED" || x.event === "EXPERIMENT_COMPLETED" || x.event === "EXPERIMENT_FAILED" || x.event === "CHECKPOINT_STARTED");
        const endsFirst = end && (!stop || Number(end.timestampUs) <= Number(stop.timestampUs));
        checkpoints.push({
            id: e.checkpointId !== undefined && e.checkpointId !== null ? Number(e.checkpointId) : null,
            kind: e.kind ?? null,
            start: rel(e),
            end: endsFirst ? rel(end!) : (stop ? rel(stop) : null),
            interrupted: endsFirst ? end!.event === "CHECKPOINT_INTERRUPTED" : !!stop,
        });
    });

    const c0 = cycles[0];
    return {
        preloadStart: first("PRELOAD_STARTED"),
        preloadEnd: first("PRELOAD_COMPLETED"),
        failure: c0 ? c0.failure : null,
        recoveryStart: c0 ? c0.recoveryStart : null,
        recoveryEnd: c0 ? c0.recoveryEnd : null,
        extraCycles: cycles.slice(1),
        checkpoints,
    };
};

export const EMPTY_PHASES: ExperimentPhases = {
    preloadStart: null,
    preloadEnd: null,
    failure: null,
    recoveryStart: null,
    recoveryEnd: null,
    now: null,
};

export const PHASE_COLORS = {
    preload: { fill: "rgba(34, 211, 238, 0.14)", border: "rgba(34, 211, 238, 0.45)", label: "rgba(8, 145, 178, 0.9)" },
    downtime: { fill: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.35)", label: "rgba(239, 68, 68, 0.85)" },
    recovery: { fill: "rgba(245, 158, 11, 0.20)", border: "rgba(245, 158, 11, 0.5)", label: "rgba(245, 158, 11, 0.85)" },
    failure: "#ef4444",
    recovered: "#10b981",
    checkpoint: { fill: "rgba(168, 85, 247, 0.10)", border: "rgba(168, 85, 247, 0.55)", label: "rgba(126, 34, 206, 0.9)" },
};

interface BuildOptions {
    /** Gráficos pequenos: sem rótulos de texto, só as faixas */
    compact?: boolean;
    /** Rótulo da faixa de recuperação (o throughput informa se houve tráfego) */
    recoveryLabel?: string;
}

const boxLabel = (content: string, color: string, y: "start" | "center" | "end") => ({
    content,
    display: true,
    position: { x: "center" as const, y },
    backgroundColor: color,
    color: "#ffffff",
    padding: { top: 2, bottom: 2, left: 4, right: 4 },
    font: { size: 9, family: "Inter, sans-serif", weight: "bold" as const },
});

const closeAt = (start: number, end: number | null, now: number | null, minWidth: number) => {
    if (end !== null) return end;
    if (now !== null && now > start) return now;
    return start + minWidth;
};

export const buildPhaseAnnotations = (phases: ExperimentPhases, options: BuildOptions = {}) => {
    const { compact = false, recoveryLabel = UI.charts.recovery } = options;
    const result: Record<string, any> = {};

    // 1. Preload (carga inicial do banco a partir do log indexado)
    if (phases.preloadStart !== null) {
        const xMin = phases.preloadStart;
        const xMax = closeAt(xMin, phases.preloadEnd, phases.now, 0.5);
        if (xMax > xMin) {
            result.zonaPreload = {
                type: "box" as const,
                drawTime: "beforeDatasetsDraw",
                xMin,
                xMax,
                backgroundColor: PHASE_COLORS.preload.fill,
                borderColor: PHASE_COLORS.preload.border,
                borderWidth: 1,
                // Rótulo só em faixas largas (≥ 6 s): em faixas estreitas ele era cortado na borda
                // do gráfico ("eload"); a legenda acima do gráfico já identifica a cor.
                ...(compact || xMax - xMin < 6 ? {} : {
                    label: boxLabel(phases.preloadEnd === null ? UI.charts.preloadRunning : UI.charts.preload, PHASE_COLORS.preload.label, "start"),
                }),
            };
        }
    }

    // 2. Linha da falha simulada
    if (phases.failure !== null) {
        result.linhaFalha = {
            type: "line" as const,
            scaleID: "x",
            value: phases.failure,
            borderColor: PHASE_COLORS.failure,
            borderWidth: compact ? 1 : 2,
            borderDash: [6, 6],
            ...(compact ? {} : {
                label: {
                    content: UI.charts.failure,
                    display: true,
                    position: "start" as const,
                    backgroundColor: "rgba(239, 68, 68, 0.9)",
                    color: "#ffffff",
                    padding: { top: 3, bottom: 3, left: 5, right: 5 },
                    font: { size: 9, family: "Inter, sans-serif", weight: "bold" as const },
                },
            }),
        };

        // 3. Reinicialização / downtime (falha → início da recuperação)
        const xMin = phases.failure;
        const xMax = phases.recoveryStart ?? closeAt(xMin, phases.recoveryEnd, phases.now, 0.1);
        if (xMax > xMin) {
            result.zonaDowntime = {
                type: "box" as const,
                drawTime: "beforeDatasetsDraw",
                xMin,
                xMax,
                backgroundColor: PHASE_COLORS.downtime.fill,
                borderColor: PHASE_COLORS.downtime.border,
                borderWidth: 1,
                borderDash: [4, 4],
                // Rótulo só em faixas largas (≥ 4 s) e no meio da altura: o da falha fica no topo,
                // e os dois se sobrepunham quando a reinicialização era curta.
                ...(compact || xMax - xMin < 4 ? {} : { label: boxLabel(UI.charts.restart, PHASE_COLORS.downtime.label, "center") }),
            };
        }
    }

    // 4. Recuperação (início → fim da recuperação)
    if (phases.recoveryStart !== null) {
        const xMin = phases.recoveryStart;
        const xMax = closeAt(xMin, phases.recoveryEnd, phases.now, 0.5);
        if (xMax > xMin) {
            result.zonaRecuperacao = {
                type: "box" as const,
                drawTime: "beforeDatasetsDraw",
                xMin,
                xMax,
                backgroundColor: PHASE_COLORS.recovery.fill,
                borderColor: PHASE_COLORS.recovery.border,
                borderWidth: 1,
                ...(compact ? {} : { label: boxLabel(recoveryLabel, PHASE_COLORS.recovery.label, "end") }),
            };
        }
    }

    // 5. Linha do fim da recuperação (o banco segue executando depois dela)
    if (phases.recoveryEnd !== null) {
        result.linhaFimRecuperacao = {
            type: "line" as const,
            scaleID: "x",
            value: phases.recoveryEnd,
            borderColor: PHASE_COLORS.recovered,
            borderWidth: compact ? 1 : 2,
            ...(compact ? {} : {
                label: {
                    content: UI.charts.recoveryTimeAt(phases.recoveryEnd.toFixed(2)),
                    display: true,
                    position: "start" as const,
                    backgroundColor: "rgba(16, 185, 129, 0.9)",
                    color: "#ffffff",
                    padding: { top: 3, bottom: 3, left: 5, right: 5 },
                    font: { size: 9, family: "Inter, sans-serif", weight: "bold" as const },
                },
            }),
        };
    }

    // 6. Falhas sucessivas: mesmas marcas para cada falha seguinte
    (phases.extraCycles || []).forEach((cycle, i) => {
        const sub = buildPhaseAnnotations({
            preloadStart: null, preloadEnd: null,
            failure: cycle.failure, recoveryStart: cycle.recoveryStart, recoveryEnd: cycle.recoveryEnd,
            now: phases.now,
        }, options);
        Object.entries(sub).forEach(([k, v]) => { result[`${k}_${i + 2}`] = v; });
    });

    // 7. Períodos de checkpoint (faixa violeta tracejada, com rótulo no topo)
    (phases.checkpoints || []).forEach((cp, i) => {
        const xMin = cp.start;
        const xMax = closeAt(xMin, cp.end, phases.now, 0.3);
        if (!(xMax > xMin)) return;
        const name = `${UI.charts.checkpoint}${cp.id !== null ? ` ${cp.id}` : ""}${cp.kind === "MFU" ? " (MFU)" : ""}`;
        const label = cp.end === null ? `${name} …` : `${name} · ${(xMax - xMin).toFixed(1)} s${cp.interrupted ? ` · ${UI.charts.checkpointInterrupted}` : ""}`;
        result[`zonaCheckpoint_${i}`] = {
            type: "box" as const,
            drawTime: "beforeDatasetsDraw",
            xMin,
            xMax,
            backgroundColor: PHASE_COLORS.checkpoint.fill,
            borderColor: PHASE_COLORS.checkpoint.border,
            borderWidth: 1,
            borderDash: [3, 3],
            ...(compact || xMax - xMin < 3 ? {} : { label: boxLabel(label, PHASE_COLORS.checkpoint.label, "start") }),
        };
    });

    return result;
};

/**
 * Série de throughput contínua: os segundos sem nenhum comando concluído (preload, banco fora do
 * ar entre a falha e o reinício, recuperação padrão) entram como 0, para a linha cair a zero em
 * vez de sumir ou de ligar os dois lados da falha — como nas figuras da tese (Araújo, 2022).
 * Os pontos vêm um por segundo; lacunas maiores que 1,5 s recebem um zero por segundo.
 * `from`: preenche também do início do experimento (t = 0) até o primeiro ponto.
 */
export const fillThroughputGaps = (pts: { x: number; y: number }[], from: number | null = 0, maxPoints = 20000): { x: number; y: number }[] => {
    const sorted = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
    if (sorted.length === 0) return sorted;
    const out: { x: number; y: number }[] = [];
    let added = 0;
    const first = sorted[0];
    if (from !== null && first.x - from > 1.5) {
        // mesmo deslocamento fracionário dos pontos medidos, para os zeros caírem nos mesmos "segundos"
        for (let x = first.x - Math.floor(first.x - from); x < first.x - 0.5 && added < maxPoints; x += 1, added++) out.push({ x: +x.toFixed(3), y: 0 });
    }
    sorted.forEach((p, i) => {
        if (i > 0) {
            const prev = sorted[i - 1];
            for (let x = prev.x + 1; x < p.x - 0.5 && added < maxPoints; x += 1, added++) out.push({ x: +x.toFixed(3), y: 0 });
        }
        out.push(p);
    });
    return out;
};

/** Eixo x comum: 0 até o maior instante conhecido, arredondado para cima em múltiplos de 5 s */
export const sharedXMax = (values: Array<number | null | undefined>, live = false): number | undefined => {
    const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (finite.length === 0) return undefined;
    const max = Math.max(...finite);
    // Durante a execução, o eixo cresce em degraus de 30 s com folga à frente: a linha avança
    // sobre espaço livre em vez de o gráfico inteiro se comprimir a cada 5 s.
    if (live) return Math.max(60, Math.ceil((max * 1.15 + 5) / 30) * 30);
    return Math.max(5, Math.ceil(max / 5) * 5);
};
