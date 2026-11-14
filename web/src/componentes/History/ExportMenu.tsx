import { useEffect, useRef, useState } from "react";
import { UI } from "../../i18n/strings";

export interface ExportItem {
    label: string;
    ext: string;
    tip?: string;
    disabled?: boolean;
    onClick: () => void;
}

/** Botão "Export" com menu, igual ao da tela do experimento */
const ExportMenu = ({ items }: { items: ExportItem[] }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
    }, [open]);

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                className={`px-3 py-1.5 border rounded-none text-xs font-semibold transition flex items-center gap-1.5 ${
                    open ? "bg-slate-700 border-slate-600 text-white" : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                }`}
            >
                {UI.history.export}
                <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div role="menu" className="absolute right-0 top-full mt-1 w-44 bg-slate-900 border border-slate-700 shadow-2xl z-50 py-1">
                    {items.map((it) => (
                        <button
                            key={it.label}
                            role="menuitem"
                            title={it.tip}
                            disabled={it.disabled}
                            onClick={() => { setOpen(false); it.onClick(); }}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:text-slate-600 disabled:hover:bg-transparent flex justify-between items-center"
                        >
                            {it.label}<span className="text-[10px] text-slate-500 font-mono">{it.ext}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ExportMenu;
