import os
import re

def instrument_server():
    with open('server.js', 'r') as f:
        code = f.read()

    # 1. Connection accepted logging
    code = code.replace(
        "console.log(`Client connected to WS route: ${req.url}`);",
        """console.log(`WS_CONNECTION_ACCEPTED path=${req.url} client=${req.socket.remoteAddress}`);
  if (!['/data', '/cpu', '/memory', '/latencia', '/control'].includes(req.url)) {
      console.log(`WS_CONNECTION_REJECTED path=${req.url} reason=unsupported-route`);
      ws.close();
      return;
  }"""
    )

    # We need to inject telemetry counters and WS_FIRST_PACKET logs into each WS handler.
    # A helper function to replace the ws.send for TELEMETRY
    def replace_telemetry(channel):
        target = f'ws.send(JSON.stringify({{ type: "TELEMETRY", channel: "{channel}"'
        replacement = f"""
            const payload = {{ type: "TELEMETRY", channel: "{channel}"
        """
        # We need to find every occurrence and replace it. It's safer to just regex replace the specific sends.
        pass

    # Let's do it simply using regex matching the ws.send(JSON.stringify({ type: "TELEMETRY", channel: "..." }))
    
    # Actually, we can just replace:
    # `ws.send(JSON.stringify({ type: "TELEMETRY", channel: "cpu", runId: currentRunId, timestampUs: timeUs, value: cpuVal }));`
    # with a wrapper function.
    
    wrapper = """
// --- Telemetry Instrumentation ---
const telemetryCounters = { data: 0, cpu: 0, memory: 0, latencia: 0 };
const firstPacketSent = { data: false, cpu: false, memory: false, latencia: false };

function sendTelemetry(ws, payload) {
    if (ws.readyState !== 1) return;
    const channel = payload.channel;
    if (!firstPacketSent[channel]) {
        console.log(`WS_FIRST_PACKET channel=${channel} payload=${JSON.stringify(payload)}`);
        firstPacketSent[channel] = true;
    }
    telemetryCounters[channel] = (telemetryCounters[channel] || 0) + 1;
    if (telemetryCounters[channel] % 100 === 0) {
        console.log(`WS_SENT channel=${channel} count=${telemetryCounters[channel]}`);
    }
    ws.send(JSON.stringify(payload));
}
// ----------------------------------
"""
    
    if "sendTelemetry(ws, payload)" not in code:
        code = code.replace("const wss = new WebSocketServer({ server }, () => {", wrapper + "\nconst wss = new WebSocketServer({ server }, () => {")

    code = re.sub(
        r'ws\.send\(JSON\.stringify\(\{\s*type:\s*"TELEMETRY"([^}]+)\}\)\);',
        r'sendTelemetry(ws, { type: "TELEMETRY"\1 });',
        code
    )

    with open('server.js', 'w') as f:
        f.write(code)


def fix_chartboard():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # The user wants to change the badge to only show "Telemetria ativa" after the first packet.
    # Currently, it might be showing it unconditionally or when socket connects.
    # Let's replace the set...TelemetryState logic.
    # In my previous script, I put:
    # setCpuTelemetryState("ACTIVE");
    # Let's change it to only set to "ACTIVE" when `message.type === "TELEMETRY"`! Oh, it already is because it's inside the TELEMETRY block.
    # Wait, the user said: "alterar o badge para “Telemetria ativa” somente após o primeiro pacote aceito; mostrar “Sem dados” quando o socket estiver conectado, mas nenhum pacote tiver chegado;"
    # I'll create a script to refine ChartBoard.tsx.
    pass

if __name__ == '__main__':
    instrument_server()
