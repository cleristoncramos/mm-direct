import { NumericInput, SwitchInput, TooltipBadge } from "./InputTypes";
import { useExperimentStore } from "../../store/experimentStore";

type Technique = "IRAIL" | "IRSIL" | "SRSL";

const TECHNIQUES: { key: Technique; label: string; tip: string }[] = [
    { key: "IRAIL", label: "Instant", tip: "IRAIL — recuperação instantânea do MM-DIRECT: log indexado gravado de forma assíncrona; o banco aceita transações durante a recuperação." },
    { key: "IRSIL", label: "Instant (sync)", tip: "IRSIL — recuperação instantânea com inserção síncrona no log indexado: cada transação espera a gravação no log indexado (mede o custo da indexação síncrona)." },
    { key: "SRSL", label: "Standard", tip: "SRSL — recuperação padrão: o banco só volta a aceitar transações depois de reexecutar todo o log sequencial (AOF). Throughput zero durante a recuperação." },
];

interface SectionProps {
    errors?: Record<string, string | undefined>;
    isDisabled?: boolean;
}

/**
 * Bloco principal do setup (Fase 4 do plano, reunião de 10/11/2026): as quatro escolhas que
 * definem um experimento — preload, checkpoint, falha após N segundos e número de falhas.
 * Os demais parâmetros continuam nas seções de "Advanced settings", logo abaixo.
 *
 * Os campos daqui escrevem nos mesmos valores das seções avançadas (Failure simulation e
 * Checkpointer): falha por tempo por padrão, ou o modo por preload, se ele estiver ligado lá.
 */
