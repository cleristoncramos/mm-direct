import { useEffect, useMemo, useState } from "react";
import SetupPanel from "./componentes/Form/SetupPanel";
import { UI, TIP } from "./i18n/strings";
import ChartBoard from "./componentes/Charts/ChartBoard";
import HistoryPanel from "./componentes/HistoryPanel";

const App = () => {
    const [loadingServer, setLoadingServer] = useState<boolean>(false);
    const [generateArquive, setGenerateArquive] = useState<boolean>(false);
    const [generateArquiveMonitoring, setGenerateArquiveMonitoring] = useState<boolean>(false);
    const [startConnection, setStartConnection] = useState<WebSocket>();
    const [logs, setLogs] = useState<string[]>([]);
    const [configData, setConfigData] = useState<any>({});
    
    // Modal state for history
    const [showHistory, setShowHistory] = useState<boolean>(false);
    
    // Sidebar toggle state
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

    // Backend (Node, porta 8081) acessível? Verificado a cada 5 s para mostrar a faixa de desconexão.
    const [backendOnline, setBackendOnline] = useState<boolean>(true);
    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 3000);
            try {
                const res = await fetch("http://localhost:8081/api/prepare-database/status", { signal: ctrl.signal });
                if (!cancelled) setBackendOnline(res.ok);
            } catch {
                if (!cancelled) setBackendOnline(false);
            } finally {
                clearTimeout(timer);
            }
        };
        check();
        const id = setInterval(check, 5000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    // Etapa atual da inicialização, deduzida das mensagens do servidor
    const startupStep = useMemo(() => {
        const all = logs.join("\n");
        if (/PRELOAD_STARTED|EXECUTION_BRANCH|RECOVERY_STARTED/.test(all)) return 2;
        if (/RUN_STARTED|Redis server started|Redis-IR is starting/.test(all)) return 1;
        return 0;
    }, [logs]);

    const initializeServer = (params: any) => {
        console.log("Iniciando servidor com config:", params);
        setConfigData(params);
        setLoadingServer(true);
        setLogs([]);
        setGenerateArquive(false);
        setGenerateArquiveMonitoring(false);
        
        setIsSidebarOpen(false);
        // Rola imediatamente ao clicar
        const mainArea = document.getElementById('main-experiment-area');
        if (mainArea) {
            mainArea.scrollTop = 0;
        }

        const ws = new WebSocket(`ws://localhost:8081/start`);

        ws.onmessage = (event) => {
            const dataStr = String(event.data);

            // Backend recusou o início (ex.: Load database em andamento)
            if (dataStr.includes("START_REJECTED")) {
                let reason = "The server refused to start the experiment.";
                try { reason = JSON.parse(dataStr).reason || reason; } catch (e) { /* texto simples */ }
                console.warn("START_REJECTED:", reason);
                setLoadingServer(false);
                setIsSidebarOpen(true);
                window.alert(reason);
                return;
            }

            setLogs((prevLogs) => [...prevLogs, dataStr]);

            if (
                dataStr === "Generating information database commands" ||
                dataStr.includes("PRELOAD_FAILED") ||
                dataStr.includes("EXPERIMENT_FAILED")
            ) {
                console.log("Server started or failed event received");
                setLoadingServer(false);
                setGenerateArquive(true);
                
                // Força o scroll pro topo quando o ChartBoard aparecer
                setTimeout(() => {
                    const area = document.getElementById('main-experiment-area');
                    if (area) {
                        area.scrollTop = 0;
                    }
                }, 100);
                
                setTimeout(() => {
                    const area = document.getElementById('main-experiment-area');
                    if (area) {
                        area.scrollTop = 0;
                    }
                }, 500);
            }

            if (
                (dataStr === "Generating system monitoring" || dataStr.includes("PRELOAD_FAILED") || dataStr.includes("EXPERIMENT_FAILED")) &&
                !generateArquiveMonitoring
            ) {
                console.log("Server started monitoring or failure triggered");
                setLoadingServer(false);
                setGenerateArquiveMonitoring(true);
            }
        };

        ws.onerror = (err) => {
            console.error("Erro na conexão ws://localhost:8081/start:", err);
            setLoadingServer(false);
        };

        setStartConnection(ws);
    };

    const onReloadButtuonClick = (e: Event, connectionsArray: WebSocket[]) => {
        if (e) {
            console.log("Parando experimento...");
        }
        
        try {
            const stopWs = new WebSocket("ws://localhost:8081/stop");
            stopWs.onopen = () => {
                console.log("Comando de desligamento limpo enviado ao Redis.");
                setTimeout(() => stopWs.close(), 500);
            };
        } catch (err) {
            console.error("Erro ao conectar no stop WS:", err);
        }

        connectionsArray.forEach((conection: WebSocket) => conection.close())
        startConnection?.close()
        setLogs([]);
        setGenerateArquive(false);
        setGenerateArquiveMonitoring(false);
        setConfigData({});
        setIsSidebarOpen(true);
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
            <div className="print:hidden">
                {/* Cabeçalho único (uma linha): marca + experimento + tempos + ações.
                    Durante um experimento, o ChartBoard desenha o ID, o status, os tempos e as
                    ações dentro de #experiment-toolbar-slot (portal), para tudo ficar nesta linha. */}
                <header className="bg-slate-900 border-b border-slate-800 py-2 px-4 flex items-center gap-4 z-10 relative min-h-[52px]">
                    <div className="flex items-center gap-3 flex-shrink-0">
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="p-1.5 rounded-none bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            title={UI.app.toggleSidebar}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-2">
                            <img src="/favicon.svg" alt="" className="w-6 h-6" />
                            <span className="text-slate-100 font-bold text-lg tracking-tight">{UI.app.name}</span>
                            {!generateArquive && (
                                <span className="text-slate-500 text-sm font-medium border-l border-slate-700 pl-2">{UI.app.tag}</span>
                            )}
                        </div>
                    </div>

                    {/* Espaço preenchido pelo ChartBoard durante um experimento */}
                    <div id="experiment-toolbar-slot" className="flex-1 min-w-0 flex items-center"></div>

                    {/* Sem experimento: só o History à direita (com experimento ele vai junto das ações) */}
                    {!generateArquive && (
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className={`px-3 py-1.5 rounded-none text-xs font-semibold transition flex items-center gap-1.5 border ${
                                showHistory ? "bg-slate-700 border-slate-600 text-white" : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                            }`}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{UI.app.history}</span>
                        </button>
                    )}
                </header>

                {/* Faixa de desconexão do backend */}
                {!backendOnline && (
                    <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs px-6 py-1.5 flex items-center gap-2" title={TIP.backendOffline}>
                        <span className="w-1.5 h-1.5 bg-amber-400"></span>
                        {UI.app.backendOffline}
                    </div>
                )}
            </div>

            {/* Histórico por cima da área principal, sem desmontar o experimento em andamento */}
            {showHistory && (
                <div className="flex-1 overflow-y-auto bg-slate-950 custom-scrollbar">
                    <HistoryPanel onBack={() => setShowHistory(false)} />
                </div>
            )}
            {(
                <main className={showHistory ? "hidden" : "flex-1 flex overflow-hidden"}>
                    {/* Sidebar com Parâmetros */}
                    <div 
                        className={`transition-all duration-300 ease-in-out flex-shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col print:hidden ${
                            isSidebarOpen ? "w-80 lg:w-96 opacity-100" : "w-0 opacity-0 overflow-hidden border-r-0"
                        }`}
                    >
                        <div className="w-80 lg:w-96 h-full flex flex-col p-4 overflow-hidden">
                            <SetupPanel 
                                initServer={initializeServer} 
                                isExecutionRunning={loadingServer || generateArquive}
                            />
                        </div>
                    </div>

                    {/* Área de Visualização Principal */}
                    <div id="main-experiment-area" className="flex-1 flex flex-col overflow-y-auto relative bg-slate-950">
                        
                        {loadingServer && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm z-50 print:hidden">
                                <div className="bg-slate-900 border border-slate-800 rounded-none p-6 w-[360px] shadow-2xl space-y-4">
                                    <h3 className="text-base font-semibold text-white">{UI.startup.title}</h3>
                                    <ol className="space-y-2">
                                        {UI.startup.steps.map((label, i) => (
                                            <li key={label} className="flex items-center gap-2.5 text-sm">
                                                <span className={`w-4 h-4 flex items-center justify-center text-[10px] border ${
                                                    i < startupStep ? "bg-emerald-600 border-emerald-500 text-white" :
                                                    i === startupStep ? "border-blue-400 text-blue-300" :
                                                    "border-slate-700 text-slate-600"
                                                }`}>
                                                    {i < startupStep ? "✓" : i + 1}
                                                </span>
                                                <span className={i <= startupStep ? "text-slate-200" : "text-slate-500"}>{label}</span>
                                                {i === startupStep && <span className="ml-auto w-3 h-3 border-2 border-blue-400 border-t-transparent animate-spin"></span>}
                                            </li>
                                        ))}
                                    </ol>
                                    <div className="bg-slate-950 rounded-none p-2 max-h-24 overflow-y-auto text-left font-mono text-[10px] text-slate-400 border border-slate-800 break-words">
                                        {logs.length > 0 ? logs[logs.length - 1].slice(0, 400) : UI.startup.waiting}
                                    </div>
                                </div>
                            </div>
                        )}

                        {!generateArquive && !loadingServer ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-4">
                                <svg className="w-16 h-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                <p className="text-lg font-light">{UI.app.emptyTitle}</p>
                                <p className="text-sm">{UI.app.emptyHint} <span className="font-semibold text-emerald-400">{UI.form.start}</span></p>
                            </div>
                        ) : null}

                        {generateArquive && (
                            <div className="flex-1 flex flex-col">
                                <ChartBoard
                                    cpuChart={generateArquiveMonitoring}
                                    transferChart={generateArquive}
                                    terminalLog={logs}
                                    onReloadButtonClick={onReloadButtuonClick}
                                    configData={configData}
                                    historyOpen={showHistory}
                                    onToggleHistory={() => setShowHistory(!showHistory)}
                                />
                            </div>
                        )}
                    </div>
                </main>
            )}
        </div>
    );
}

export default App;
