import { useMemo } from "react";
import { TelemetryPoint } from "./types";
import MiniTimeChart from "./MiniTimeChart";
import { ExperimentPhases } from "./phaseAnnotations";

interface cpuChartProps {
    chartMode?: "default" | "minimalist";
    selectedChart?: boolean;
    data: TelemetryPoint[];
    phases?: ExperimentPhases;
    xMax?: number;
}

const CpuChart = ({ data, phases, xMax }: cpuChartProps) => {
    const series = useMemo(() => [{
        label: "CPU",
        points: data.map((item) => ({ x: item.relativeSeconds, y: item.value })),
        color: "#0284c7",
        fill: "rgba(2, 132, 199, 0.15)",
    }], [data]);

    return <MiniTimeChart id="cpu_chart" series={series} unit="%" yMin={0} phases={phases} xMax={xMax} />;
};

export default CpuChart;
