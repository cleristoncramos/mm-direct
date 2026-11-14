import IndexerOptions from "./IndexerOptions";
import CheckpointerOptions from "./CheckpointerOptions";
import FailureOptions from "./FailureOptions";
import MemtierOptions from "./MemtierOptions";
import ReportOptions from "./ReportOptions";
import ResetButton from "./ResetFormButton";
import StartButton from "./StartButton";
import DatabaseStatusSection, { DbStatus } from "./DatabaseStatusSection";
import ExperimentEssentials from "./ExperimentEssentials";
import { TooltipBadge } from "./InputTypes";
import { FormErrorState } from "../../utils/formValidation";
import { useExperimentStore } from "../../store/experimentStore";
import { useState } from "react";
import { UI } from "../../i18n/strings";

interface SetupFormProps {
    submitFunction: (e: React.FormEvent) => void;
    resetFunction: (e: React.FormEvent) => void;
    errors?: FormErrorState;
    isDisabled?: boolean;
}

const SetupForm = ({ submitFunction, resetFunction, errors = {}, isDisabled = false }: SetupFormProps) => {
    const store = useExperimentStore();
    const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
    const [isPreparingDb, setIsPreparingDb] = useState<boolean>(false);

    const hasAnyErrors = Object.keys(errors).length > 0;
    // O carregamento inicial (preload) a partir do log indexado acontece em toda execução
    // com recuperação instantânea ligada — independe da opção "enablePreloadDatabase",
    // que controla apenas o reinício após o preload. Sem base, o preload falha.
    const isInvalidForPreload = store.instantRecoveryState && dbStatus !== null && !dbStatus.isValid;

    return (
        <form className="h-full flex flex-col" onSubmit={submitFunction}>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-1 custom-scrollbar">
                <DatabaseStatusSection isDisabled={isDisabled} onStatusChange={setDbStatus} onPreparingChange={setIsPreparingDb} />
                <ExperimentEssentials errors={errors} isDisabled={isDisabled} />

                {/* Demais parâmetros, com valores padrão; cada seção abre quando precisar ajustar */}
                <div className="flex items-center gap-2 pt-2 pb-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center">
                        Advanced settings
                        <TooltipBadge text="Parâmetros detalhados do indexador (indexação síncrona, intervalo), do checkpoint, da falha, da carga (memtier) e dos relatórios. Já vêm com valores padrão; só é preciso abrir para ajustar." />
                    </span>
                    <span className="flex-1 h-px bg-slate-800" />
                </div>
                <IndexerOptions errors={errors} isDisabled={isDisabled} />
                <CheckpointerOptions errors={errors} isDisabled={isDisabled} />
                <FailureOptions errors={errors} isDisabled={isDisabled} />
                <MemtierOptions errors={errors} isDisabled={isDisabled} />
                <ReportOptions errors={errors} isDisabled={isDisabled} />
            </div>
            
            {hasAnyErrors && (
                <div className="mx-3 mt-2 p-2 bg-rose-950/40 border border-rose-600/60 text-[10px] text-rose-300 font-mono">
                    {UI.setup.invalidFields}
                </div>
            )}

            <div className="flex flex-row justify-center gap-3 my-3 px-3 flex-wrap">
                <ResetButton onResetButtonClick={resetFunction} disabled={isDisabled} />
                <StartButton onClickButton={submitFunction} disabled={isDisabled || hasAnyErrors || isInvalidForPreload || isPreparingDb} />
            </div>
        </form>
    );
};

export default SetupForm;