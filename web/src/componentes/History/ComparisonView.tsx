import { Fragment, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, registerables } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { UI, TIP } from "../../i18n/strings";
import { fmtNum } from "../../utils/format";
import {
    RunMetrics, METRIC_ROWS, METRIC_GROUP_LABEL, MetricGroup, delta, compareConfigs, alignAtFailure,
    groupRepetitions, groupDistinctions, groupHeadline, RepetitionGroup, Stat, toCsv, downloadText, TECHNIQUE_LABEL,
} from "./comparison";
import ExportMenu from "./ExportMenu";
import { fillThroughputGaps } from "../Charts/phaseAnnotations";

try {
    ChartJS.register(...registerables, annotationPlugin);
} catch (e) {
    console.error("Error registering ChartJS in ComparisonView", e);
}

export const RUN_COLORS = ["#3b82f6", "#10b981", "#a855f7"];
export const RUN_TAGS = ["RUN A", "RUN B", "RUN C"];

export type CompareTab = "side" | "repetitions";
export type AlignMode = "failure" | "start";

const T = UI.history.cmp;

const fmtStat = (s: Stat, d = 3) => s.mean === null ? "—" : `${fmtNum(s.mean, d)}${s.sd !== null ? ` ± ${fmtNum(s.sd, d)}` : ""}`;
const fmtDelta = (v: number | null, ref: number | null, d: number) => {
    const x = delta(v, ref);
    if (!x) return null;
    const sign = x.abs > 0 ? "+" : x.abs < 0 ? "−" : "±";
    return `${sign}${fmtNum(Math.abs(x.abs), d)}${x.pct !== null ? ` (${x.pct > 0 ? "+" : x.pct < 0 ? "−" : ""}${fmtNum(Math.abs(x.pct), 1)}%)` : ""}`;
};

const btn = "px-2.5 py-1 text-[11px] border";
const segOn = "bg-slate-700 text-white";
const segOff = "text-slate-400 hover:text-slate-200";

// ─── Gráfico de comparação ───

const CompareChart = ({ title, unit, metrics, pick, align, labels = false }: {
    title: string; unit: string; metrics: RunMetrics[];
    pick: (m: RunMetrics) => { x: number; y: number }[];
    align: AlignMode;
    /** Rótulos de "Recovery time" e legenda (gráfico de throughput, como na Fig. 26 da tese) */
    labels?: boolean;
}) => {
    const datasets = metrics.map((m, i) => ({
        label: `${m.tag} · ${m.technique}${m.sum.annotations.label ? ` · ${m.sum.annotations.label}` : ""}`,
        data: align === "failure" ? alignAtFailure(pick(m), m.failureAt) : pick(m),
        borderColor: RUN_COLORS[i],
        backgroundColor: RUN_COLORS[i],
        borderWidth: 1.75,
        pointRadius: 0,
        tension: 0.15,
        spanGaps: true,
    }));
    if (datasets.every((d) => d.data.length === 0)) {
        return (
            <div className="p-3 bg-slate-900 border border-slate-800 h-[244px] flex items-center justify-center text-xs text-slate-500">
                {T.noSeries(title)}
            </div>
        );
    }
    // Marcas: na falha (t=0) quando alinhado; senão uma linha de falha por experimento, na cor dele
    const annotations: Record<string, any> = {};
    const recLabel = (text: string, color: string, i: number) => labels ? {
        label: {
            display: true, content: text, position: "start" as const, yAdjust: i * 18,
            backgroundColor: color, color: "#fff", font: { size: 9, weight: "bold" as const },
            padding: { top: 2, bottom: 2, left: 4, right: 4 },
        },
    } : {};
    if (align === "failure") {
        annotations.failure = {
            type: "line", xMin: 0, xMax: 0, borderColor: "#ef4444", borderWidth: 1.5, borderDash: [5, 4],
            ...(labels ? { label: { display: true, content: T.systemFailure, position: "end" as const, backgroundColor: "rgba(239,68,68,0.9)", color: "#fff", font: { size: 9, weight: "bold" as const } } } : {}),
        };
        metrics.forEach((m, i) => {
            if (m.recoveryEndAt !== null && m.failureAt !== null) {
                const x = m.recoveryEndAt - m.failureAt;
                annotations[`rec${i}`] = {
                    type: "line", xMin: x, xMax: x, borderColor: RUN_COLORS[i], borderWidth: 1.25, borderDash: [4, 3],
                    ...recLabel(`${m.tag}: ${x.toFixed(2)}s (Recovery time)`, RUN_COLORS[i], i),
                };
            }
        });
    } else {
        metrics.forEach((m, i) => {
            if (m.failureAt !== null) annotations[`f${i}`] = { type: "line", xMin: m.failureAt, xMax: m.failureAt, borderColor: RUN_COLORS[i], borderWidth: 1.25, borderDash: [5, 4] };
            if (m.recoveryEndAt !== null) annotations[`rec${i}`] = {
                type: "line", xMin: m.recoveryEndAt, xMax: m.recoveryEndAt, borderColor: RUN_COLORS[i], borderWidth: 1.25, borderDash: [4, 3],
                ...recLabel(`${m.tag}: ${m.recoveryEndAt.toFixed(2)}s (Recovery time)`, RUN_COLORS[i], i),
            };
        });
    }
    return (
        <div className="p-3 bg-slate-900 border border-slate-800">
            <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">{title} <span className="normal-case tracking-normal font-normal text-slate-600">({unit})</span></h4>
            {labels && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[10px] text-slate-400">
                    {metrics.map((m, i) => (
                        <span key={m.id} className="flex items-center gap-1.5">
                            <span className="w-3 h-0.5 inline-block" style={{ background: RUN_COLORS[i] }} />
                            <strong className="text-slate-300">{m.tag}</strong> {TECHNIQUE_LABEL[m.technique].en}
                        </span>
                    ))}
                </div>
            )}
            <div className="w-full h-[200px]">
                <Line
                    data={{ datasets }}
                    options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: false,
                        interaction: { mode: "nearest", intersect: false },
                        scales: {
                            x: {
                                type: "linear",
                                grid: { color: "#1e293b" },
                                ticks: { color: "#64748b", font: { size: 10 } },
                                title: { display: true, text: align === "failure" ? T.sinceFailure : T.sinceStart, color: "#64748b", font: { size: 10 } },
                            },
                            y: { min: 0, grid: { color: "#1e293b" }, ticks: { color: "#64748b", font: { size: 10 } } },
                        },
                        plugins: {
                            legend: { display: false },
                            annotation: { annotations },
                        } as any,
                    } as any}
                />
            </div>
        </div>
    );
};

