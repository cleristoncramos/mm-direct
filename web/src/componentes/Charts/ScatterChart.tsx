import { useMemo } from "react";
import { TelemetryPoint } from "./types";
import MiniTimeChart from "./MiniTimeChart";
import { ExperimentPhases } from "./phaseAnnotations";
import { UI } from "../../i18n/strings";

interface ScatterChartProps {
    data: TelemetryPoint[];
    chartMode?: "default" | "minimalist";
    phases?: ExperimentPhases;
    xMax?: number;
}

// Latência no servidor (fim − início do comando, em µs), média por segundo
export const ScatterChart = ({ data, phases, xMax }: ScatterChartProps) => {
    const series = useMemo(() => [
        {
            label: UI.charts.latencyNormal,
            points: data.filter((d) => d.metricType !== "A").map((d) => ({ x: d.relativeSeconds, y: d.value })),
            color: "#3b82f6",
        },
        {
            label: UI.charts.latencyAbnormal,
            points: data.filter((d) => d.metricType === "A").map((d) => ({ x: d.relativeSeconds, y: d.value })),
            color: "#f43f5e",
        },
    ], [data]);

    return <MiniTimeChart id="Latency_chart" series={series} unit="µs" yMin={0} phases={phases} xMax={xMax} valueDecimals={2} />;
};
