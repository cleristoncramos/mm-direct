#!/bin/bash
cd src

export instantRecoveryState="ON"
export instantRecoverySynchronous="OFF"
export aofFilename="logs/sequentialLog.aof"
export indexedlogFilename="logs/indexedLog.db"
export indexerTimeInterval="0"
export checkpointState="OFF"
export checkpointsOnlyMfu="OFF"
export numberCheckpoints="10"
export checkpointTimeInterval="60"
export selftuneCheckpointTimeInterval="ON"
export restartDaleyTime="1"
export enableRestartAfterTime="OFF"
export restartAfterTime="0"
export numberRestartsAfterTime="0"
export enablePreloadDatabase="ON"
export preloadDatabaseAndRestart="10"
export numberRestartsAfterPreloading="1"
export memtierBenchmarkState="ON"
export memtierBenchmarkParameters=" --hide-histogram -n 5000 --key-prefix='redisIR-' --key-minimum=1 --key-maximum=5000 --command='set  __key__ __data__' --command-ratio=5000 --command-key-pattern=S"
export timeTostopBenchmarking="0"

# Start redis-server and redirect output
./redis-server > test.log 2>&1 &
PID=$!

echo "Waiting for RECOVERY_STARTED..."
while true; do
    if grep -q "RECOVERY_STARTED" test.log 2>/dev/null; then
        echo "Found RECOVERY_STARTED! Killing redis-server (PID $PID)..."
        kill -9 $PID
        break
    fi
    sleep 0.1
done

echo "Wait for process to die..."
sleep 2

echo "Starting again to test auto-recovery..."
./redis-server > test2.log 2>&1 &
PID=$!

echo "Waiting for RECOVERY_COMPLETED or EXPERIMENT_COMPLETED..."
while true; do
    if grep -q "RECOVERY_COMPLETED\|EXPERIMENT_COMPLETED" test2.log 2>/dev/null; then
        echo "Recovery completed! Killing redis-server..."
        kill -9 $PID
        break
    fi
    sleep 0.5
done

echo "Done testing auto-recovery!"
