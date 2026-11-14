import { create } from 'zustand';

export interface ExperimentState {
  // IndexerOptions
  instantRecoveryState: boolean;
  instantRecoverySynchronous: boolean;
  aofFilename: string;
  indexedlogFilename: string;
  indexerTimeInterval: number;

  // CheckpointerOptions
  checkpointState: boolean;
  checkpointsOnlyMfu: boolean;
  numberCheckpoints: number;
  checkpointTimeInterval: number;
  selftuneCheckpointTimeInterval: boolean;

  // FailureOptions
  restartDaleyTime: number;
  enableRestartAfterTime: boolean;
  restartAfterTime: number;
  numberRestartsAfterTime: number;
  enablePreloadDatabase: boolean;
  preloadDatabaseAndRestart: number;
  numberRestartsAfterPreloading: number;

  // MemtierOptions
  memtierBenchmarkState: boolean;
  memtierBenchmarkParameters: string;
  timeTostopBenchmarking: number;

  // ReportOptions
  generateRecoveryReport: boolean;
  recoveryReportFilename: string;
  generateExecutedCommandsCsv: boolean;
  executedCommandsCsvFilename: string;
  generateIndexingReportCsv: boolean;
  indexingReportCsvFilename: string;
  overwriteReportFiles: boolean;

  // SystemMonitoringOptions
  systemMonitoring: boolean;
  stopSystemMonitoringEndBenchmark: boolean;
  systemMonitoringCsvFilename: string;
  systemMonitoringTimeInterval: number;
  overwriteSystemMonitoring: boolean;
}

interface ExperimentStore extends ExperimentState {
  updateField: (field: keyof ExperimentState, value: any) => void;
  reset: () => void;
}

export const defaultState: ExperimentState = {
  instantRecoveryState: true,
  instantRecoverySynchronous: false,
  aofFilename: "logs/sequentialLog.aof",
  indexedlogFilename: "logs/indexedLog.db",
  indexerTimeInterval: 0,

  checkpointState: false,
  checkpointsOnlyMfu: false,
  numberCheckpoints: 10,
  checkpointTimeInterval: 60,
  selftuneCheckpointTimeInterval: true,

  restartDaleyTime: 1,
  enableRestartAfterTime: true,
  restartAfterTime: 30,
  numberRestartsAfterTime: 1,
  enablePreloadDatabase: false,
  preloadDatabaseAndRestart: 30,
  numberRestartsAfterPreloading: 1,

  memtierBenchmarkState: true,
  memtierBenchmarkParameters: " --hide-histogram -n 5000 --key-prefix='redisIR-' --key-minimum=1 --key-maximum=5000 --command='set  __key__ __data__' --command-ratio=5000 --command-key-pattern=S",
  timeTostopBenchmarking: 0,

  generateRecoveryReport: true,
  recoveryReportFilename: "recovery_report/recovery_report.txt",
  generateExecutedCommandsCsv: true,
  executedCommandsCsvFilename: "datasets/datasets.csv",
  generateIndexingReportCsv: true,
  indexingReportCsvFilename: "indexing_report/indexing.csv",
  overwriteReportFiles: false,

  systemMonitoring: true,
  stopSystemMonitoringEndBenchmark: false,
  systemMonitoringCsvFilename: "system_monitoring/system_monitoring.csv",
  systemMonitoringTimeInterval: 1,
  overwriteSystemMonitoring: false,
};

export const useExperimentStore = create<ExperimentStore>((set) => ({
  ...defaultState,
  updateField: (field, value) => set((state) => ({ ...state, [field]: value })),
  reset: () => set(defaultState),
}));
