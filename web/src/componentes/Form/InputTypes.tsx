import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface BaseInputProps {
    isDisable?: boolean;
    children?: React.ReactNode;
    tooltip?: string;
    hasError?: boolean;
    errorMessage?: string;
    unit?: string;
}

interface TextInputProps extends BaseInputProps {
    TextName: string;
    TextPlaceholder: string;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface SwitchInputProps extends BaseInputProps {
    SwitchName: string;
    checked?: boolean;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSwitchCheck?: () => void;
}

interface NumericInputProps extends BaseInputProps {
    NumericName: string;
    NumericMin?: number;
    NumericMax?: number;
    NumericSteps?: number;
    value?: number;
    onChangeValue?: (val: number) => void;
}

/**
 * Ícone "i" com dica (tooltip).
 * O balão é renderizado num portal em document.body com posição fixa:
 *  - não é cortado por contêineres com overflow (ex.: o sidebar);
 *  - abre para baixo quando não há espaço acima e fica sempre dentro da janela;
 *  - não herda estilos do título onde está (ex.: `uppercase`), então todas as dicas
 *    aparecem no mesmo padrão: texto normal, só iniciais de frase e nomes próprios em maiúscula.
 */
export const TooltipBadge = ({ text }: { text?: string }) => {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

    if (!text) return null;

    const WIDTH = 256;   // largura do balão (px)
    const GAP = 8;       // distância entre o ícone e o balão (px)
    const MARGIN = 8;    // margem mínima até a borda da janela (px)

    const open = () => {
        const r = anchorRef.current?.getBoundingClientRect();
        if (!r) return;
        const center = r.left + r.width / 2;
        const left = Math.min(Math.max(center - WIDTH / 2, MARGIN), window.innerWidth - WIDTH - MARGIN);
        // Abre para cima se houver ~120 px livres acima; senão, para baixo
        const above = r.top > 120;
        setPos({ left, top: above ? r.top - GAP : r.bottom + GAP, above });
    };
    const close = () => setPos(null);

    return (
        <span className="inline-flex items-center ml-1 normal-case">
            <span
                ref={anchorRef}
                tabIndex={0}
                role="img"
                aria-label={text}
                onMouseEnter={open}
                onMouseLeave={close}
                onFocus={open}
                onBlur={close}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                className="inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-extrabold text-white bg-blue-600 hover:bg-blue-500 rounded-none cursor-help transition-colors ring-1 ring-blue-400/50 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
                i
            </span>
            {pos && createPortal(
                <div
                    role="tooltip"
                    style={{
                        position: "fixed",
                        left: pos.left,
                        top: pos.top,
                        width: WIDTH,
                        transform: pos.above ? "translateY(-100%)" : undefined,
                    }}
                    className="z-[1000] p-2 bg-slate-900 text-slate-200 text-[11px] font-normal normal-case tracking-normal leading-snug text-left whitespace-normal rounded-none shadow-2xl border border-slate-700 pointer-events-none"
                >
                    {text}
                </div>,
                document.body
            )}
        </span>
    );
};

export const TextInput = ({
    TextName,
    TextPlaceholder,
    isDisable,
    children,
    value,
    onChange,
    tooltip,
    hasError,
    errorMessage,
    unit
}: TextInputProps) => {
    return (
        <div className="flex flex-col my-1 w-full">
            <div className="font-semibold text-xs text-slate-300 flex items-center justify-between gap-1 mb-1">
                <label htmlFor={`input-${TextName}`} className="flex items-center gap-1">
                    <span>{children}</span>
                    {unit && <span className="text-slate-400 font-normal">({unit})</span>}
                    <TooltipBadge text={tooltip} />
                </label>
            </div>
            <input
                type="text"
                name={TextName}
                id={`input-${TextName}`}
                className={`w-full h-7 px-2 text-xs border bg-slate-800 text-slate-200 rounded-none focus:outline-none transition-colors ${
                    hasError 
                        ? "border-rose-500 bg-rose-950/30 focus:ring-1 focus:ring-rose-500" 
                        : "border-slate-700 focus:ring-1 focus:ring-blue-500"
                } ${isDisable ? "opacity-50 cursor-not-allowed bg-slate-900" : ""}`}
                placeholder={TextPlaceholder}
                disabled={isDisable}
                value={value !== undefined ? value : ""}
                onChange={onChange}
            />
            {hasError && errorMessage && (
                <span className="text-[10px] font-medium text-rose-400 mt-0.5">{errorMessage}</span>
            )}
        </div>
    );
};

export const SwitchInput = ({
    SwitchName,
    onSwitchCheck,
    isDisable,
    children,
    checked,
    onChange,
    tooltip
}: SwitchInputProps) => {
    return (
        <div className="w-full my-1">
            <div className="font-semibold text-xs text-slate-300 flex items-center justify-between">
                <label htmlFor={`switch-${SwitchName}`} className={`inline-flex items-center gap-2 cursor-pointer ${isDisable ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        name={SwitchName}
                        id={`switch-${SwitchName}`}
                        disabled={isDisable}
                        checked={!!checked}
                        onChange={(e) => {
                            if (onSwitchCheck) onSwitchCheck();
                            if (onChange) onChange(e);
                        }}
                    />
                    <div className="relative w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-none peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-none after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="select-none">{children}</span>
                </label>
                <TooltipBadge text={tooltip} />
            </div>
        </div>
    );
};

/**
 * Botão ▲/▼ ao lado dos campos numéricos.
 *  - clique: um passo; Shift + clique: 10 passos;
 *  - segurar: repete (após 400 ms, a cada 60 ms) até soltar ou sair do botão;
 *  - fica desativado no mínimo/máximo do campo.
 * tabIndex -1: o Tab segue de campo em campo; no teclado, as setas ↑/↓ do próprio campo fazem o mesmo.
 */
const StepButton = ({
    direction,
    disabled,
    onStep,
    label,
}: {
    direction: "up" | "down";
    disabled: boolean;
    onStep: (mult: number) => void;
    label: string;
}) => {
    const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const onStepRef = useRef(onStep);
    onStepRef.current = onStep;

    const stop = () => {
        if (delayRef.current) clearTimeout(delayRef.current);
        if (repeatRef.current) clearInterval(repeatRef.current);
        delayRef.current = null;
        repeatRef.current = null;
    };

    useEffect(() => stop, []);
    useEffect(() => { if (disabled) stop(); }, [disabled]);

    return (
        <button
            type="button"
            tabIndex={-1}
            aria-label={label}
            title={`${label} (Shift: ×10)`}
            disabled={disabled}
            onPointerDown={(e) => {
                if (disabled || e.button !== 0) return;
                e.preventDefault(); // mantém o foco no campo
                const mult = e.shiftKey ? 10 : 1;
                onStepRef.current(mult);
                stop();
                delayRef.current = setTimeout(() => {
                    repeatRef.current = setInterval(() => onStepRef.current(mult), 60);
                }, 400);
            }}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            className="flex-1 flex items-center justify-center text-slate-400 bg-slate-900/40 hover:bg-blue-600/25 hover:text-blue-300 active:bg-blue-600/40 active:text-blue-200 transition-colors disabled:opacity-30 disabled:hover:bg-slate-900/40 disabled:hover:text-slate-400 disabled:cursor-not-allowed select-none"
        >
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {direction === "up" ? <path d="M2 6.5 5 3.5l3 3" /> : <path d="M2 3.5 5 6.5l3-3" />}
            </svg>
        </button>
    );
};

export const NumericInput = ({
    NumericName,
    NumericMin = 0,
    NumericMax,
    NumericSteps = 1,
    isDisable,
    children,
    value,
    onChangeValue,
    tooltip,
    hasError,
    errorMessage,
    unit
}: NumericInputProps) => {
    // Valor mais recente num ref: o "segurar para repetir" chama stepBy várias vezes
    // antes de o componente renderizar de novo.
    const valueRef = useRef<number | undefined>(value);
    valueRef.current = value;

    const decimals = (String(NumericSteps).split(".")[1] || "").length;
    const clamp = (v: number) => {
        let out = v;
        if (NumericMin !== undefined) out = Math.max(NumericMin, out);
        if (NumericMax !== undefined) out = Math.min(NumericMax, out);
        return Number(out.toFixed(decimals));
    };
    const stepBy = (mult: number) => {
        if (isDisable || !onChangeValue) return;
        const cur = valueRef.current;
        // Campo vazio/inválido: o primeiro clique só preenche com o mínimo
        const next = cur === undefined || Number.isNaN(cur)
            ? clamp(NumericMin ?? 0)
            : clamp(cur + mult * NumericSteps);
        if (next === cur) return;
        valueRef.current = next;
        onChangeValue(next);
    };
    const hasValue = value !== undefined && !Number.isNaN(value);
    const atMin = hasValue && NumericMin !== undefined && (value as number) <= NumericMin;
    const atMax = hasValue && NumericMax !== undefined && (value as number) >= NumericMax;
    const fieldLabel = typeof children === "string" ? children : NumericName;

    return (
        <div className="flex flex-col my-1 w-full">
            <div className="font-semibold text-xs text-slate-300 flex items-center justify-between gap-1 mb-1">
                <label htmlFor={`input-${NumericName}`} className="flex items-center gap-1">
                    <span>{children}</span>
                    {unit && <span className="text-slate-400 font-normal">({unit})</span>}
                    <TooltipBadge text={tooltip} />
                </label>
            </div>
            <div
                className={`flex items-stretch w-full h-7 border rounded-none transition-colors ${
                    hasError
                        ? "border-rose-500 bg-rose-950/30 focus-within:ring-1 focus-within:ring-rose-500"
                        : "border-slate-700 bg-slate-800 hover:border-slate-600 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/60"
                } ${isDisable ? "opacity-50 cursor-not-allowed !bg-slate-900 hover:border-slate-700" : ""}`}
            >
                <input
                    type="number"
                    inputMode="decimal"
                    name={NumericName}
                    id={`input-${NumericName}`}
                    className="flex-1 min-w-0 h-full px-2 text-xs font-mono tabular-nums bg-transparent text-slate-200 rounded-none focus:outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    min={NumericMin}
                    max={NumericMax}
                    step={NumericSteps}
                    value={hasValue ? value : ""}
                    onChange={(e) => {
                        const valStr = e.target.value;
                        if (valStr === "") {
                            if (onChangeValue) onChangeValue(NaN);
                            return;
                        }
                        const val = parseFloat(valStr);
                        if (onChangeValue) onChangeValue(val);
                    }}
                    onKeyDown={(e) => {
                        // Setas do teclado: mesmo passo dos botões (Shift = ×10), respeitando mín./máx.
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                            e.preventDefault();
                            stepBy((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
                        }
                    }}
                    disabled={isDisable}
                />
                <div className="flex flex-col w-6 shrink-0 border-l border-slate-700">
                    <StepButton direction="up" disabled={!!isDisable || atMax} onStep={(m) => stepBy(m)} label={`Increase ${fieldLabel}`} />
                    <div className="h-px shrink-0 bg-slate-700" />
                    <StepButton direction="down" disabled={!!isDisable || atMin} onStep={(m) => stepBy(-m)} label={`Decrease ${fieldLabel}`} />
                </div>
            </div>
            {hasError && errorMessage && (
                <span className="text-[10px] font-medium text-rose-400 mt-0.5">{errorMessage}</span>
            )}
        </div>
    );
};
