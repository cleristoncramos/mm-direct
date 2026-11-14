import { TelemetryPoint } from "./types";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, registerables, ChartOptions } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import Loading from "./Loading";
import { useMemo } from "react";
import { ExperimentPhases, EMPTY_PHASES, buildPhaseAnnotations, fillThroughputGaps } from "./phaseAnnotations";

const SERIES_COLORS = { stable: "#3b82f6", recovery: "#f59e0b", post: "#10b981" };
import { UI } from "../../i18n/strings";
import { fmtSeconds, fmtInt } from "../../utils/format";

ChartJS.register(...registerables, annotationPlugin);

interface cpuChartProps {
    data: TelemetryPoint[];
    chartMode: "default" | "minimalist";
    failureTime?: number | null;
    recoveryStartTime?: number | null;
    recoveryEndTime?: number | null;
    stabilityTime?: number | null;
    recoveryMetadata?: {
        loadedTuples?: number;
        inconsistencies?: number;
        recordsProcessed?: number;
    } | null;
    phases?: ExperimentPhases;
    xMax?: number;
}

const TransactionChart = ({
    chartMode,
    data,
    failureTime = null,
    recoveryStartTime = null,
    recoveryEndTime = null,
    recoveryMetadata = null,
    phases = EMPTY_PHASES,
    xMax
}: cpuChartProps) => {
    const sortedData = useMemo(() => {
        return [...data].sort((a, b) => a.relativeSeconds - b.relativeSeconds);
    }, [data]);

    // Uma linha contínua do início ao fim (pedido do orientador e figuras da tese): os segundos sem
    // comandos entram como 0 e a cor muda por trecho — operação estável (azul), da falha ao fim da
    // recuperação (âmbar) e depois da recuperação (verde). Antes eram três séries separadas, e os
    // pontos entre a falha e o início da recuperação não entravam em nenhuma.
    const points = useMemo(
        () => fillThroughputGaps(sortedData.map(({ relativeSeconds: x, value: y }) => ({ x, y })), 0),
        [sortedData]
    );

    // Janelas falha → fim da recuperação (todas as falhas, se houver mais de uma)
    const cycles = useMemo(() => {
        const first = {
            failure: phases.failure ?? failureTime,
            recoveryStart: phases.recoveryStart ?? recoveryStartTime,
            recoveryEnd: phases.recoveryEnd ?? recoveryEndTime,
        };
        return [first, ...(phases.extraCycles || [])].filter((c) => c.failure !== null && c.failure !== undefined) as
            { failure: number; recoveryStart: number | null; recoveryEnd: number | null }[];
    }, [phases, failureTime, recoveryStartTime, recoveryEndTime]);

    const phaseColorAt = (x: number) => {
        let after = false;
        for (const c of cycles) {
            if (x >= c.failure && (c.recoveryEnd === null || x < c.recoveryEnd)) return SERIES_COLORS.recovery;
            if (c.recoveryEnd !== null && x >= c.recoveryEnd) after = true;
        }
        return after ? SERIES_COLORS.post : SERIES_COLORS.stable;
    };

    // Houve comandos durante alguma recuperação? (rótulo da faixa)
    const recoveryHasTraffic = useMemo(() => points.some((p) => p.y > 0 && cycles.some((c) =>
        c.recoveryStart !== null && p.x >= c.recoveryStart && (c.recoveryEnd === null || p.x <= c.recoveryEnd))), [points, cycles]);

    const chartData = useMemo(() => ({
        datasets: [
            {
                label: UI.charts.throughput,
                data: points,
                borderColor: SERIES_COLORS.stable,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                // Segmentos retos, como nas figuras da tese: um trecho já desenhado nunca muda
                // quando chega o segundo seguinte (a curva suavizada se reajustava na ponta).
                tension: 0,
                borderJoinStyle: "round" as const,
                borderCapStyle: "butt" as const,
                fill: false,
                // cor de cada trecho pelo instante em que ele começa
                segment: { borderColor: (ctx: any) => phaseColorAt(ctx.p0.parsed.x) },
            },
        ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [points, cycles]);

    const isMinimalist = chartMode === "minimalist";

    // Faixas de fase compartilhadas com CPU, memória e latência (preload, falha, reinicialização, recuperação)
    const annotations = useMemo(() => {
        const effectivePhases: ExperimentPhases = {
            ...phases,
            failure: phases.failure ?? failureTime,
            recoveryStart: phases.recoveryStart ?? recoveryStartTime,
            recoveryEnd: phases.recoveryEnd ?? recoveryEndTime,
        };
        return buildPhaseAnnotations(effectivePhases, {
            recoveryLabel: recoveryHasTraffic ? UI.charts.recovery : UI.charts.recoveryNoTraffic,
        });
    }, [phases, failureTime, recoveryStartTime, recoveryEndTime, recoveryHasTraffic]);

    const chartOptions: ChartOptions<"line"> = {
        responsive: true,
        maintainAspectRatio: false,
        // Sem animação: a cada segundo a linha só ganha o novo trecho, sem transição dos pontos
        // (a animação padrão do Chart.js fazia a ponta "rastejar" a cada atualização).
        animation: false,
        normalized: true,
        scales: {
            x: {
                type: "linear",
                min: 0,
                max: xMax,
                display: !isMinimalist,
                grid: {
                    color: "#334155" // slate-700
                },
                ticks: {
                    color: "#94a3b8", // slate-400
                    font: {
                        family: "Inter, monospace",
                        size: 10
                    }
                },
                title: {
                    display: true,
                    text: UI.charts.time,
                    color: "#cbd5e1", // slate-300
                    font: {
                        family: "Inter, monospace",
                        size: 11,
                        weight: "bold"
                    }
                }
            },
            y: {
                display: !isMinimalist,
                grid: {
                    color: "#334155" // slate-700
                },
                ticks: {
                    color: "#94a3b8", // slate-400
                    font: {
                        family: "Inter, monospace",
                        size: 10
                    }
                },
                title: {
                    display: true,
                    text: `${UI.charts.throughput} (${UI.charts.throughputUnit})`,
                    color: "#cbd5e1", // slate-300
                    font: {
                        family: "Inter, monospace",
                        size: 11,
                        weight: "bold"
                    }
                }
            }
        },
        plugins: {
            legend: {
                display: false // Removida legenda nativa duplicada
            },
            tooltip: {
                enabled: !isMinimalist,
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                titleColor: "#ffffff",
                bodyColor: "#cbd5e1",
                borderColor: "#334155",
                borderWidth: 1,
                titleFont: {
                    family: "Inter, sans-serif",
                    size: 11
                },
                bodyFont: {
                    family: "Inter, monospace",
                    size: 11
                },
                callbacks: {
                    title: (context) => `t = ${Number(context[0].parsed.x).toFixed(1)} s`,
                    label: (context) => `${context.dataset.label || UI.charts.throughput}: ${fmtInt(context.parsed.y ?? 0)} ${UI.charts.throughputUnit}`
                }
            },
            annotation: {
                annotations
            }
        }
    };

    if (data.length === 0) {
        return <Loading />;
    }

    const recDuration = (recoveryEndTime !== null && recoveryStartTime !== null) 
        ? (recoveryEndTime - recoveryStartTime).toFixed(3) 
        : null;

    return (
        <div
            id="Transaction_chart"
            className="mx-auto text-center pt-3 pb-2 bg-slate-900/60 backdrop-blur-md rounded-none border border-slate-800 space-y-2"
        >
            <div style={{ height: chartMode === "minimalist" ? "100px" : "280px" }}>
                <Line
                    options={chartOptions}
                    data={chartData}
                    width="100%"
                />
            </div>

            {/* Resumo da recuperação (a legenda das fases é única, no ChartBoard) */}
            {!isMinimalist && recDuration !== null && (
                <div className="mx-3 py-1 px-2 border-t border-slate-800 text-[11px] text-amber-300/90 font-mono text-left">
                    {UI.charts.recoverySummary(
                        fmtSeconds(Number(recDuration)),
                        recoveryMetadata?.loadedTuples !== undefined && Number.isFinite(recoveryMetadata.loadedTuples) ? fmtInt(recoveryMetadata.loadedTuples) : "—",
                        fmtInt(recoveryMetadata?.inconsistencies ?? 0)
                    )}
                </div>
            )}
        </div>
    );
};

export default TransactionChart;
