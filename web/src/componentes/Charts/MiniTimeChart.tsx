import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, registerables, ChartOptions } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { ExperimentPhases, EMPTY_PHASES, buildPhaseAnnotations } from "./phaseAnnotations";

try {
    ChartJS.register(...registerables, annotationPlugin);
} catch (e) {
    console.error("Error registering ChartJS in MiniTimeChart", e);
}

export interface MiniSeries {
    label: string;
    points: { x: number; y: number }[];
    color: string;
    fill?: string;
}

interface MiniTimeChartProps {
    id: string;
    series: MiniSeries[];
    unit: string;
    yMin?: number;
    yMax?: number;
    phases?: ExperimentPhases;
    xMax?: number;
    valueDecimals?: number;
}

/**
 * Gráfico compacto de série temporal com eixo x em segundos desde o início do experimento
 * e as faixas de fase (preload, falha, reinicialização, recuperação).
 */
const MiniTimeChart = ({ id, series, unit, yMin, yMax, phases = EMPTY_PHASES, xMax, valueDecimals = 1 }: MiniTimeChartProps) => {
    const data = useMemo(() => ({
        datasets: series.map((s) => ({
            label: s.label,
            data: [...s.points].sort((a, b) => a.x - b.x),
            borderColor: s.color,
            backgroundColor: s.fill ?? "transparent",
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: !!s.fill,
            // Segmentos retos: o trecho já desenhado não muda quando chega o ponto seguinte
            tension: 0,
            spanGaps: false,
        })),
    }), [series]);

    const annotations = useMemo(() => buildPhaseAnnotations(phases, { compact: true }), [phases]);

    const options = useMemo<ChartOptions<"line">>(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            x: {
                type: "linear" as const,
                min: 0,
                max: xMax,
                grid: { color: "#1e293b" },
                ticks: { color: "#64748b", font: { size: 9 }, maxTicksLimit: 7, callback: (v) => `${v}s` },
            },
            y: {
                min: yMin,
                max: yMax,
                grid: { color: "#1e293b" },
                ticks: { color: "#64748b", font: { size: 9 }, maxTicksLimit: 4 },
            },
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                enabled: true,
                callbacks: {
                    title: (ctx) => `t = ${Number(ctx[0].parsed.x).toFixed(1)} s`,
                    label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(valueDecimals)} ${unit}`,
                },
            },
            annotation: { annotations },
        },
    }), [xMax, yMin, yMax, annotations, unit, valueDecimals]);

    return (
        <div id={id} className="w-full h-[160px] pt-2 pb-1 bg-slate-900/40 rounded-none border border-slate-800/80">
            <Line data={data} options={options} />
        </div>
    );
};

export default MiniTimeChart;
