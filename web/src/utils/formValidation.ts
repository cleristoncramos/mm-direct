export interface FormErrorState {
  [key: string]: string | undefined;
}

export function validateExperimentForm(store: any): FormErrorState {
  const errors: FormErrorState = {};

  // 1. Indexer Validation
  if (store.indexerTimeInterval < 0) {
    errors.indexerTimeInterval = "Interval cannot be negative";
  }
  if (!store.aofFilename || !store.aofFilename.trim()) {
    errors.aofFilename = "AOF file is required";
  }
  if (!store.indexedlogFilename || !store.indexedlogFilename.trim()) {
    errors.indexedlogFilename = "Indexed log file is required";
  }

  // 2. Checkpointer Validation
  if (store.checkpointState) {
    if (store.numberCheckpoints < 0) {
      errors.numberCheckpoints = "Quantity cannot be negative";
    }
    if (!store.selftuneCheckpointTimeInterval && (store.checkpointTimeInterval === undefined || store.checkpointTimeInterval <= 0)) {
      errors.checkpointTimeInterval = "Fixed interval must be greater than 0 s";
    }
  }

  // 3. Failure Simulation Validation
  if (store.restartDaleyTime === undefined || store.restartDaleyTime < 0) {
    errors.restartDaleyTime = "Delay cannot be negative";
  }

  if (store.enableRestartAfterTime) {
    if (store.restartAfterTime === undefined || store.restartAfterTime <= 0) {
      errors.restartAfterTime = "Failure time must be greater than 0 s";
    }
    if (store.numberRestartsAfterTime === undefined || store.numberRestartsAfterTime < 1) {
      errors.numberRestartsAfterTime = "At least 1 restart";
    }
  }

  if (store.enablePreloadDatabase) {
    // Com 0, preloadDatabaseAndRestart() no Redis-IR retorna sem agendar a falha:
    // o modo fica "ligado" no painel, mas nenhuma falha acontece.
    if (store.preloadDatabaseAndRestart === undefined || !Number.isFinite(store.preloadDatabaseAndRestart) || store.preloadDatabaseAndRestart <= 0) {
      errors.preloadDatabaseAndRestart = "Must be greater than 0 s (0 disables the failure)";
    }
    if (store.numberRestartsAfterPreloading === undefined || store.numberRestartsAfterPreloading < 1) {
      errors.numberRestartsAfterPreloading = "At least 1 restart";
    }
  }

  // 4. Memtier Benchmark Validation
  if (store.memtierBenchmarkState) {
    if (!store.memtierBenchmarkParameters || !store.memtierBenchmarkParameters.trim()) {
      errors.memtierBenchmarkParameters = "Benchmark parameters are required";
    }
    if (store.timeTostopBenchmarking === undefined || store.timeTostopBenchmarking < 0) {
      errors.timeTostopBenchmarking = "Stop time cannot be negative";
    }
  }

  // 5. Report Options Validation
  if (store.generateRecoveryReport && (!store.recoveryReportFilename || !store.recoveryReportFilename.trim())) {
    errors.recoveryReportFilename = "Recovery report path is required";
  }
  if (store.generateExecutedCommandsCsv && (!store.executedCommandsCsvFilename || !store.executedCommandsCsvFilename.trim())) {
    errors.executedCommandsCsvFilename = "Commands CSV path is required";
  }
  if (store.generateIndexingReportCsv && (!store.indexingReportCsvFilename || !store.indexingReportCsvFilename.trim())) {
    errors.indexingReportCsvFilename = "Indexing CSV path is required";
  }

  // 6. System Monitoring Validation
  if (store.systemMonitoring) {
    if (store.systemMonitoringTimeInterval === undefined || store.systemMonitoringTimeInterval <= 0) {
      errors.systemMonitoringTimeInterval = "Interval must be greater than 0 s";
    }
    if (!store.systemMonitoringCsvFilename || !store.systemMonitoringCsvFilename.trim()) {
      errors.systemMonitoringCsvFilename = "Monitoring CSV path is required";
    }
  }

  return errors;
}
