import os
import re

def fix_chartboard_parsers():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # The user wants to:
    # 1. Use refs for currentRunId and runStartUs (already done).
    # 2. Add validation before JSON.parse.
    # 3. Only accept type === "TELEMETRY".
    # 4. For STATUS messages, only process if runId matches or runId is explicitly handled.
    # 5. Open WebSockets only once per run.
    
    # "No frontend: abrir cada WebSocket somente uma vez por execução; não recriar WebSockets a cada renderização..."
    # "Não incluir currentRunId e runStartUs diretamente como dependências que causem reconexão contínua" -> already removed from dependencies in previous step!

    # Let's fix the onmessage parser:
    
    # Match the entire block of `cpuConn.onmessage = (event) => { ... }` up to the end of the block.
    # It's much safer to replace `const message = JSON.parse(event.data);` 
    # and the subsequent `if (message.type === "STATUS")` logic.

    # 1. Remove `const message = JSON.parse(event.data);`
    # Replace it with our robust parser.
    # We will inject the channel name by looking at the context.
    
    def replacer(match):
        channel = match.group(1)
        
        parser_code = f"""
                if (typeof event.data !== 'string') return;
                const raw = event.data.trim();
                if (!raw.startsWith('{{') && !raw.startsWith('[')) {{
                    console.warn('WS_MESSAGE_IGNORED reason=not-json', {{ channel: '{channel}', raw: raw.slice(0, 200) }});
                    return;
                }}
                let message;
                try {{
                    message = JSON.parse(raw);
                }} catch (error) {{
                    console.error('WS_JSON_PARSE_ERROR', {{ channel: '{channel}', raw: raw.slice(0, 500), error }});
                    return;
                }}
        """
        return f"{match.group(0)}\n{parser_code}"

    # Actually, let's just do:
    code = re.sub(r'(cpuConn\.onmessage\s*=\s*\(event\)\s*=>\s*\{)', lambda m: replacer(re.match(r'.*', '/cpu')), code)
    code = re.sub(r'(dataConn\.onmessage\s*=\s*\(event\)\s*=>\s*\{)', lambda m: replacer(re.match(r'.*', '/data')), code)
    code = re.sub(r'(memoryConn\.onmessage\s*=\s*\(event\)\s*=>\s*\{)', lambda m: replacer(re.match(r'.*', '/memory')), code)
    code = re.sub(r'(latencyConn\.onmessage\s*=\s*\(event\)\s*=>\s*\{)', lambda m: replacer(re.match(r'.*', '/latencia')), code)

    # Now remove `const message = JSON.parse(event.data);`
    code = code.replace('const message = JSON.parse(event.data);', '')
    
    # Fix STATUS runId check
    code = code.replace('if (message.type === "STATUS") {', 'if (message.type === "STATUS") {\nif (!message.runId) { console.log("STATUS_IGNORED reason=missing-runId"); return; }\nif (message.runId !== currentRunIdRef.current) return;')
    
    # Now for TELEMETRY
    # The previous code had `if (message && message.runId && message.timestampUs !== undefined)`
    # We need to change that to `if (message.type === "TELEMETRY")`
    
    code = code.replace('if (message && message.runId && message.timestampUs !== undefined)', 'if (message.type === "TELEMETRY")')

    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == "__main__":
    fix_chartboard_parsers()
