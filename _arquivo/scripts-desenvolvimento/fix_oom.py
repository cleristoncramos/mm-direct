import os
import re

def fix_oom():
    with open('server.js', 'r') as f:
        code = f.read()

    # To avoid OOM, let's limit the lines read. But since rewriting the whole logic to Streams is too risky,
    # let's just make it only read if the file is small or if it changed, and keep track of position.
    # Actually, a simple `tail` approach or just reading the last 1000 lines if the file is huge.
    
    # Or, the user said:
    # "- remover `--max-old-space-size=8192`" in package.json
    with open('package.json', 'r') as f:
        pkg = f.read()
    pkg = pkg.replace('node --max-old-space-size=8192 server.js', 'node server.js')
    with open('package.json', 'w') as f:
        f.write(pkg)

    # "- reduzir buffers ilimitados;"
    # "- não acumular logs completos em memória;"
    # "- não duplicar listeners a cada execução;"
    # "- finalizar WebSockets antigos;"
    # "- limitar o número de clientes por canal."

    # Let's fix the `currentRunLogs` accumulation.
    code = code.replace(
        'currentRunLogs.push(line);',
        'currentRunLogs.push(line); if (currentRunLogs.length > 500) currentRunLogs.shift();'
    )
    
    # Let's limit the `arrayParaVerificarSeJaFoiEnviado` length.
    code = code.replace(
        'arrayParaVerificarSeJaFoiEnviado.push(sec);',
        'arrayParaVerificarSeJaFoiEnviado.push(sec); if (arrayParaVerificarSeJaFoiEnviado.length > 500) arrayParaVerificarSeJaFoiEnviado.shift();'
    )

    # Let's limit the `sentSeconds` and `sentIndices`.
    # sentIndices is a Set, we can clear it if it gets too large.
    # But wait, if we clear it, we resend!
    # Instead, we just stop reading the whole file if we can.
    
    # In `/latencia` and `/data`, `fs.readFileSync(inputPath, 'utf8')` reads the whole CSV.
    # We can limit the lines processed.
    # `const lines = readCompleteLines(fileContent);`
    code = code.replace(
        "const lines = readCompleteLines(fileContent);",
        "const lines = readCompleteLines(fileContent).slice(-5000); // Prevent OOM by processing only the last 5000 lines"
    )
    
    # For latency, it uses `sentIndices = new Set()`. Since we only process the last 5000 lines, the indices will change if we slice!
    # Ah! `lines` won't map to absolute indices anymore.
    # So `sentIndices.has(i)` will be wrong. Let's change `sentIndices` to store `startUs` instead.
    code = code.replace(
        "sentIndices.has(i)",
        "sentIndices.has(startUs)"
    )
    code = code.replace(
        "sentIndices.add(i);",
        "sentIndices.add(startUs); if (sentIndices.size > 5000) { const iter = sentIndices.values(); sentIndices.delete(iter.next().value); }"
    )

    # Let's fix CPU and Memory limits:
    code = code.replace(
        "sentSeconds.has(sec)",
        "sentSeconds.has(sec)"
    )
    code = code.replace(
        "sentSeconds.add(sec);",
        "sentSeconds.add(sec); if (sentSeconds.size > 1000) { const iter = sentSeconds.values(); sentSeconds.delete(iter.next().value); }"
    )

    # Now, let's limit clients per channel to 1! If a new connection comes, close the old one.
    # "finalizar WebSockets antigos; limitar o número de clientes por canal."
    # We can do this at the start of `/data`, `/cpu`, etc.
    # The simplest way is to keep a global map of active connections per channel.
    
    with open('server.js', 'w') as f:
        f.write(code)

if __name__ == '__main__':
    fix_oom()
