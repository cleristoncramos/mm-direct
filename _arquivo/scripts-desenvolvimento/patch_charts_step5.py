import os
import re

def fix_handlers():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Cpu Handler
    code = re.sub(
        r'if \(Array\.isArray\(message\)\) \{.*?\} else \{[^\}]*\}\n\s*\}',
        r'''
                if (message.runId && message.timestampUs !== undefined && message.value !== undefined) {
                    if (message.runId !== currentRunId || runStartUs === null) return;
                    const relativeSecs = (message.timestampUs - runStartUs) / 1000000;
                    if (relativeSecs < 0) return;
                    if (visualStateRef.current !== 'FAILED' && visualStateRef.current !== 'COMPLETED') {
                        setCpuTelemetryState("ACTIVE");
                    } else if (visualStateRef.current === 'FAILED' || visualStateRef.current === 'COMPLETED') {
                        return; // Ignore points after termination
                    }
                    setDataCPU((prev) => [...prev, { runId: message.runId, timestampUs: message.timestampUs, relativeSeconds: relativeSecs, value: message.value } as TelemetryPoint].slice(-MAX_POINTS));
                }
        ''',
        code,
        count=1, flags=re.DOTALL
    )

    # We need to manually rewrite the entire websocket connect block because regex is fragile here.
    # Actually I will just replace the connect callbacks entirely.
    pass

def full_replace_handlers():
    # It's better to just write the new connect callbacks for the 4 handlers.
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Fix item[0] -> item.relativeSeconds in charts
    for chart_file in ['web/src/componentes/Charts/CpuChart.tsx', 'web/src/componentes/Charts/MemoryChart.tsx', 'web/src/componentes/Charts/ScatterChart.tsx', 'web/src/componentes/Charts/TransferChart.tsx']:
        with open(chart_file, 'r') as fc:
            ccode = fc.read()
        ccode = re.sub(r'a\[0\]\s*-\s*b\[0\]', 'a.relativeSeconds - b.relativeSeconds', ccode)
        ccode = re.sub(r'item\[2\]', 'item.value', ccode)
        ccode = re.sub(r'\(\[x,\s*y\]\)', '({ relativeSeconds: x, value: y })', ccode)
        ccode = re.sub(r'\[sortedData\.length - 1\]\[0\]', '[sortedData.length - 1].relativeSeconds', ccode)
        with open(chart_file, 'w') as fc:
            fc.write(ccode)

    # Now for ChartBoard array updates:
    code = re.sub(r'next\[next\.length - 1\] = \[message\[0\], media\] as \[number, number\];', r'next[next.length - 1] = { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: (message.timestampUs - (runStartUs || 0))/1000000, value: media };', code)
    code = re.sub(r'\[\.\.\.prev, \[message\[0\], message\[1\]\] as \[number, number\]\]', r'[...prev, { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: (message.timestampUs - (runStartUs || 0))/1000000, value: message.value } as TelemetryPoint]', code)
    code = re.sub(r'\[\.\.\.prev, \[message\[0\], usageMb\] as \[number, number\]\]', r'[...prev, { runId: currentRunId as string, timestampUs: message.timestampUs, relativeSeconds: (message.timestampUs - (runStartUs || 0))/1000000, value: usageMb } as TelemetryPoint]', code)
    code = re.sub(r'setDataScatter\(aggregated\);', r'setDataScatter(aggregated as any);', code) # Fix scatter temporarily
    code = re.sub(r'curr\[1\]', 'curr.value', code)

    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == '__main__':
    full_replace_handlers()

