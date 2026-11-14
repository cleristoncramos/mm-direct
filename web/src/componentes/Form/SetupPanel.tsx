import SetupForm from "./SetupForm";
import { useExperimentStore } from "../../store/experimentStore";
import { validateExperimentForm } from "../../utils/formValidation";
import { useMemo, useState } from "react";
import { UI } from "../../i18n/strings";

interface SetupPanelProps {
    initServer: (params: any) => void;
    isExecutionRunning?: boolean;
}

const SetupPanel = ({ initServer, isExecutionRunning = false }: SetupPanelProps) => {
    const store = useExperimentStore();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Dynamic real-time form validation
    const errors = useMemo(() => {
        return validateExperimentForm(store);
    }, [store]);

    function onSubmitButtonPressed(e: React.FormEvent) {
        e.preventDefault();

        // 1. Validar todos os parâmetros antes de enviar
        const currentErrors = validateExperimentForm(store);
        if (Object.keys(currentErrors).length > 0) {
            console.warn("Submissão ignorada: existem erros de validação.", currentErrors);
            return;
        }

        if (isSubmitting || isExecutionRunning) return;
        setIsSubmitting(true);

        // Convert store state to the format expected by the backend
        const request: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(store)) {
            if (typeof value === "function") continue;
            
            // Ignora chaves exclusivas de UI (frontend-only)
            if (key === "enableRestartAfterTime" || key === "enablePreloadDatabase") continue;
            
            if (typeof value === "boolean") {
                request[key] = value ? "ON" : "OFF";
            } else {
                request[key] = String(value);
            }
        }

        // Se a opção estiver desligada na UI, envia 0 para o backend para desativá-la
        if (!store.enableRestartAfterTime) {
            request.restartAfterTime = "0";
            request.numberRestartsAfterTime = "0";
        }
        if (!store.enablePreloadDatabase) {
            request.preloadDatabaseAndRestart = "0";
            request.numberRestartsAfterPreloading = "0";
        }

        console.log("Configuração enviada ao backend:", request);

        fetch("http://localhost:8081/config", {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                "Content-type": "application/json; charset=UTF-8"
            }
        })
            .then((resp: Response) => resp.json())
            .then((json) => {
                console.log("Configuração salva com sucesso:", json);
                initServer(json);
            })
            .catch((error) => {
                console.error("Erro ao salvar configuração:", error);
            })
            .finally(() => {
                setIsSubmitting(false);
            });
    }

    function ResetFunction(e: React.FormEvent) {
        e.preventDefault();
        const reset = window.confirm(UI.setup.resetConfirm);
        if (reset) {
            store.reset();
        }
    }

    const isDisabled = isSubmitting || isExecutionRunning;

    return (
        <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-none shadow-2xl overflow-hidden">
            <div className="bg-slate-800/80 py-2.5 px-4 border-b border-slate-700/80 flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">{UI.setup.title}</h2>
                {isExecutionRunning && (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-mono ">
                        {UI.setup.locked}
                    </span>
                )}
            </div>
            <div className="flex-1 overflow-hidden bg-slate-900">
                <SetupForm
                    submitFunction={onSubmitButtonPressed}
                    resetFunction={ResetFunction}
                    errors={errors}
                    isDisabled={isDisabled}
                />
            </div>
        </div>
    );
};

export default SetupPanel;
