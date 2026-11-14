import OptionsBoard from "./OptionsBoard";
import { TextInput, SwitchInput, NumericInput } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

const IndexerOptions = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const { 
        instantRecoveryState, 
        instantRecoverySynchronous, 
        aofFilename, 
        indexedlogFilename, 
        indexerTimeInterval, 
        updateField 
    } = useExperimentStore();

    const hasErrors = !!(errors.aofFilename || errors.indexedlogFilename || errors.indexerTimeInterval);

    return (
        <OptionsBoard BoardHeader="Indexer" hasErrors={hasErrors} isDisabled={isDisabled}>
            <div className="flex justify-around flex-wrap gap-2 mb-2">
                <SwitchInput 
                    SwitchName="instantRecoveryState" 
                    checked={instantRecoveryState}
                    onChange={(e) => updateField("instantRecoveryState", e.target.checked)}
                    isDisable={isDisabled}
                    tooltip="Habilita a Recuperação Instantânea via MM-DIRECT (B-Tree). Quando desligado, utiliza a recuperação tradicional por log sequencial (AOF)."
                >
                    Instant Recovery
                </SwitchInput>
                <SwitchInput 
                    SwitchName="instantRecoverySynchronous"
                    checked={instantRecoverySynchronous}
                    onChange={(e) => updateField("instantRecoverySynchronous", e.target.checked)}
                    isDisable={isDisabled}
                    tooltip="Habilita a indexação síncrona dos registros de log (cada transação aguarda a indexação antes de prosseguir)."
                >
                    Synchronous
                </SwitchInput>
            </div>
            <TextInput
                TextName="aofFilename"
                TextPlaceholder="logs/sequentialLog.aof"
                value={aofFilename}
                onChange={(e) => updateField("aofFilename", e.target.value)}
                isDisable={isDisabled}
                hasError={!!errors.aofFilename}
                errorMessage={errors.aofFilename}
                tooltip="Caminho e nome do arquivo de log sequencial AOF (Append Only File)."
            >
                AOF filename
            </TextInput>
            <TextInput
                TextName="indexedlogFilename"
                TextPlaceholder="logs/indexedLog.db"
                value={indexedlogFilename}
                onChange={(e) => updateField("indexedlogFilename", e.target.value)}
                isDisable={isDisabled}
                hasError={!!errors.indexedlogFilename}
                errorMessage={errors.indexedlogFilename}
                tooltip="Caminho e nome do arquivo de banco de dados do log indexado (B-Tree)."
            >
                Indexed log filename
            </TextInput>
            <NumericInput 
                NumericName="indexerTimeInterval"
                value={indexerTimeInterval}
                onChangeValue={(val) => updateField("indexerTimeInterval", val)}
                isDisable={isDisabled}
                hasError={!!errors.indexerTimeInterval}
                errorMessage={errors.indexerTimeInterval}
                unit="µs"
                tooltip="Intervalo de tempo (em microssegundos) para a execução do componente indexador de registros."
            >
                Time interval
            </NumericInput>
        </OptionsBoard>
    );
};

export default IndexerOptions;