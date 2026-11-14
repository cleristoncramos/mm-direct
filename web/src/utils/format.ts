/**
 * Formatação única de números da interface (padrão en-US, como os rótulos).
 * Durações medidas mantêm 3 casas (milissegundos), porque são resultado experimental;
 * percentuais e memória usam 1 casa; latência no servidor usa 2.
 */

const nf = (digits: number) =>
    new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtSeconds = (s: number | null | undefined, digits = 3) =>
    s === null || s === undefined || !Number.isFinite(s) ? "—" : `${nf(digits).format(s)} s`;

export const fmtPercent = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : `${nf(1).format(v)}%`;

export const fmtMB = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : `${nf(1).format(v)} MB`;

export const fmtMicros = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : `${nf(2).format(v)} µs`;

export const fmtInt = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("en-US").format(Math.round(v));

/** 1,000,000 → "1M"; 25,000 → "25K" */
export const fmtCompact = (v: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export const fmtBytes = (n: number) => {
    if (n >= 1024 ** 3) return `${nf(1).format(n / 1024 ** 3)} GB`;
    if (n >= 1024 ** 2) return `${nf(1).format(n / 1024 ** 2)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
};

/** Duração aproximada para estimativas: "~44 s", "~7 min", "~1 h 05 min" */
export const fmtApproxDuration = (s: number) => {
    if (s < 60) return `~${Math.max(1, Math.round(s))} s`;
    const m = Math.round(s / 60);
    return m < 60 ? `~${m} min` : `~${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

/** Cronômetro: "45 s", "7 m 36 s" */
export const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m} m ${String(sec).padStart(2, "0")} s` : `${sec} s`;
};

/** Número genérico en-US com casas fixas; "—" quando ausente */
export const fmtNum = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : nf(digits).format(v);

/** Data e hora curtas, dia primeiro (24 h): "21/10/26, 13:52" */
export const fmtDateTime = (d: Date | null | undefined) => {
    if (!d || Number.isNaN(d.getTime())) return "—";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};