// ─── Lado a lado ───

const SideBySide = ({ metrics, rawRuns, align, setAlign }: {
    metrics: RunMetrics[]; rawRuns: any[]; align: AlignMode; setAlign: (a: AlignMode) => void;
}) => {
    const configs = useMemo(() => compareConfigs(rawRuns, "en"), [rawRuns]);
    const diffs = configs.filter((c) => c.differs);
    const criticalDiffs = diffs.filter((c) => c.field.critical);
    const ref = metrics[0];
    const noTelemetry = metrics.filter((m) => !m.hasTelemetry);
    const lower = (xs: typeof diffs) => xs.map((d) => d.field.label.en.toLowerCase()).join(", ");

    return (
        <div className="space-y-6">
            {/* Comparabilidade */}
            {criticalDiffs.length > 0 ? (
                <div className="border-l-2 border-amber-500 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 space-y-0.5">
                    <p className="font-semibold">{T.notSameSituation}</p>
                    <p>{T.differIn(lower(criticalDiffs))}</p>
                </div>
            ) : diffs.length > 0 ? (
                <div className="border-l-2 border-slate-500 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">{T.minorDiff(lower(diffs))}</div>
            ) : (
                <div className="border-l-2 border-emerald-500 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{T.identical}</div>
            )}
            {noTelemetry.length > 0 && (
                <p className="text-[11px] text-slate-500">{T.noTelemetry(noTelemetry.map((m) => m.tag).join(", "))}</p>
            )}

            {/* Tabela de resultados */}
            <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                    <thead>
                        <tr className="text-slate-400 border-b border-slate-700">
                            <th className="text-left font-semibold py-2 pr-3">{T.metric}</th>
                            {metrics.map((m, i) => (
                                <th key={m.id} className="text-right font-semibold py-2 px-3 whitespace-nowrap">
                                    <span className="inline-block w-2 h-2 mr-1.5 align-middle" style={{ background: RUN_COLORS[i] }} />
                                    {m.tag}{i === 0 && <span className="text-slate-500 font-normal"> {T.reference}</span>}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {(["times", "data", "throughput"] as MetricGroup[]).map((group) => (
                            <Fragment key={group}>
                                <tr><td colSpan={metrics.length + 1} className="pt-4 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">{METRIC_GROUP_LABEL[group].en}</td></tr>
                                {METRIC_ROWS.filter((r) => r.group === group).map((r) => (
                                    <tr key={r.key} className="border-b border-slate-800/70 hover:bg-slate-800/30" title={`Origem: ${r.source}`}>
                                        <td className="py-1.5 pr-3 text-slate-300">{r.label.en}{r.unit.en && <span className="text-slate-600"> ({r.unit.en})</span>}</td>
                                        {metrics.map((m, i) => {
                                            const v = r.get(m);
                                            const d = i > 0 ? fmtDelta(v, r.get(ref), r.decimals) : null;
                                            return (
                                                <td key={m.id} className="py-1.5 px-3 text-right font-mono whitespace-nowrap">
                                                    <span className="text-slate-200">{fmtNum(v, r.decimals)}</span>
                                                    {d && <span className="block text-[10px] text-slate-500" title={TIP.history.delta}>{d}</span>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
                <p className="text-[10px] text-slate-500 mt-1.5">{T.deltaNote}</p>
            </div>

            {/* Curvas */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-400">{T.curves}</h3>
                    <div className="flex border border-slate-700" title={TIP.history.align}>
                        {(["failure", "start"] as AlignMode[]).map((a) => (
                            <button key={a} onClick={() => setAlign(a)} className={`${btn} border-0 ${align === a ? segOn : segOff}`}>
                                {a === "failure" ? T.alignFailure : T.alignStart}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    {metrics.map((m, i) => (
                        <span key={m.id} className="flex items-center gap-1.5">
                            <span className="w-3 h-0.5 inline-block" style={{ background: RUN_COLORS[i] }} />
                            {m.tag}{m.sum.annotations.label && <span className="text-slate-500">· {m.sum.annotations.label}</span>}
                        </span>
                    ))}
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                    <CompareChart title={T.throughput} unit="ops/s" metrics={metrics} pick={(m) => fillThroughputGaps(m.series.throughput, 0)} align={align} labels />
                    <CompareChart title={T.cpu} unit={T.cpuUnit} metrics={metrics} pick={(m) => m.series.cpu} align={align} />
                    <CompareChart title={T.memory} unit="MB" metrics={metrics} pick={(m) => m.series.memoryMb} align={align} />
                </div>
                <p className="text-[10px] text-slate-500">{align === "failure" ? T.curvesNoteFailure : T.curvesNoteStart}</p>
            </div>

            {/* Configuração */}
            <div className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-400">{T.configuration}</h3>
                <table className="w-full text-xs border-collapse">
                    <tbody>
                        {configs.map((c) => (
                            <tr key={c.field.key} className={`border-b border-slate-800/70 ${c.differs ? (c.field.critical ? "bg-amber-950/30" : "bg-slate-800/30") : ""}`}>
                                <td className="py-1.5 pr-3 text-slate-400 whitespace-nowrap align-top">
                                    {c.field.label.en}
                                    {c.differs && <span className={`ml-1.5 text-[10px] font-bold ${c.field.critical ? "text-amber-300" : "text-slate-300"}`}>≠</span>}
                                </td>
                                {c.values.map((v, i) => (
                                    <td key={i} className="py-1.5 px-3 font-mono text-[11px] text-slate-300 break-all align-top">{v}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

/** CSV da comparação lado a lado (cabeçalhos em inglês; ";" e vírgula decimal para o Excel em português) */
export const exportSideBySideCsv = (metrics: RunMetrics[], rawRuns: any[]) => {
    const ref = metrics[0];
    const configs = compareConfigs(rawRuns, "en");
    const rows: (string | number | null)[][] = [[
        "Metric", "Unit", ...metrics.map((m) => `${m.tag} (${m.id})`), ...metrics.slice(1).map((m) => `Δ ${m.tag} − RUN A`), "Source",
    ]];
    METRIC_ROWS.forEach((r) => rows.push([
        r.label.en, r.unit.en,
        ...metrics.map((m) => r.get(m)),
        ...metrics.slice(1).map((m) => delta(r.get(m), r.get(ref))?.abs ?? null),
        r.source,
    ]));
    rows.push([]);
    rows.push(["Configuration", "", ...metrics.map((m) => m.tag)]);
    configs.forEach((c) => rows.push([c.field.label.en, c.differs ? "differs" : "", ...c.values]));
    downloadText(toCsv(rows), `comparison_${metrics.map((m) => m.id.replace(/^run_/, "")).join("_")}.csv`);
};

/** CSV dos grupos de repetição */
export const exportRepetitionsCsv = (runs: any[]) => {
    const groups = groupRepetitions(runs, "en");
    const dist = groupDistinctions(groups);
    const rows: (string | number | null)[][] = [[
        "Group", "n", "Differs from other groups", ...(groups[0]?.describe.map((d) => d.label) || []),
        "Preload mean (s)", "Preload sd (s)", "Preload log read mean (s)", "Preload log read sd (s)", "Stable op. mean (s)", "Failure→recovery mean (s)", "Failure→recovery sd (s)",
        "Recovery mean (s)", "Recovery sd (s)", "Recovery log read mean (s)", "Recovery log read sd (s)", "Recovery min (s)", "Recovery max (s)", "Tuples (mean)", "Experiments",
    ]];
    groups.forEach((g, i) => rows.push([
        `G${i + 1}`, g.runs.length, dist[i], ...g.describe.map((d) => d.value),
        g.preload.mean, g.preload.sd, g.preloadRead.mean, g.preloadRead.sd, g.stable.mean, g.downtime.mean, g.downtime.sd,
        g.recovery.mean, g.recovery.sd, g.recoveryRead.mean, g.recoveryRead.sd, g.recovery.min, g.recovery.max, g.preloadedTuples.mean,
        g.runs.map((r) => r.id).join(" "),
    ]));
    downloadText(toCsv(rows), `repetitions_${new Date().toISOString().slice(0, 10)}.csv`);
};

// ─── Repetições ───

const Repetitions = ({ runs, onCompare }: { runs: any[]; onCompare: (ids: string[]) => void }) => {
    const groups = useMemo(() => groupRepetitions(runs, "en"), [runs]);
    const distinctions = useMemo(() => groupDistinctions(groups), [groups]);
    const [open, setOpen] = useState<string | null>(null);

    if (groups.length === 0) {
        return <p className="text-xs text-slate-500 py-12 text-center">{T.repEmpty}</p>;
    }

    const th = "font-semibold py-2 px-2";
    return (
        <div className="space-y-3">
            <p className="text-xs text-slate-400 max-w-3xl">{T.repIntro}</p>
            <table className="w-full text-xs border-collapse">
                <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                        <th className={`${th} text-left pl-0`}>{T.repConfig}</th>
                        <th className={`${th} text-right`}>{T.repN}</th>
                        <th className={`${th} text-right`}>{T.repPreload}</th>
                        <th className={`${th} text-right`}>{T.repDowntime}</th>
                        <th className={`${th} text-right`}>{T.repRecovery}</th>
                        <th className={`${th} text-right`}>{T.repMinMax}</th>
                        <th className="py-2 pl-2"></th>
                    </tr>
                </thead>
                <tbody>
                    {groups.map((g: RepetitionGroup, gi: number) => {
                        const isOpen = open === g.key;
                        return (
                            <Fragment key={g.key}>
                                <tr className="border-b border-slate-800/70 hover:bg-slate-800/30 cursor-pointer" onClick={() => setOpen(isOpen ? null : g.key)}>
                                    <td className="py-1.5 pr-2 text-slate-300">
                                        <span className="text-slate-500">{isOpen ? "▾" : "▸"}</span>{" "}
                                        <strong className="text-slate-400">G{gi + 1}</strong>{" · "}
                                        {groupHeadline(g)}
                                        {distinctions[gi] && <span className="block text-[10px] text-slate-500 pl-4 mt-0.5 break-all">{distinctions[gi]}</span>}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono text-slate-200">{g.runs.length}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-cyan-300">{fmtStat(g.preload)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-slate-300">{fmtStat(g.downtime)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-amber-300">{fmtStat(g.recovery)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-slate-400">{g.recovery.min === null ? "—" : `${fmtNum(g.recovery.min, 3)} – ${fmtNum(g.recovery.max, 3)}`}</td>
                                    <td className="py-1.5 pl-2 text-right">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onCompare(g.runs.slice(0, 3).map((r) => r.id)); }}
                                            className={`${btn} border-slate-700 text-slate-300 hover:bg-slate-700`}
                                            title="Abre a comparação lado a lado com até 3 experimentos deste grupo."
                                        >
                                            {T.repCompare}
                                        </button>
                                    </td>
                                </tr>
                                {isOpen && (
                                    <tr className="bg-slate-950/50">
                                        <td colSpan={7} className="p-3">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                                                {g.describe.map((x) => (
                                                    <div key={x.key} className="flex justify-between gap-3"><span className="text-slate-500">{x.label}</span><span className="font-mono text-slate-300 text-right break-all">{x.value}</span></div>
                                                ))}
                                            </div>
                                            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                                                <div className="flex justify-between gap-3" title="PRELOAD_INDEX_OPEN → PRELOAD_COMPLETED (sem a contagem do log)"><span className="text-slate-500">{T.repPreloadRead}</span><span className="font-mono text-cyan-300">{fmtStat(g.preloadRead)}</span></div>
                                                <div className="flex justify-between gap-3" title="PRELOAD_INDEX_OPEN → RECOVERY_COMPLETED (sem a contagem do log)"><span className="text-slate-500">{T.repRecoveryRead}</span><span className="font-mono text-amber-300">{fmtStat(g.recoveryRead)}</span></div>
                                            </div>
                                            <div className="mt-2 text-[11px] text-slate-400">
                                                {T.repRuns}:{" "}
                                                {g.runs.map((r) => (
                                                    <span key={r.id} className="font-mono mr-3">{r.annotations?.label ? `${r.annotations.label} (${r.id})` : r.id}</span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
            <p className="text-[10px] text-slate-500">{T.repFoot}</p>
        </div>
    );
};

// ─── Contêiner ───

const ComparisonView = ({ tab, setTab, align, setAlign, metrics, rawRuns, listRuns, loading, onCompare, onExportJson, onPrint }: {
    tab: CompareTab; setTab: (t: CompareTab) => void;
    align: AlignMode; setAlign: (a: AlignMode) => void;
    metrics: RunMetrics[]; rawRuns: any[]; listRuns: any[]; loading: boolean;
    onCompare: (ids: string[]) => void;
    onExportJson: () => void;
    onPrint: () => void;
}) => (
    <div className="bg-slate-900 border border-slate-800 p-5 space-y-5">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 gap-4">
            <div className="flex text-xs border border-slate-700" title={TIP.history.repetitions}>
                <button onClick={() => setTab("side")} className={`px-3 py-1.5 ${tab === "side" ? segOn : segOff}`}>
                    {T.sideBySide}{metrics.length > 0 && ` (${metrics.length})`}
                </button>
                <button onClick={() => setTab("repetitions")} className={`px-3 py-1.5 ${tab === "repetitions" ? segOn : segOff}`}>
                    {T.repetitions}
                </button>
            </div>
            <ExportMenu
                items={tab === "side" ? [
                    { label: UI.history.exportCsv, ext: ".csv", tip: TIP.history.exportCsv, disabled: metrics.length === 0, onClick: () => exportSideBySideCsv(metrics, rawRuns) },
                    { label: UI.history.exportJson, ext: ".json", tip: TIP.exportJson, disabled: metrics.length === 0, onClick: onExportJson },
                    { label: UI.history.exportPdf, ext: ".pdf", tip: TIP.history.exportPdfCompare, disabled: metrics.length === 0 || loading, onClick: onPrint },
                ] : [
                    { label: UI.history.exportCsv, ext: ".csv", tip: TIP.history.exportCsv, disabled: listRuns.length === 0, onClick: () => exportRepetitionsCsv(listRuns) },
                    { label: UI.history.exportPdf, ext: ".pdf", tip: TIP.history.exportPdfCompare, disabled: listRuns.length === 0, onClick: onPrint },
                ]}
            />
        </div>

        {tab === "repetitions" ? (
            <Repetitions runs={listRuns} onCompare={onCompare} />
        ) : metrics.length === 0 ? (
            <p className="text-sm text-slate-500 py-16 text-center">{T.pickRuns}</p>
        ) : (
            <>
                <div className="flex flex-wrap gap-2 items-center">
                    {metrics.map((m, i) => (
                        <div key={m.id} className="flex items-center gap-2 border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-xs">
                            <span className="px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: RUN_COLORS[i] }}>{m.tag}</span>
                            <span className="text-slate-200">{m.sum.annotations.label || <span className="font-mono">{m.id}</span>}</span>
                            {m.sum.annotations.label && <span className="font-mono text-[10px] text-slate-500">{m.id}</span>}
                        </div>
                    ))}
                    {loading && <span className="text-[11px] text-slate-500">{T.loading}</span>}
                </div>
                {metrics.length === 1 && <p className="text-xs text-slate-500">{T.pickOneMore}</p>}
                <SideBySide metrics={metrics} rawRuns={rawRuns} align={align} setAlign={setAlign} />
            </>
        )}
    </div>
);

export default ComparisonView;
