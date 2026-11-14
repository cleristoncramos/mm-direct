import os
import re

def fix_server_js():
    with open('server.js', 'r') as f:
        code = f.read()

    # Remove all ws.send("CLEAR")
    code = code.replace('ws.send("CLEAR");', '')

    # Ensure STATUS messages have runId. They already use `runId: currentRunId` but currentRunId might be null.
    # Actually they are fine as long as frontend ignores null runId.

    # Standardize data formats:
    # 1. /data
    code = code.replace(
        'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: contagemComandos[i].timestampUs, value: contagemComandos[i].count }));',
        'ws.send(JSON.stringify({ type: "TELEMETRY", channel: "data", runId: currentRunId, timestampUs: contagemComandos[i].timestampUs, value: contagemComandos[i].count }));'
    )
    code = code.replace(
        'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: contagemComandos[len - 1].timestampUs, value: contagemComandos[len - 1].count }));',
        'ws.send(JSON.stringify({ type: "TELEMETRY", channel: "data", runId: currentRunId, timestampUs: contagemComandos[len - 1].timestampUs, value: contagemComandos[len - 1].count }));'
    )

    # 2. /cpu
    code = code.replace(
        'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: timeUs, value: cpuVal }));',
        'ws.send(JSON.stringify({ type: "TELEMETRY", channel: "cpu", runId: currentRunId, timestampUs: timeUs, value: cpuVal }));'
    )

    # 3. /memory
    code = code.replace(
        'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: timeUs, value: memVal }));',
        'ws.send(JSON.stringify({ type: "TELEMETRY", channel: "memory", runId: currentRunId, timestampUs: timeUs, value: memVal }));'
    )

    # 4. /latencia
    code = code.replace(
        'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: startUs, type: "N", value: latVal }));',
        'ws.send(JSON.stringify({ type: "TELEMETRY", channel: "latencia", runId: currentRunId, timestampUs: startUs, value: latVal, metricType: "N" }));'
    )
    code = code.replace(
        'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: startUs, type: "A", value: latVal }));',
        'ws.send(JSON.stringify({ type: "TELEMETRY", channel: "latencia", runId: currentRunId, timestampUs: startUs, value: latVal, metricType: "A" }));'
    )

    with open('server.js', 'w') as f:
        f.write(code)

def fix_chartboard():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # The parser block should be:
    parser_code = """
                if (typeof event.data !== 'string') return;
                const raw = event.data.trim();
                if (!raw.startsWith('{') && !raw.startsWith('[')) {
                    console.warn('WS_MESSAGE_IGNORED reason=not-json', { channel: '__CHANNEL__', raw: raw.slice(0, 200) });
                    return;
                }
                let message;
                try {
                    message = JSON.parse(raw);
                } catch (error) {
                    console.error('WS_JSON_PARSE_ERROR', { channel: '__CHANNEL__', raw: raw.slice(0, 500), error });
                    return;
                }
    """

    # We need to replace the old `const message = JSON.parse(data);` or `const message = JSON.parse(event.data);`
    # Let's see how it was written in ChartBoard.tsx:
    # `const message = JSON.parse(event.data);`
    code = code.replace('const message = JSON.parse(event.data);', parser_code.replace('__CHANNEL__', '/unknown'))
    
    # We should fix the channel names for the parse block
    # But wait, it's inside `cpuConn.onmessage = (event) => { ... }`
    # Let's use a regex to match and inject channel name.
    
    code = re.sub(
        r'const raw = event\.data\.trim\(\);\s*if \(\!raw\.startsWith[^{]+return;\s*\}\s*let message;\s*try\s*\{\s*message = JSON\.parse\(raw\);\s*\}\s*catch\s*\(error\)\s*\{\s*console\.error\([^}]+\}\s*return;\s*\}',
        '', code
    ) # Clean up if I ran this multiple times or messed up.
    
    # Let's do a precise replace for the WS JSON parse:
    
    # Actually, I'll just rewrite the onmessage handlers completely.
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == "__main__":
    fix_server_js()
    fix_chartboard()

