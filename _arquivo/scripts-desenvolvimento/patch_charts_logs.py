import os
import re

def full_replace_handlers():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Define the template for logging
    log_template = """
                if (message && message.runId && message.timestampUs !== undefined) {
                    let accepted = true;
                    let reason = "";
                    if (message.runId !== currentRunId) { accepted = false; reason = "stale-run"; }
                    else if (runStartUs === null) { accepted = false; reason = "no-run-start"; }
                    else if (!Number.isFinite(message.timestampUs)) { accepted = false; reason = "invalid-timestamp"; }
                    
                    const relativeSecs = accepted ? (message.timestampUs - (runStartUs || 0)) / 1000000 : -1;
                    if (accepted && relativeSecs < 0) { accepted = false; reason = "negative-relative-sec"; }
                    if (accepted && (visualStateRef.current === 'FAILED' || visualStateRef.current === 'COMPLETED')) { accepted = false; reason = "terminal-state"; }
                    
                    if (!accepted) {
                        console.log(`TELEMETRY_IGNORED reason=${reason} channel=__CHANNEL__`);
                    } else {
                        console.log(`TELEMETRY_ACCEPTED channel=__CHANNEL__`);
                        console.log(`CHANNEL=__CHANNEL__\\nrunId=${message.runId}\\ncurrentRunId=${currentRunId}\\ntimestampUs=${message.timestampUs}\\nrunStartUs=${runStartUs}\\nvalue=${message.value}\\naccepted=${accepted}\\nreason=${reason}`);
                        __ACTIVE_STATE__
                        __UPDATE_ARRAY__
                    }
                }
"""

    cpu_handler = log_template.replace('__CHANNEL__', '/cpu').replace(
        '__ACTIVE_STATE__', 'setCpuTelemetryState("ACTIVE");'
    ).replace(
        '__UPDATE_ARRAY__', 'setDataCPU((prev) => [...prev, { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value } as TelemetryPoint].slice(-MAX_POINTS));'
    )

    transfer_handler = log_template.replace('__CHANNEL__', '/data').replace(
        '__ACTIVE_STATE__', 'setDataTelemetryState("ACTIVE");'
    ).replace(
        '__UPDATE_ARRAY__', 'setDataTransfer((prev) => [...prev, { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value } as TelemetryPoint].slice(-MAX_POINTS));'
    )

    memory_handler = log_template.replace('__CHANNEL__', '/memory').replace(
        '__ACTIVE_STATE__', 'setMemoryTelemetryState("ACTIVE");'
    ).replace(
        '__UPDATE_ARRAY__', 'setDataMemory((prev) => { const next = [...prev]; if (next.length > 0) next[next.length - 1] = { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value }; return [...prev, { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value } as TelemetryPoint].slice(-MAX_POINTS); });'
    )

    latency_handler = log_template.replace('__CHANNEL__', '/latencia').replace(
        '__ACTIVE_STATE__', 'setLatencyTelemetryState("ACTIVE");'
    ).replace(
        '__UPDATE_ARRAY__', 'setDataScatter((prev) => { const aggregated = [...prev, { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value, type: message.type } as TelemetryPoint].slice(-MAX_POINTS); return aggregated as any; });'
    )

    # Replace existing handlers
    code = re.sub(
        r'if\s*\(\s*message\s*&&\s*message\.runId\s*&&\s*message\.timestampUs\s*!==\s*undefined\s*\)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}',
        lambda m: (
            cpu_handler if 'setCpuTelemetryState' in m.group(0) else
            transfer_handler if 'setDataTransfer' in m.group(0) else
            memory_handler if 'setDataMemory' in m.group(0) else
            latency_handler if 'setDataScatter' in m.group(0) else
            m.group(0)
        ),
        code
    )

    # Also log RUN_STARTED
    run_started_log = """
            if (evtName === "RUN_STARTED") {
                console.log(`RUN_STARTED_RECEIVED runId=${evtObj.runId} runStartUs=${evtObj.runStartUs}`);
                console.log("TELEMETRY_BUFFERS_CLEARED");
                setCurrentRunId(evtObj.runId || null);
"""
    code = code.replace(
        '            if (evtName === "RUN_STARTED") {\n                setCurrentRunId(evtObj.runId || null);',
        run_started_log
    )

    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == '__main__':
    full_replace_handlers()

