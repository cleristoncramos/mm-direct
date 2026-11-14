#!/bin/bash
LATEST_RUN=$(find src/runs -maxdepth 1 -type d -name "run_*" | sort | tail -n 1)
LOGFILE="$LATEST_RUN/server.log"
echo "Monitoring $LOGFILE for RECOVERY_STARTED..."
while true; do
    if [ -f "$LOGFILE" ]; then
        if grep -q "RECOVERY_STARTED" "$LOGFILE"; then
            echo "Found RECOVERY_STARTED! Killing redis-server..."
            killall -9 redis-server
            break
        fi
    fi
    sleep 0.1
done
echo "Done."
