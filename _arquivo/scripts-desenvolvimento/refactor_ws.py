import os
import re

def refactor():
    with open('server.js', 'r') as f:
        code = f.read()

    # 1. We replace the WebSocketServer initialization
    ws_init_old = r"const wss = new WebSocketServer\(\{ server \}, \(\) => \{[\s\S]*?\}\);"
    ws_init_new = """const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

const CHANNELS = ['/control', '/data', '/cpu', '/memory', '/latencia'];
const clientsByChannel = new Map(CHANNELS.map(c => [c, new Set()]));

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!CHANNELS.includes(pathname)) {
    console.warn('WS_CONNECTION_REJECTED', pathname);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clientsByChannel.get(pathname).add(ws);
    console.log('WS_CONNECTION_ACCEPTED', pathname, 'total=', clientsByChannel.get(pathname).size);
    ws.on('close', () => clientsByChannel.get(pathname).delete(ws));
    ws.on('error', () => clientsByChannel.get(pathname).delete(ws));
  });
});

function broadcast(channel, payload) {
  const set = clientsByChannel.get('/' + channel) ?? clientsByChannel.get(channel);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}
"""
    code = re.sub(ws_init_old, ws_init_new, code)

    # 2. Extract wss.on('connection') and replace it with background loops
    # Actually, if I just replace `ws.send` with `broadcast` and keep the loops global, it works.
    
    # In `server.js`, find where `const telemetryCounters = ...` starts
    
    # We will remove `wss.on('connection', async (ws, req) => { ... })` completely
    # and instead write global intervals!
    
    # The file has:
    # ```
    # wss.on('connection', async (ws, req) => {
    #   if (req.url === '/data') { ... }
    #   else if (req.url === '/cpu') { ... }
    #   ...
    # });
    # ```
    
    # We can replace the whole `wss.on('connection', ...);` block with global collectors.
    # To do this safely, I will regex out `wss.on('connection'` block.
    # Wait, the `server.js` file is too long and complex to regex perfectly.
    
    # Instead, let's just use `tail -n 1000` inside the existing `server.js` loops and replace `ws.send` with `broadcast`.
    # AND, change `wss.on('connection')` to simply start the intervals if they are not started?
    # NO! If we do `broadcast`, the loops should just run globally in the background, continuously!
    
    background_collectors = """
// --- Background Collectors ---
let dataInterval, cpuInterval, memInterval, latInterval;

const sentDataIndices = new Set();
const sentCpuSeconds = new Set();
const sentMemSeconds = new Set();
const sentLatIndices = new Set();

function startCollectors() {
  const { execSync } = require('child_process');

  // DATA
  setInterval(() => {
    if (!fs.existsSync(inputPath)) return;
    try {
      const output = execSync(`tail -n 1000 ${inputPath}`).toString('utf8');
      const lines = output.split('\\n');
      lines.forEach((line) => {
        const parts = line.split(',');
        if (parts.length >= 6) {
          const typeStr = parts[5];
          if (typeStr === 'T') {
            const timeUs = parseInt(parts[2], 10) || parseInt(parts[3], 10);
            const val = parseFloat(parts[4]);
            if (!isNaN(timeUs) && !isNaN(val) && !sentDataIndices.has(timeUs)) {
              sentDataIndices.add(timeUs);
              if (sentDataIndices.size > 2000) sentDataIndices.delete(sentDataIndices.values().next().value);
              broadcast('data', { type: "TELEMETRY", channel: "data", runId: currentRunId, timestampUs: timeUs, value: val });
            }
          }
        }
      });
    } catch (e) {}
  }, 500);

  // CPU
  setInterval(() => {
    if (!fs.existsSync(pathCpu)) return;
    try {
      const output = execSync(`tail -n 1000 ${pathCpu}`).toString('utf8');
      const lines = output.split('\\n');
      lines.forEach((line) => {
        const parts = line.split(';');
        if (parts.length >= 3 && parts[0].match(/^\\d+$/)) {
          const timeUs = parseInt(parts[0], 10);
          const val = parseFloat(parts[1]);
          if (!isNaN(timeUs) && !isNaN(val) && !sentCpuSeconds.has(timeUs)) {
            sentCpuSeconds.add(timeUs);
            if (sentCpuSeconds.size > 2000) sentCpuSeconds.delete(sentCpuSeconds.values().next().value);
            broadcast('cpu', { type: "TELEMETRY", channel: "cpu", runId: currentRunId, timestampUs: timeUs, value: val });
          }
        }
      });
    } catch (e) {}
  }, 500);

  // MEMORY
  setInterval(() => {
    if (!fs.existsSync(pathCpu)) return;
    try {
      const output = execSync(`tail -n 1000 ${pathCpu}`).toString('utf8');
      const lines = output.split('\\n');
      lines.forEach((line) => {
        const parts = line.split(';');
        if (parts.length >= 3 && parts[0].match(/^\\d+$/)) {
          const timeUs = parseInt(parts[0], 10);
          const val = parseFloat(parts[2]);
          if (!isNaN(timeUs) && !isNaN(val) && !sentMemSeconds.has(timeUs)) {
            sentMemSeconds.add(timeUs);
            if (sentMemSeconds.size > 2000) sentMemSeconds.delete(sentMemSeconds.values().next().value);
            broadcast('memory', { type: "TELEMETRY", channel: "memory", runId: currentRunId, timestampUs: timeUs, value: val });
          }
        }
      });
    } catch (e) {}
  }, 500);

  // LATENCIA
  setInterval(() => {
    if (!fs.existsSync(inputPath)) return;
    try {
      const output = execSync(`tail -n 1000 ${inputPath}`).toString('utf8');
      const lines = output.split('\\n');
      lines.forEach((line) => {
        const parts = line.split(',');
        if (parts.length >= 6) {
          const typeStr = parts[5];
          if (typeStr === 'N' || typeStr === 'A') {
            const timeUs = parseInt(parts[2], 10) || parseInt(parts[3], 10);
            const val = parseFloat(parts[4]);
            if (!isNaN(timeUs) && !isNaN(val) && !sentLatIndices.has(timeUs)) {
              sentLatIndices.add(timeUs);
              if (sentLatIndices.size > 2000) sentLatIndices.delete(sentLatIndices.values().next().value);
              broadcast('latencia', { type: "TELEMETRY", channel: "latencia", runId: currentRunId, timestampUs: timeUs, value: val, metricType: typeStr });
            }
          }
        }
      });
    } catch (e) {}
  }, 500);
}

startCollectors();
"""
    
    # We remove `wss.on('connection', ...)` block and insert our background collectors
    # Let's find the wss.on connection block bounds
    start_idx = code.find("wss.on('connection', async (ws, req) => {")
    if start_idx == -1:
        print("Error: Could not find wss.on")
        return
        
    # Find matching brace
    brace_count = 0
    end_idx = -1
    for i in range(start_idx, len(code)):
        if code[i] == '{':
            brace_count += 1
        elif code[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                end_idx = i + 1
                break
                
    if end_idx == -1:
        print("Error: Could not find end of wss.on")
        return
        
    # Replace it!
    new_code = code[:start_idx] + background_collectors + code[end_idx:]
    
    # Write back
    with open('server.js', 'w') as f:
        f.write(new_code)
    
    # Also, remove `--max-old-space-size=8192` from package.json
    with open('package.json', 'r') as f:
        pkg = f.read()
    pkg = pkg.replace('node --max-old-space-size=8192 server.js', 'node server.js')
    with open('package.json', 'w') as f:
        f.write(pkg)
        
    # Also, find `ws.send(JSON.stringify(` and `sendTelemetry` in `server.js` that might still exist.
    # Actually, in `/start` HTTP endpoint or other places, it might use `broadcastToAllSockets`
    # Let's replace `broadcastToAllSockets` definition.
    # It looks like:
    # const broadcastToAllSockets = (message) => {
    #   wss.clients.forEach((client) => { ... client.send ... });
    # };
    def replace_broadcastToAll(m):
        return """const broadcastToAllSockets = (message) => {
  broadcast('control', message);
};"""
    new_code = re.sub(r"const broadcastToAllSockets = \(message\) => \{[\s\S]*?\};", replace_broadcastToAll, new_code)
    
    # And there might be some `sendTelemetry` usage remaining. We can just ignore it since it's not used.

    with open('server.js', 'w') as f:
        f.write(new_code)

if __name__ == '__main__':
    refactor()
