import OptionsBoard from "./OptionsBoard";
import { TextInput, SwitchInput, NumericInput } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

const MemtierOptions = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const { 
        memtierBenchmarkState, 
        memtierBenchmarkParameters, 
        timeTostopBenchmarking, 
        updateField 
    } = useExperimentStore();

    const hasErrors = !!(errors.memtierBenchmarkParameters || errors.timeTostopBenchmarking);
    const areDependentsDisabled = isDisabled || !memtierBenchmarkState;

    return (
        <OptionsBoard BoardHeader="Memtier Benchmark" hasErrors={hasErrors} isDisabled={isDisabled}>
            <div className="flex justify-around flex-wrap gap-2 mb-2">
                <SwitchInput 
                    SwitchName="memtierBenchmarkState"
                    checked={memtierBenchmarkState}
                    onChange={(e) => updateField("memtierBenchmarkState", e.target.checked)}
                    isDisable={isDisabled}
                    tooltip="Habilita a execução automática do gerador de carga de trabalho Memtier Benchmark ao inicializar o banco."
                >
                    Memtier Benchmark
                </SwitchInput>
            </div>
            <TextInput
                TextName="memtierBenchmarkParameters"
                TextPlaceholder="--hide-histogram -n 5000 ..."
                value={memtierBenchmarkParameters}
                onChange={(e) => updateField("memtierBenchmarkParameters", e.target.value)}
                isDisable={areDependentsDisabled}
                hasError={!!errors.memtierBenchmarkParameters}
                errorMessage={errors.memtierBenchmarkParameters}
                tooltip="Parâmetros de comando do Memtier Benchmark (nº de conexões, threads, proporção SET/GET e padrão de chaves)."
            >
                Parameters
            </TextInput>
            <NumericInput 
                NumericName="timeTostopBenchmarking"
                value={timeTostopBenchmarking}
                onChangeValue={(val) => updateField("timeTostopBenchmarking", val)}
                isDisable={areDependentsDisabled}
                hasError={!!errors.timeTostopBenchmarking}
                errorMessage={errors.timeTostopBenchmarking}
                unit="s"
                tooltip="Parada forçada do gerador de carga após o tempo definido (em segundos) a partir da inicialização."
            >
                Time to stop
            </NumericInput>
        </OptionsBoard>
    );
};

export default MemtierOptions;