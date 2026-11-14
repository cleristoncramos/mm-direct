import os
import re

def rewrite_server_js():
    with open('server.js', 'r') as f:
        code = f.read()

    # 1. Update /data (throughput)
    # We want to send { runId, timestampUs, value }
    # Let's replace the contagemComandos logic to store timestampUs
    code = re.sub(
        r'contagemComandos\.push\(\[tempoEmSegundos, 1\]\);',
        r'contagemComandos.push({ sec: tempoEmSegundos, timestampUs: endTime, count: 1 });',
        code
    )
    code = re.sub(
        r'contagemComandos\[entryIndex\]\[1\]\+\+;',
        r'contagemComandos[entryIndex].count++;',
        code
    )
    code = re.sub(
        r'const entryIndex = contagemComandos\.findIndex\(e => e\[0\] === tempoEmSegundos\);',
        r'const entryIndex = contagemComandos.findIndex(e => e.sec === tempoEmSegundos);',
        code
    )
    code = re.sub(
        r'const sec = contagemComandos\[i\]\[0\];',
        r'const sec = contagemComandos[i].sec;',
        code
    )
    # We replaced ws.send in the previous step via tool, but let's just rewrite everything correctly
    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{ runId: currentRunId, payload: contagemComandos\[i\] \}\)\);',
        r'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: contagemComandos[i].timestampUs, value: contagemComandos[i].count }));',
        code
    )
    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{ runId: currentRunId, payload: contagemComandos\[len - 1\] \}\)\);',
        r'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: contagemComandos[len - 1].timestampUs, value: contagemComandos[len - 1].count }));',
        code
    )

    # 2. Update /cpu
    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{ runId: currentRunId, payload: \[sec, cpuVal\] \}\)\);',
        r'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: timeUs, value: cpuVal }));',
        code
    )

    # 3. Update /memory
    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{ runId: currentRunId, payload: \[sec, memVal\] \}\)\);',
        r'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: timeUs, value: memVal }));',
        code
    )

    # 4. Update /latencia
    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{ runId: currentRunId, payload: \{ x1: \[sec, latVal\] \} \}\)\);',
        r'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: startUs, type: "N", value: latVal }));',
        code
    )
    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{ runId: currentRunId, payload: \{ x2: \[sec, latVal\] \} \}\)\);',
        r'ws.send(JSON.stringify({ runId: currentRunId, timestampUs: startUs, type: "A", value: latVal }));',
        code
    )

    with open('server.js', 'w') as f:
        f.write(code)


def rewrite_chart_board():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Create dashboardState and fix variables
    # This is highly specific and requires careful regex or parsing.
    pass

if __name__ == "__main__":
    rewrite_server_js()
    rewrite_chart_board()
