import { useState } from "react";
import { RunAnnotations } from "./runSummary";
import { UI, TIP } from "../../i18n/strings";

const T = UI.history.notes;

/**
 * Rótulo, etiquetas e notas de um experimento, gravados em src/runs/<id>/annotations.json.
 * Montar com key={runId} para reiniciar o formulário ao trocar de experimento.
 */
const AnnotationsEditor = ({ runId, initial, onSaved }: {
    runId: string;
    initial: RunAnnotations;
    onSaved: (a: RunAnnotations) => void;
}) => {
    const [label, setLabel] = useState(initial.label || "");
    const [tags, setTags] = useState((initial.tags || []).join(", "));
    const [notes, setNotes] = useState(initial.notes || "");
    const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    const dirty = label !== (initial.label || "") || tags !== (initial.tags || []).join(", ") || notes !== (initial.notes || "");

    const save = async () => {
        setState("saving");
        setError(null);
        try {
            const res = await fetch(`http://localhost:8081/api/runs/${runId}/annotations`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    label,
                    notes,
                    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
            onSaved(body);
            setState("saved");
            setTimeout(() => setState("idle"), 2000);
        } catch (e: any) {
            setError(e?.message || T.failed);
            setState("error");
        }
    };

    const input = "w-full bg-slate-950 border border-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500";

    return (
        <div className="bg-slate-950/40 border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-[11px] uppercase font-bold tracking-wider text-slate-400" title={TIP.history.notes}>{T.title}</h3>
                <span className="text-[10px] text-slate-600">annotations.json</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1 block h-auto">
                    <span className="text-[10px] text-slate-500">{T.label}</span>
                    <input className={input} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)}
                        placeholder={T.labelPh} />
                </label>
                <label className="space-y-1 block h-auto">
                    <span className="text-[10px] text-slate-500">{T.tags}</span>
                    <input className={input} value={tags} onChange={(e) => setTags(e.target.value)}
                        placeholder={T.tagsPh} />
                </label>
            </div>
            <label className="space-y-1 block h-auto">
                <span className="text-[10px] text-slate-500">{T.notes}</span>
                <textarea className={`${input} min-h-[64px] resize-y`} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)}
                    placeholder={T.notesPh} />
            </label>
            <div className="flex items-center justify-end gap-3">
                {state === "saved" && <span className="text-[11px] text-emerald-400">{T.saved}</span>}
                {state === "error" && <span className="text-[11px] text-rose-400">{error}</span>}
                <button
                    onClick={save}
                    disabled={!dirty || state === "saving"}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold transition"
                >
                    {state === "saving" ? T.saving : T.save}
                </button>
            </div>
        </div>
    );
};

export default AnnotationsEditor;
