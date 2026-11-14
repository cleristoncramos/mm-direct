/**
 * Relatórios comparativos para impressão / PDF (em português, como o relatório de um experimento).
 *  - kind "side": 2 a 3 experimentos lado a lado, com diferenças em relação ao RUN A e curvas alinhadas na falha;
 *  - kind "repetitions": grupos de repetições com média ± desvio-padrão.
 * Só fatos medidos e configuração; nenhuma conclusão gerada.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { brNum, renderChartImage } from "./ExperimentReport";
import {
    RunMetrics, METRIC_ROWS, delta, compareConfigs, alignAtFailure, groupRepetitions, groupDistinctions, Stat,
    TECHNIQUE_LABEL,
} from "../History/comparison";
import { EMPTY_PHASES, fillThroughputGaps } from "../Charts/phaseAnnotations";

const PRINT_COLORS = ["#1d4ed8", "#047857", "#7e22ce"];

const Th = ({ children, right = false }: { children?: React.ReactNode; right?: boolean }) => (
    <th className={`p-1.5 border border-black font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>
);
const Td = ({ children, mono = false, right = false }: { children?: React.ReactNode; mono?: boolean; right?: boolean }) => (
    <td className={`p-1 border border-black align-top ${mono ? "font-mono" : ""} ${right ? "text-right" : ""}`}>{children}</td>
);
const H2 = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-sm uppercase font-bold border-b border-black mb-2">{children}</h2>
);

const dt = (d: Date | null) => d ? d.toLocaleString("pt-BR", { hour12: false, timeZone: "America/Sao_Paulo" }) : "—";
const fmtDelta = (v: number | null, ref: number | null, d: number) => {
    const x = delta(v, ref);
    if (!x) return "—";
    const sign = x.abs > 0 ? "+" : x.abs < 0 ? "−" : "±";
    return `${sign}${brNum(Math.abs(x.abs), d)}${x.pct !== null ? ` (${x.pct > 0 ? "+" : x.pct < 0 ? "−" : ""}${brNum(Math.abs(x.pct), 1)}%)` : ""}`;
};
const fmtStat = (s: Stat, d = 3) => s.mean === null ? "—" : `${brNum(s.mean, d)}${s.sd !== null ? ` ± ${brNum(s.sd, d)}` : ""}`;

// ─── Lado a lado ───

const SideReport = ({ metrics, rawRuns }: { metrics: RunMetrics[]; rawRuns: any[] }) => {
    const [images, setImages] = useState<{ tp: string | null; cpu: string | null; mem: string | null }>({ tp: null, cpu: null, mem: null });
    const configs = useMemo(() => compareConfigs(rawRuns, "pt"), [rawRuns]);
    const diffs = configs.filter((c) => c.differs);
    const ref = metrics[0];

    useEffect(() => {
        const id = setTimeout(() => {
            const ds = (pick: (m: RunMetrics) => { x: number; y: number }[]) =>
                metrics.map((m, i) => ({ label: `${m.tag} · ${m.technique}`, data: alignAtFailure(pick(m), m.failureAt), color: PRINT_COLORS[i] }));
            // Fim da recuperação de cada experimento, como as linhas "Recovery Time" da Fig. 26 da tese
            const recLines: Record<string, any> = {};
            metrics.forEach((m, i) => {
                if (m.recoveryEndAt === null || m.failureAt === null) return;
                const x = m.recoveryEndAt - m.failureAt;
                recLines[`rec${i}`] = {
                    type: "line", xMin: x, xMax: x, borderColor: PRINT_COLORS[i], borderWidth: 2, borderDash: [5, 4],
                    label: {
                        display: true, content: `${x.toFixed(2)} s (tempo de recuperação)`, position: "start", yAdjust: i * 20,
                        backgroundColor: "#ffffff", color: PRINT_COLORS[i], borderColor: PRINT_COLORS[i], borderWidth: 1,
                        font: { size: 11, weight: "bold" }, padding: { top: 2, bottom: 2, left: 4, right: 4 },
                    },
                };
            });
            const all = metrics.flatMap((m) => [...alignAtFailure(m.series.throughput, m.failureAt), ...alignAtFailure(m.series.cpu, m.failureAt)]);
            const xMin = all.length ? Math.floor(Math.min(...all.map((p) => p.x))) : undefined;
            const xMax = all.length ? Math.ceil(Math.max(...all.map((p) => p.x))) : undefined;
            const phases = { ...EMPTY_PHASES, failure: 0 };
            const xTitle = "Tempo desde a falha simulada (s)";
            setImages({
                tp: renderChartImage({ width: 1400, height: 380, title: "Vazão de comandos", yTitle: "ops/s", datasets: ds((m) => fillThroughputGaps(m.series.throughput, 0)), phases, xMin, xMax, xTitle, yMin: 0, extraAnnotations: recLines }),
                cpu: renderChartImage({ width: 680, height: 380, title: "CPU (redis-server)", yTitle: "% de um núcleo", datasets: ds((m) => m.series.cpu), phases, xMin, xMax, xTitle, yMin: 0 }),
                mem: renderChartImage({ width: 680, height: 380, title: "Memória residente (redis-server)", yTitle: "MB", datasets: ds((m) => m.series.memoryMb), phases, xMin, xMax, xTitle, yMin: 0 }),
            });
        }, 200);
        return () => clearTimeout(id);
    }, [metrics]);

    return (
        <>
            <div className="text-center space-y-1 border-b-2 border-double border-black pb-3 mb-5">
                <h1 className="text-xl font-bold tracking-wide">Relatório Comparativo — MM-DIRECT</h1>
                <p className="text-xs">{metrics.length} experimentos · referência: RUN A · emitido em {dt(new Date())}</p>
            </div>
            <div className="space-y-5">
                <section>
                    <H2>I. Experimentos</H2>
                    <table className="w-full text-xs border-collapse">
                        <thead><tr><Th>Identificação</Th><Th>Experimento</Th><Th>Rótulo</Th><Th>Início</Th><Th>Técnica</Th></tr></thead>
                        <tbody>
                            {metrics.map((m) => (
                                <tr key={m.id}>
                                    <Td><strong>{m.tag}</strong>{m.tag === "RUN A" && " (referência)"}</Td>
                                    <Td mono>{m.id}</Td>
                                    <Td>{m.sum.annotations.label || "—"}</Td>
                                    <Td mono>{dt(m.sum.startedAt)}</Td>
                                    <Td>{TECHNIQUE_LABEL[m.technique].pt}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section>
                    <H2>II. Configuração e comparabilidade</H2>
                    <p className="text-xs mb-2">
                        {diffs.length === 0
                            ? "Configuração idêntica em todos os experimentos."
                            : `Parâmetros que diferem entre os experimentos (marcados com ≠): ${diffs.map((d) => d.field.label.pt.toLowerCase()).join(", ")}.`}
                    </p>
                    <table className="w-full text-xs border-collapse">
                        <thead><tr><Th>Parâmetro</Th>{metrics.map((m) => <Th key={m.id}>{m.tag}</Th>)}</tr></thead>
                        <tbody>
                            {configs.map((c) => (
                                <tr key={c.field.key}>
                                    <Td>{c.field.label.pt}{c.differs && <strong> ≠</strong>}</Td>
                                    {c.values.map((v, i) => <Td key={i} mono>{v}</Td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section>
                    <H2>III. Resultados medidos</H2>
                    <table className="w-full text-xs border-collapse">
                        <thead>
                            <tr>
                                <Th>Medida</Th>
                                <Th right>RUN A</Th>
                                {metrics.slice(1).map((m) => (
                                    <Fragment key={m.id}><Th right>{m.tag}</Th><Th right>Δ {m.tag} − RUN A</Th></Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {METRIC_ROWS.map((r) => (
                                <tr key={r.key}>
                                    <Td>{r.label.pt}{r.unit.pt && ` (${r.unit.pt})`}</Td>
                                    <Td mono right>{brNum(r.get(ref), r.decimals)}</Td>
                                    {metrics.slice(1).map((m) => (
                                        <Fragment key={m.id}>
                                            <Td mono right>{brNum(r.get(m), r.decimals)}</Td>
                                            <Td mono right>{fmtDelta(r.get(m), r.get(ref), r.decimals)}</Td>
                                        </Fragment>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                <section className="break-inside-avoid">
                    <H2>IV. Curvas alinhadas na falha simulada</H2>
                    {images.tp || images.cpu || images.mem ? (
                        <>
                            {images.tp && <img src={images.tp} alt="Vazão" className="w-full border border-black" />}
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {images.cpu && <img src={images.cpu} alt="CPU" className="w-full border border-black" />}
                                {images.mem && <img src={images.mem} alt="Memória" className="w-full border border-black" />}
                            </div>
                            <p className="text-[10px] mt-1">
                                t = 0 no instante da falha simulada de cada experimento (linha tracejada). Cores: {metrics.map((m, i) => `${m.tag} ${["azul", "verde", "roxo"][i]}`).join(", ")}.
                            </p>
                        </>
                    ) : (
                        <p className="text-xs">Sem séries temporais gravadas para estes experimentos.</p>
                    )}
                </section>

                <section className="break-inside-avoid">
                    <H2>V. Notas metodológicas</H2>
                    <ul className="text-xs list-disc pl-5 space-y-0.5">
                        <li>Tempos calculados a partir dos eventos estruturados do Redis-IR (EVENT_JSON) de cada experimento.</li>
                        <li>Δ = valor do experimento − valor do RUN A; o percentual é relativo ao RUN A.</li>
                        <li>Vazão média por janela: comandos por segundo nos segundos com comandos registrados (datasets.csv). Janelas: operação estável (início da operação estável → falha), recuperação (início → fim da recuperação) e após a recuperação (fim da recuperação → fim dos dados).</li>
                        <li>CPU medida pelo top em escala de um núcleo; memória residente (RES) do processo redis-server.</li>
                    </ul>
                </section>
            </div>
        </>
    );
};

// ─── Repetições ───

const RepetitionsReport = ({ runs }: { runs: any[] }) => {
    const groups = useMemo(() => groupRepetitions(runs, "pt"), [runs]);
    const distinctions = useMemo(() => groupDistinctions(groups), [groups]);
    return (
        <>
            <div className="text-center space-y-1 border-b-2 border-double border-black pb-3 mb-5">
                <h1 className="text-xl font-bold tracking-wide">Relatório de Repetições — MM-DIRECT</h1>
                <p className="text-xs">{groups.length} configuração(ões) · {groups.reduce((a, g) => a + g.runs.length, 0)} experimentos completos · emitido em {dt(new Date())}</p>
            </div>
            <div className="space-y-5">
                <section>
                    <H2>I. Resumo por configuração</H2>
                    <table className="w-full text-xs border-collapse">
                        <thead>
                            <tr><Th>Grupo</Th><Th right>n</Th><Th right>Preload (s)</Th><Th right>Preload: leitura do log (s)</Th><Th right>Op. estável (s)</Th><Th right>Falha → recuperação (s)</Th><Th right>Recuperação (s)</Th><Th right>Recuperação: leitura do log (s)</Th><Th right>Recuperação mín – máx (s)</Th></tr>
                        </thead>
                        <tbody>
                            {groups.map((g, i) => (
                                <tr key={g.key}>
                                    <Td>G{i + 1}{distinctions[i] && <span className="block text-[10px]">{distinctions[i]}</span>}</Td>
                                    <Td mono right>{g.runs.length}</Td>
                                    <Td mono right>{fmtStat(g.preload)}</Td>
                                    <Td mono right>{fmtStat(g.preloadRead)}</Td>
                                    <Td mono right>{fmtStat(g.stable)}</Td>
                                    <Td mono right>{fmtStat(g.downtime)}</Td>
                                    <Td mono right>{fmtStat(g.recovery)}</Td>
                                    <Td mono right>{fmtStat(g.recoveryRead)}</Td>
                                    <Td mono right>{g.recovery.min === null ? "—" : `${brNum(g.recovery.min, 3)} – ${brNum(g.recovery.max, 3)}`}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="text-[10px] mt-1">Valores: média ± desvio-padrão amostral (n − 1); sem desvio quando n = 1. Leitura do log = tempo de PRELOAD_INDEX_OPEN até o fim da fase, sem a contagem prévia do log.</p>
                </section>

                <section>
                    <H2>II. Configuração de cada grupo</H2>
                    {groups.map((g, i) => (
                        <div key={g.key} className="mb-3 break-inside-avoid">
                            <p className="text-xs font-bold mb-1">G{i + 1} — {g.runs.length} experimento(s)</p>
                            <table className="w-full text-xs border-collapse">
                                <tbody>
                                    {g.describe.map((d) => <tr key={d.key}><Td>{d.label}</Td><Td mono>{d.value}</Td></tr>)}
                                    <tr><Td>Experimentos</Td><Td mono>{g.runs.map((r) => r.id).join(", ")}</Td></tr>
                                </tbody>
                            </table>
                        </div>
                    ))}
                </section>

                <section className="break-inside-avoid">
                    <H2>III. Notas metodológicas</H2>
                    <ul className="text-xs list-disc pl-5 space-y-0.5">
                        <li>Entram só experimentos completos (falha simulada e recuperação registradas) da lista exibida no histórico, com os filtros aplicados.</li>
                        <li>Um grupo reúne experimentos com modo, base, falha simulada, carga, intervalo do indexador, indexação síncrona, checkpoint e atraso do reinício idênticos.</li>
                        <li>Tempos calculados a partir dos eventos estruturados do Redis-IR (EVENT_JSON).</li>
                    </ul>
                </section>
            </div>
        </>
    );
};

const ComparisonReport = ({ kind, metrics, rawRuns, listRuns, active }: {
    kind: "side" | "repetitions";
    metrics: RunMetrics[];
    rawRuns: any[];
    listRuns: any[];
    active: boolean;
}) => {
    if (!active) return null;
    if (kind === "side" && metrics.length === 0) return null;
    return createPortal(
        <div className="print-root">
            <div className="print-report bg-white text-black font-serif leading-relaxed text-sm p-4 w-full">
                {kind === "side" ? <SideReport metrics={metrics} rawRuns={rawRuns} /> : <RepetitionsReport runs={listRuns} />}
            </div>
        </div>,
        document.body
    );
};

export default ComparisonReport;
