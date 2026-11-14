import os
import re

def restore_start():
    with open('server.js', 'r') as f:
        code = f.read()
    
    # 1. Add /start to CHANNELS
    code = code.replace(
        "const CHANNELS = ['/control', '/data', '/cpu', '/memory', '/latencia'];",
        "const CHANNELS = ['/control', '/data', '/cpu', '/memory', '/latencia', '/start'];"
    )

    # 2. Add specific connection handler for /start
    # In the current code, wss.handleUpgrade just adds to clientsByChannel.
    # For /start, we also need to trigger the experiment logic.
    # The clientsByChannel will work, and we can hook into wss.on('connection') or just inside the handleUpgrade.
    # Actually, we can just do:
    # wss.on('connection', (ws, req) => {
    #   const pathname = new URL(req.url, 'http://localhost').pathname;
    #   if (pathname === '/start') { handleStart(ws); }
    # });

    # We need the handleStart logic. I'll read it from the patch file.
    with open('deleted_code.patch', 'r') as f:
        patch = f.read()

    # The patch contains the old code as lines starting with '-'
    # We will find the block starting with "else if (req.url === '/start') {"
    # up to "else if (req.url === '/control') {"
    start_block = []
    in_start = False
    for line in patch.split('\n'):
        if line.startswith("-  else if (req.url === '/start') {"):
            in_start = True
            continue
        if in_start:
            if line.startswith("-  else if (req.url === '/control') {") or line.startswith("-  }") and len(line) == 4:
                # end of block
                if line.startswith("-  }"):
                    # just skip it, but we need to know we ended
                    in_start = False
                break
            if line.startswith("-"):
                start_block.append(line[1:]) # strip the '-'
    
    start_logic = "\n".join(start_block)
    
    # Let's wrap it in a function
    handle_start_func = f"""
function handleStart(ws) {{
{start_logic}
}}
"""

    # We need to find the wss initialization:
    # const wss = new WebSocketServer({ noServer: true });
    
    insert_idx = code.find("const wss = new WebSocketServer({ noServer: true });")
    if insert_idx == -1:
        print("Could not find wss initialization")
        return
    insert_idx += len("const wss = new WebSocketServer({ noServer: true });\n")
    
    # We will inject the handleStart function and a wss.on('connection') to trigger it
    injection = handle_start_func + """
wss.on('connection', (ws, req) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/start') {
    handleStart(ws);
  }
});
"""
    new_code = code[:insert_idx] + injection + code[insert_idx:]
    
    # Wait, there's one missing piece.
    # `handleStart` references `sanitizePipeline`, `path`, `rootPath`, `activeConfig`, `currentRunId`, `currentRunDir`, `currentRunLogs`, `child_process`.
    # Let's check if they exist globally in server.js.
    # Yes, they do!
    
    with open('server.js', 'w') as f:
        f.write(new_code)

if __name__ == '__main__':
    restore_start()
