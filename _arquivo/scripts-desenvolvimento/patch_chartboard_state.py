import os
import re

def rewrite_chart_board():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Add refs
    refs_to_add = """
    const processedRunStartedRef = useRef<string | null>(null);
    const currentRunIdRef = useRef<string | null>(null);
    """
    
    # Place it near currentRunId
    code = code.replace(
        'const [currentRunId, setCurrentRunId] = useState<string | null>(null);',
        'const [currentRunId, setCurrentRunId] = useState<string | null>(null);\n' + refs_to_add
    )

    # We need to use currentRunIdRef inside websocket updates
    # The websockets handlers currently use `currentRunId`
    # Let's replace `currentRunId !==` with `currentRunIdRef.current !==` inside the WS handlers
    code = code.replace('message.runId !== currentRunId', 'message.runId !== currentRunIdRef.current')
    code = code.replace('currentRunId as string', 'currentRunIdRef.current as string')
    
    # We also need to fix `runStartUs === null` inside the handlers, because runStartUs is a state.
    # It might be stale.
    # Let's add a ref for runStartUs too.
    code = code.replace(
        'const [runStartUs, setRunStartUs] = useState<number | null>(null);',
        'const [runStartUs, setRunStartUs] = useState<number | null>(null);\n    const runStartUsRef = useRef<number | null>(null);'
    )
    code = code.replace('runStartUs === null', 'runStartUsRef.current === null')
    code = code.replace('(runStartUs || 0)', '(runStartUsRef.current || 0)')

    # Handle the RUN_STARTED and RUN_CONTINUED_AFTER_FAILURE properly
    
    old_run_started = """            if (evtName === "RUN_STARTED") {
                console.log(`RUN_STARTED_RECEIVED runId=${evtObj.runId} runStartUs=${evtObj.runStartUs}`);
                console.log("TELEMETRY_BUFFERS_CLEARED");
                setCurrentRunId(evtObj.runId || null);

                if (evtObj.runStartUs) {
                    setRunStartUs(Number(evtObj.runStartUs));
                }
                updateVisualState("IDLE");

            }"""

    new_run_started = """            if (evtName === "RUN_STARTED") {
                if (processedRunStartedRef.current === evtObj.runId) {
                    // Already processed
                } else {
                    processedRunStartedRef.current = evtObj.runId;
                    console.log(`RUN_STARTED_RECEIVED runId=${evtObj.runId} runStartUs=${evtObj.runStartUs}`);
                    console.log("TELEMETRY_BUFFERS_CLEARED");
                    
                    currentRunIdRef.current = evtObj.runId || null;
                    setCurrentRunId(evtObj.runId || null);

                    if (evtObj.runStartUs) {
                        runStartUsRef.current = Number(evtObj.runStartUs);
                        setRunStartUs(Number(evtObj.runStartUs));
                    }
                    
                    // Clear buffers
                    setDataCPU([]);
                    setDataTransfer([]);
                    setDataMemory([]);
                    setDataScatter([]);
                    
                    updateVisualState("IDLE");
                }
            } else if (evtName === "RUN_CONTINUED_AFTER_FAILURE") {
                if (evtObj.runId !== currentRunIdRef.current) {
                    console.warn('RUN_CONTINUED_IGNORED reason=unknown-run');
                } else {
                    console.debug('RUN_CONTINUED_ACCEPTED', evtObj.runId);
                }
            }"""
            
    code = code.replace(old_run_started, new_run_started)

    # For WebSocket "CLEAR" handler:
    # "O evento CLEAR deve ser processado apenas quando:
    # o Node.js iniciar explicitamente uma nova execução;
    # houver mudança real de runId."
    # BUT how does CLEAR contain runId? In server.js, ws.send("CLEAR") doesn't have runId.
    # The user says: "Ao processar CLEAR: limpar buffers; ... aguardar novo RUN_STARTED"
    # Actually if the user wants me to fix CLEAR so it doesn't clear during reconnections:
    # the server.js sends `CLEAR` unconditionally on connection. 
    # Let's remove the logic where `if (data === "CLEAR")` clears the state entirely, or only clear if we are in IDLE?
    # Wait, the user said: "Não processe CLEAR: ao reconectar um WebSocket; ao montar novamente um componente..."
    # The easiest way is to just ignore CLEAR from websocket, because RUN_STARTED already clears the buffers!
    # User said: "Ao processar CLEAR: limpar buffers ... Depois disso, aguardar o novo RUN_STARTED."
    # Let's see how CLEAR is handled in ChartBoard.tsx.
    
    clear_handler = """                    if (data === "CLEAR") {
                        setDataCPU([]);
                        setCpuTelemetryState("WAITING");
                        return;
                    }"""
    # Wait, each channel has a CLEAR handler. 
    # Let's just make them ignore CLEAR completely, or process it safely.
    # The user said: "O evento CLEAR deve ser processado apenas quando: ... houver mudança real de runId. Não processe CLEAR: ao reconectar um WebSocket..."
    # Since WS doesn't send runId with CLEAR, we can't differentiate. BUT RUN_STARTED sends runId.
    # Actually, the user says "Tratamento do evento CLEAR ... Depois disso, aguardar o novo RUN_STARTED."
    # If the backend sends CLEAR, we can just let it be, or we can use RUN_STARTED to clear.
    # We already added clearing to RUN_STARTED. Let's just remove the CLEAR logic from websockets, since RUN_STARTED is the single source of truth!
    
    code = re.sub(r'if \(\s*data\s*===\s*"CLEAR"\s*\)\s*\{[^}]*\}', '', code)

    # Finally, make sure the useEffect for WebSockets doesn't depend on currentRunId!
    # Currently it probably depends on `currentRunId`
    code = code.replace(', [currentRunId, runStartUs])', ', [])')

    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == "__main__":
    rewrite_chart_board()