const ExperimentEssentials = ({ errors = {}, isDisabled = false }: SectionProps) => {
    const {
        enableRestartAfterTime,
        restartAfterTime,
        numberRestartsAfterTime,
        enablePreloadDatabase,
        preloadDatabaseAndRestart,
        numberRestartsAfterPreloading,
        checkpointState,
        checkpointTimeInterval,
        selftuneCheckpointTimeInterval,
        instantRecoveryState,
        instantRecoverySynchronous,
        updateField,
    } = useExperimentStore();

    // Técnica de recuperação, com os nomes dos cenários da tese (Araújo, 2022, Seção 5.1)
    const technique: Technique = !instantRecoveryState ? "SRSL" : instantRecoverySynchronous ? "IRSIL" : "IRAIL";
    const setTechnique = (t: Technique) => {
        updateField("instantRecoveryState", t !== "SRSL");
        updateField("instantRecoverySynchronous", t === "IRSIL");
    };

    const failureOn = enableRestartAfterTime || enablePreloadDatabase;
    const preloadMode = enablePreloadDatabase;

    const failureAfter = preloadMode ? preloadDatabaseAndRestart : restartAfterTime;
    const failures = preloadMode ? numberRestartsAfterPreloading : numberRestartsAfterTime;
    const failureAfterKey = preloadMode ? "preloadDatabaseAndRestart" : "restartAfterTime";
    const failuresKey = preloadMode ? "numberRestartsAfterPreloading" : "numberRestartsAfterTime";

    const hasErrors = !!(errors[failureAfterKey] || errors[failuresKey] || errors.checkpointTimeInterval);

    return (
        <div className={`w-full mb-2 border border-slate-800 border-l-2 ${hasErrors ? "border-l-rose-500 border-rose-500/50" : "border-l-blue-500"} bg-slate-800/30`}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/60">
                <h3 className={`font-semibold text-xs uppercase tracking-wider ${hasErrors ? "text-rose-400" : "text-blue-400"}`}>
                    Experiment
                </h3>
                <TooltipBadge text="As escolhas principais do experimento. Os demais parâmetros ficam em Advanced settings, abaixo, e já vêm com valores padrão." />
            </div>

            <div className="px-3 py-2 space-y-1.5">
                {/* 0. Técnica de recuperação (para comparar as abordagens, como na Fig. 26 da tese) */}
                <div className="space-y-1">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                        Recovery technique
                        <TooltipBadge text="Rode o mesmo cenário com cada técnica e compare no histórico (Compare): as curvas ficam alinhadas no instante da falha." />
                    </span>
                    <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Recovery technique">
                        {TECHNIQUES.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                role="radio"
                                aria-checked={technique === t.key}
                                disabled={isDisabled}
                                onClick={() => setTechnique(t.key)}
                                title={t.tip}
                                className={`py-1 px-1 text-[9px] font-semibold rounded-none border leading-tight transition ${
                                    technique === t.key
                                        ? "bg-blue-900/60 border-blue-500 text-blue-200"
                                        : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                                } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {t.label}
                                <span className="block font-mono text-[8px] opacity-70">{t.key}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 1. Preload */}
                <div className="pt-1.5 border-t border-slate-800" />
                <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 flex items-center gap-1">
                        Preload
                        <TooltipBadge text="Antes da carga, o banco é carregado inteiro na memória a partir da base escolhida (log indexado na recuperação instantânea; log sequencial na padrão), para simular um banco que já estava em operação." />
                    </span>
                    <span className={`px-1.5 py-0.5 text-[9px] font-semibold border ${instantRecoveryState
                        ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-700"}`}>
                        {instantRecoveryState ? "Always on" : "Always on (sequential log)"}
                    </span>
                </div>

                {/* 2. Checkpoint */}
                <div className="pt-1.5 border-t border-slate-800">
                    <SwitchInput
                        SwitchName="essentialCheckpoint"
                        checked={checkpointState}
                        onChange={(e) => updateField("checkpointState", e.target.checked)}
                        isDisable={isDisabled}
                        tooltip="Liga o checkpoint (TuCC). O período de cada checkpoint aparece no gráfico. Tipo (completo ou MFU), quantidade e ajuste automático do intervalo ficam em Advanced settings › Checkpointer."
                    >
                        Checkpoint
                    </SwitchInput>
                    {checkpointState && (
                        selftuneCheckpointTimeInterval ? (
                            <div className="text-[10px] text-slate-500 mt-0.5">Self-tuned interval (change it in Advanced settings › Checkpointer).</div>
                        ) : (
                            <NumericInput
                                NumericName="essentialCheckpointInterval"
                                value={checkpointTimeInterval}
                                onChangeValue={(val) => updateField("checkpointTimeInterval", val)}
                                isDisable={isDisabled}
                                hasError={!!errors.checkpointTimeInterval}
                                errorMessage={errors.checkpointTimeInterval}
                                NumericMin={1}
                                unit="s"
                                tooltip="Intervalo entre o fim de um checkpoint e o início do próximo."
                            >
                                Checkpoint interval
                            </NumericInput>
                        )
                    )}
                </div>

                {/* 3 e 4. Falha simulada */}
                <div className="pt-1.5 border-t border-slate-800">
                    <SwitchInput
                        SwitchName="essentialFailure"
                        checked={failureOn}
                        onChange={(e) => {
                            const on = e.target.checked;
                            if (on) {
                                if (!enableRestartAfterTime && !enablePreloadDatabase) {
                                    updateField("enableRestartAfterTime", true);
                                    if (!(restartAfterTime > 0)) updateField("restartAfterTime", 30);
                                    if (!(numberRestartsAfterTime >= 1)) updateField("numberRestartsAfterTime", 1);
                                }
                            } else {
                                updateField("enableRestartAfterTime", false);
                                updateField("enablePreloadDatabase", false);
                            }
                        }}
                        isDisable={isDisabled}
                        tooltip="Desliga o Redis-IR depois do tempo definido, como uma queda do sistema. Após o reinício, a carga é submetida de novo enquanto a recuperação acontece. Desligado: o experimento roda sem falha."
                    >
                        Simulated failure
                    </SwitchInput>

                    {failureOn && (
                        <div className="mt-1 space-y-1">
                            <NumericInput
                                NumericName="essentialFailureAfter"
                                value={failureAfter}
                                onChangeValue={(val) => updateField(failureAfterKey, val)}
                                isDisable={isDisabled}
                                hasError={!!errors[failureAfterKey]}
                                errorMessage={errors[failureAfterKey]}
                                NumericMin={1}
                                unit="s"
                                tooltip={preloadMode
                                    ? "Tempo de operação depois do fim do preload até a falha (modo por preload, definido em Advanced settings)."
                                    : "Tempo de operação estável, contado a partir do fim do preload, até a falha. Nas falhas seguintes, conta a partir de cada reinício."}
                            >
                                Failure after
                            </NumericInput>
                            <NumericInput
                                NumericName="essentialFailures"
                                value={failures}
                                onChangeValue={(val) => updateField(failuresKey, val)}
                                isDisable={isDisabled}
                                hasError={!!errors[failuresKey]}
                                errorMessage={errors[failuresKey]}
                                NumericMin={1}
                                NumericMax={10}
                                unit="qty"
                                tooltip="Quantidade de falhas sucessivas. Cada falha é seguida de reinício, nova submissão da carga e recuperação."
                            >
                                Failures
                            </NumericInput>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExperimentEssentials;
