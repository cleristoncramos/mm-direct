import re

with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
    code = f.read()

# 1. Imports
code = code.replace(
    'import { ScatterChart } from "./ScatterChart";',
    'import { ScatterChart } from "./ScatterChart";\nimport { ExperimentVisualState, TelemetryStatus, TelemetryPoint, DashboardState } from "./types";'
)

# 2. Remove old ExperimentVisualState definition
code = re.sub(
    r'export type ExperimentVisualState =.*?FAILED\';\n',
    '',
    code,
    flags=re.DOTALL
)

# 3. State replacements
# From:
# const activeRunId = useMemo(() => String(Date.now()), []);
# To:
# const [currentRunId, setCurrentRunId] = useState<string | null>(null);
# const [runStartUs, setRunStartUs] = useState<number | null>(null);

code = code.replace(
    'const activeRunId = useMemo(() => String(Date.now()), []);',
    'const [currentRunId, setCurrentRunId] = useState<string | null>(null);\n    const [runStartUs, setRunStartUs] = useState<number | null>(null);\n    const activeRunId = currentRunId || "Aguardando";'
)

# Old data arrays:
# const [dataCPU, setDataCPU] = useState<[number, number][]>([]);
# const [dataTransfer, setDataTransfer] = useState<[number, number][]>([]);
# const [dataMemory, setDataMemory] = useState<[number, number][]>([]);
# const [dataScatter, setDataScatter] = useState<[number, number | null, number | null][]>([]);

code = re.sub(
    r'const \[dataCPU, setDataCPU\] = useState<\[number, number\]\[\]>\(\[\]\);',
    r'const [dataCPU, setDataCPU] = useState<TelemetryPoint[]>([]);',
    code
)
code = re.sub(
    r'const \[dataTransfer, setDataTransfer\] = useState<\[number, number\]\[\]>\(\[\]\);',
    r'const [dataTransfer, setDataTransfer] = useState<TelemetryPoint[]>([]);',
    code
)
code = re.sub(
    r'const \[dataMemory, setDataMemory\] = useState<\[number, number\]\[\]>\(\[\]\);',
    r'const [dataMemory, setDataMemory] = useState<TelemetryPoint[]>([]);',
    code
)
code = re.sub(
    r'const \[dataScatter, setDataScatter\] = useState<\[number, number \| null, number \| null\]\[\]>\(\[\]\);',
    r'const [dataScatter, setDataScatter] = useState<TelemetryPoint[]>([]);',
    code
)

# Change TelemetryState strings to TelemetryStatus
code = re.sub(r'useState<string>\("WAITING"\)', r'useState<TelemetryStatus>("WAITING")', code)

# Event loop:
# Add logic to set currentRunId and runStartUs
# 'const runStartUs = ...' -> already exist as runStartUs.
event_loop_replace = """
            if (evtName === "RUN_STARTED") {
                setCurrentRunId(evtObj.runId || null);
                if (evtObj.runStartUs) {
                    setRunStartUs(Number(evtObj.runStartUs));
                }
                updateVisualState("IDLE");
"""
code = code.replace(
    '            if (evtName === "RUN_STARTED") {\\n                updateVisualState("IDLE");',
    event_loop_replace
)

# Remove activeRunId replace
code = code.replace(
    'if (evtName === "RUN_STARTED") {\n                updateVisualState("IDLE");',
    event_loop_replace
)

with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
    f.write(code)
