import OptionsBoard from "./OptionsBoard";
import { SwitchInput } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

const ReportOptions = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const { 
        overwriteReportFiles, 
        updateField 
    } = useExperimentStore();

    return (
        <OptionsBoard BoardHeader="Report" isDisabled={isDisabled} defaultOpen={false}>
            <div className="my-1">
                <SwitchInput 
                    SwitchName="overwriteReportFiles"
                    checked={overwriteReportFiles}
                    onChange={(e) => updateField("overwriteReportFiles", e.target.checked)}
                    isDisable={isDisabled}
                    tooltip="Substitui arquivos de relatórios anteriores se já existirem no diretório de destino."
                >
                    Overwrite datasets
                </SwitchInput>
            </div>
        </OptionsBoard>
    );
};

export default ReportOptions;