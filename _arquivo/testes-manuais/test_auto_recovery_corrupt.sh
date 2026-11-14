#!/bin/bash
cd src

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

echo "Corrupting indexedLog.db manually to simulate BDB bad file descriptor..."
dd if=/dev/urandom of=logs/indexedLog.db bs=1024 count=10 conv=notrunc

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
