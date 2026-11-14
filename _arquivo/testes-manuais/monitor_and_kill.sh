#!/bin/bash
echo "Monitoring for RECOVERY_STARTED..."
while true; do
    if grep -q "RECOVERY_STARTED" src/logs/server.log 2>/dev/null; then
        echo "Found RECOVERY_STARTED! Killing redis-server..."
        killall -9 redis-server
        break
    fi
    sleep 0.1
done
echo "Done."
