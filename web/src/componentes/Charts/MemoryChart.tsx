import { useMemo } from "react";
import { TelemetryPoint } from "./types";
import MiniTimeChart from "./MiniTimeChart";
import { ExperimentPhases } from "./phaseAnnotations";

interface memoryChartProps {
    data: TelemetryPoint[];
    chartMode?: "default" | "minimalist";
    phases?: ExperimentPhases;
    xMax?: number;
}

const MemoryChart = ({ data, phases, xMax }: memoryChartProps) => {
    const series = useMemo(() => [{
        label: "Memory (RSS)",
        points: data.map((item) => ({ x: item.relativeSeconds, y: item.value })),
        color: "#6366f1",
        fill: "rgba(99, 102, 241, 0.15)",
    }], [data]);

    return <MiniTimeChart id="Memory_chart" series={series} unit="MB" yMin={0} phases={phases} xMax={xMax} />;
};

export default MemoryChart;
