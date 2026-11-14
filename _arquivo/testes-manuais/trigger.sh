#!/bin/bash
cat << 'EOF' > payload.json
{
  "instantRecoveryState": "ON",
  "instantRecoverySynchronous": "OFF",
  "aofFilename": "logs/sequentialLog.aof",
  "indexedlogFilename": "logs/indexedLog.db",
  "indexerTimeInterval": "0",
  "checkpointState": "OFF",
  "checkpointsOnlyMfu": "OFF",
  "numberCheckpoints": "10",
  "checkpointTimeInterval": "60",
  "selftuneCheckpointTimeInterval": "ON",
  "restartDaleyTime": "1",
  "enableRestartAfterTime": "OFF",
  "restartAfterTime": "0",
  "numberRestartsAfterTime": "0",
  "enablePreloadDatabase": "ON",
  "preloadDatabaseAndRestart": "10",
  "numberRestartsAfterPreloading": "1",
  "memtierBenchmarkState": "ON",
  "memtierBenchmarkParameters": " --hide-histogram -n 5000 --key-prefix='redisIR-' --key-minimum=1 --key-maximum=5000 --command='set  __key__ __data__' --command-ratio=5000 --command-key-pattern=S",
  "timeTostopBenchmarking": "0",
  "generateRecoveryReport": "ON",
  "recoveryReportFilename": "recovery_report/recovery_report.txt",
  "generateExecutedCommandsCsv": "ON",
  "executedCommandsCsvFilename": "datasets/datasets.csv",
  "generateIndexingReportCsv": "ON",
  "indexingReportCsvFilename": "indexing_report/indexing.csv",
  "overwriteReportFiles": "ON",
  "systemMonitoring": "ON",
  "stopSystemMonitoringEndBenchmark": "OFF",
  "systemMonitoringCsvFilename": "system_monitoring/system_monitoring.csv",
  "systemMonitoringTimeInterval": "1",
  "overwriteSystemMonitoring": "ON"
}
EOF

curl -X POST -H "Content-Type: application/json" -d @payload.json http://localhost:8081/config
echo "Config sent"
curl -s http://localhost:8081/start &
echo "Start sent"
