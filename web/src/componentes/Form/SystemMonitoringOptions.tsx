import OptionsBoard from "./OptionsBoard";
import { TextInput, SwitchInput, NumericInput } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

const SystemMonitoringOptions = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const { 
        systemMonitoring, 
        stopSystemMonitoringEndBenchmark, 
        systemMonitoringCsvFilename, 
        systemMonitoringTimeInterval, 
        overwriteSystemMonitoring, 
        updateField 
    } = useExperimentStore();

    const hasErrors = !!(errors.systemMonitoringTimeInterval || errors.systemMonitoringCsvFilename);
    const areDependentsDisabled = isDisabled || !systemMonitoring;

    return (
        <OptionsBoard BoardHeader="System monitoring" hasErrors={hasErrors} isDisabled={isDisabled}>
            <div className="flex justify-around flex-wrap gap-2 mb-2">
                <SwitchInput 
                    SwitchName="systemMonitoring"
                    checked={systemMonitoring}
                    onChange={(e) => updateField("systemMonitoring", e.target.checked)}
                    isDisable={isDisabled}
                    tooltip="Habilita a amostragem periódica de recursos (uso de CPU e memória RAM)."
                >
                    System monitoring
                </SwitchInput>
                <SwitchInput 
                    SwitchName="stopSystemMonitoringEndBenchmark"
                    checked={stopSystemMonitoringEndBenchmark}
                    onChange={(e) => updateField("stopSystemMonitoringEndBenchmark", e.target.checked)}
                    isDisable={areDependentsDisabled}
                    tooltip="Encerra automaticamente a amostragem de recursos ao finalizar a execução do Memtier Benchmark."
                >
                    Stop after Benchmark finish
                </SwitchInput>
            </div>
            <TextInput
                TextName="systemMonitoringCsvFilename"
                TextPlaceholder="system_monitoring/system_monitoring.csv"
                value={systemMonitoringCsvFilename}
                onChange={(e) => updateField("systemMonitoringCsvFilename", e.target.value)}
                isDisable={areDependentsDisabled}
                hasError={!!errors.systemMonitoringCsvFilename}
                errorMessage={errors.systemMonitoringCsvFilename}
                tooltip="Caminho do arquivo de dados CSV de monitoramento do sistema."
            >
                Filename
            </TextInput>
            <NumericInput 
                NumericName="systemMonitoringTimeInterval"
                value={systemMonitoringTimeInterval}
                onChangeValue={(val) => updateField("systemMonitoringTimeInterval", val)}
                isDisable={areDependentsDisabled}
                hasError={!!errors.systemMonitoringTimeInterval}
                errorMessage={errors.systemMonitoringTimeInterval}
                unit="s"
                tooltip="Intervalo de tempo (em segundos) entre as amostragens de CPU e memória."
            >
                Time interval
            </NumericInput>
            <div className="flex justify-around flex-wrap gap-1 mt-2">
                <SwitchInput 
                    SwitchName="overwriteSystemMonitoring"
                    checked={overwriteSystemMonitoring}
                    onChange={(e) => updateField("overwriteSystemMonitoring", e.target.checked)}
                    isDisable={areDependentsDisabled}
                    tooltip="Substitui o arquivo de dados de monitoramento anterior se já existir no disco."
                >
                    Overwrite
                </SwitchInput>
            </div>
        </OptionsBoard>
    );
};

export default SystemMonitoringOptions;