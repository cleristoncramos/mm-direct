import OptionsBoard from "./OptionsBoard";
import { NumericInput, SwitchInput } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

const FailureOptions = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const { 
        restartDaleyTime,
        enableRestartAfterTime,
        restartAfterTime, 
        numberRestartsAfterTime, 
        enablePreloadDatabase,
        preloadDatabaseAndRestart, 
        numberRestartsAfterPreloading, 
        updateField 
    } = useExperimentStore();

    const hasErrors = !!(
        errors.restartDaleyTime || 
        errors.restartAfterTime || 
        errors.numberRestartsAfterTime || 
        errors.preloadDatabaseAndRestart || 
        errors.numberRestartsAfterPreloading
    );

    const hasMultipleRestarts = (enableRestartAfterTime && numberRestartsAfterTime > 1) || (enablePreloadDatabase && numberRestartsAfterPreloading > 1);

    return (
        <OptionsBoard BoardHeader="Failure simulation" hasErrors={hasErrors} isDisabled={isDisabled}>
            <NumericInput 
                NumericName="restartDaleyTime"
                value={restartDaleyTime}
                onChangeValue={(val) => updateField("restartDaleyTime", val)}
                isDisable={isDisabled}
                hasError={!!errors.restartDaleyTime}
                errorMessage={errors.restartDaleyTime}
                unit="s"
                tooltip="Tempo de atraso (em segundos) que o sistema aguarda antes de efetivar a reinicialização ou falha simulada."
            >
                Restart delay time
            </NumericInput>

            <div className="my-1.5 pt-1.5 border-t border-slate-800">
                <SwitchInput 
                    SwitchName="enableRestartAfterTime"
                    checked={enableRestartAfterTime}
                    onChange={(e: any) => {
                        const checked = e.target.checked;
                        updateField("enableRestartAfterTime", checked);
                        if (checked) {
                            updateField("enablePreloadDatabase", false);
                        }
                    }}
                    isDisable={isDisabled}
                    tooltip="Habilita a simulação de falhas por decurso de tempo. Esta opção é mutuamente exclusiva com a falha baseada em pré-carregamento."
                >
                    Time-based Failure Simulation
                </SwitchInput>

                {enableRestartAfterTime && (
                    <div className="mt-1 space-y-1">
                        <NumericInput 
                            NumericName="restartAfterTime"
                            value={restartAfterTime}
                            onChangeValue={(val) => updateField("restartAfterTime", val)}
                            isDisable={isDisabled}
                            hasError={!!errors.restartAfterTime}
                            errorMessage={errors.restartAfterTime}
                            unit="s"
                            tooltip="Tempo decorrido (em segundos) a partir do início da execução para disparar a falha simulada no banco de dados."
                        >
                            Restart after time
                        </NumericInput>

                        <NumericInput 
                            NumericName="numberRestartsAfterTime"
                            value={numberRestartsAfterTime}
                            onChangeValue={(val) => updateField("numberRestartsAfterTime", val)}
                            isDisable={isDisabled}
                            hasError={!!errors.numberRestartsAfterTime}
                            errorMessage={errors.numberRestartsAfterTime}
                            NumericMin={1}
                            NumericMax={10}
                            unit="qty"
                            tooltip="Quantidade total de falhas/reinicializações sucessivas por tempo a serem executadas no experimento."
                        >
                            Restarts after time
                        </NumericInput>
                    </div>
                )}
            </div>

            <div className="my-1.5 pt-1.5 border-t border-slate-800">
                <SwitchInput 
                    SwitchName="enablePreloadDatabase"
                    checked={enablePreloadDatabase}
                    onChange={(e: any) => {
                        const checked = e.target.checked;
                        updateField("enablePreloadDatabase", checked);
                        if (checked) {
                            updateField("enableRestartAfterTime", false);
                            // Garante um tempo válido ao ligar o modo: reaproveita o tempo do modo
                            // por tempo (padrão 30 s) em vez de deixar 0, que não dispara falha.
                            if (!(preloadDatabaseAndRestart > 0)) {
                                updateField("preloadDatabaseAndRestart", restartAfterTime > 0 ? restartAfterTime : 30);
                            }
                            if (!(numberRestartsAfterPreloading >= 1)) {
                                updateField("numberRestartsAfterPreloading", 1);
                            }
                        }
                    }}
                    isDisable={isDisabled}
                    tooltip="Habilita o pré-carregamento do banco de dados na memória antes de simular falhas. Esta opção é mutuamente exclusiva com a falha baseada em tempo."
                >
                    Preload-based Failure Simulation
                </SwitchInput>

                {enablePreloadDatabase && (
                    <div className="mt-1 space-y-1">
                        <div className="p-2 my-1 bg-blue-950/40 border border-blue-800/60 text-[10px] text-blue-300 font-mono">
                            The failure is triggered this many seconds after the preload completes.
                        </div>

                        <NumericInput 
                            NumericName="preloadDatabaseAndRestart"
                            value={preloadDatabaseAndRestart}
                            onChangeValue={(val) => updateField("preloadDatabaseAndRestart", val)}
                            isDisable={isDisabled}
                            hasError={!!errors.preloadDatabaseAndRestart}
                            errorMessage={errors.preloadDatabaseAndRestart}
                            unit="s"
                            NumericMin={1}
                            tooltip="Tempo de operação estável, contado a partir do fim do preload, até a falha simulada (em segundos). Precisa ser maior que 0: com 0 o Redis-IR não agenda a falha."
                        >
                            Failure after preload
                        </NumericInput>

                        <NumericInput 
                            NumericName="numberRestartsAfterPreloading"
                            value={numberRestartsAfterPreloading}
                            onChangeValue={(val) => updateField("numberRestartsAfterPreloading", val)}
                            isDisable={isDisabled}
                            hasError={!!errors.numberRestartsAfterPreloading}
                            errorMessage={errors.numberRestartsAfterPreloading}
                            NumericMin={1}
                            NumericMax={10}
                            unit="qty"
                            tooltip="Quantidade de falhas/reinicializações simuladas neste modo. Use 1 para comparar experimentos."
                        >
                            Restarts
                        </NumericInput>
                    </div>
                )}
            </div>

            {hasMultipleRestarts && (
                <div className="p-2 mt-2 bg-amber-950/40 border border-amber-800/60 text-[10px] text-amber-300 font-mono">
                    Multiple successive failures (&gt;1) make the charts harder to compare.
                </div>
            )}
        </OptionsBoard>
    );
};

export default FailureOptions;