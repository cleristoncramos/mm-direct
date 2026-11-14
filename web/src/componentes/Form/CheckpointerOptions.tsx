import OptionsBoard from "./OptionsBoard";
import { SwitchInput, NumericInput } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

const CheckpointerOptions = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const { 
        checkpointState, 
        checkpointsOnlyMfu, 
        numberCheckpoints, 
        checkpointTimeInterval, 
        selftuneCheckpointTimeInterval, 
        updateField 
    } = useExperimentStore();

    const hasErrors = !!(errors.numberCheckpoints || errors.checkpointTimeInterval);
    const areDependentsDisabled = isDisabled || !checkpointState;

    return (
        <OptionsBoard BoardHeader="Checkpointer" hasErrors={hasErrors} isDisabled={isDisabled}>
            <div className="flex justify-around flex-wrap gap-2 mb-2">
                <SwitchInput 
                    SwitchName="checkpointState"
                    checked={checkpointState}
                    onChange={(e) => updateField("checkpointState", e.target.checked)}
                    isDisable={isDisabled}
                    tooltip="Habilita a execução periódica do processo de checkpoint no log indexado durante a operação normal do banco."
                >
                    Checkpoint
                </SwitchInput>
                <SwitchInput 
                    SwitchName="checkpointsOnlyMfu"
                    checked={checkpointsOnlyMfu}
                    onChange={(e) => updateField("checkpointsOnlyMfu", e.target.checked)}
                    isDisable={areDependentsDisabled}
                    tooltip="Salva no checkpoint apenas as tuplas mais frequentemente acessadas (Most Frequently Used)."
                >
                    Only MFU
                </SwitchInput>
            </div>
            <NumericInput 
                NumericName="numberCheckpoints"
                value={numberCheckpoints}
                onChangeValue={(val) => updateField("numberCheckpoints", val)}
                isDisable={areDependentsDisabled}
                hasError={!!errors.numberCheckpoints}
                errorMessage={errors.numberCheckpoints}
                unit="qty"
                tooltip="Quantidade de processos de checkpoint a serem executados (se 0, executa continuamente)."
            >
                Checkpoints quantity
            </NumericInput>
            <NumericInput 
                NumericName="checkpointTimeInterval"
                value={checkpointTimeInterval}
                onChangeValue={(val) => updateField("checkpointTimeInterval", val)}
                isDisable={areDependentsDisabled || selftuneCheckpointTimeInterval}
                hasError={!!errors.checkpointTimeInterval}
                errorMessage={errors.checkpointTimeInterval}
                unit="s"
                tooltip="Intervalo de tempo fixo (em segundos) entre execuções de checkpoint."
            >
                Time interval
            </NumericInput>
            <SwitchInput 
                SwitchName="selftuneCheckpointTimeInterval"
                checked={selftuneCheckpointTimeInterval}
                onChange={(e) => updateField("selftuneCheckpointTimeInterval", e.target.checked)}
                isDisable={areDependentsDisabled}
                tooltip="Auto-ajusta dinamicamente o intervalo entre checkpoints conforme o ritmo das transações."
            >
                Self tune time interval
            </SwitchInput>
        </OptionsBoard>
    );
};

export default CheckpointerOptions;