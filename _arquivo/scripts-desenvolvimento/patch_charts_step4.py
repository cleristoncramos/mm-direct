import os
import re

def patch_chart(filename):
    with open(filename, 'r') as f:
        code = f.read()
    
    # Replace the data type in props
    code = re.sub(
        r'data:\s*\[number,\s*number\]\[\];',
        r'data: TelemetryPoint[];',
        code
    )
    code = re.sub(
        r'data:\s*\[number,\s*number\s*\|\s*null,\s*number\s*\|\s*null\]\[\];',
        r'data: TelemetryPoint[];',
        code
    )

    # Import TelemetryPoint
    if 'import { TelemetryPoint }' not in code:
        code = code.replace(
            'import { Line',
            'import { TelemetryPoint } from "./types";\nimport { Line'
        )
        code = code.replace(
            'import { Scatter',
            'import { TelemetryPoint } from "./types";\nimport { Scatter'
        )

    # In Cpu, Memory, Transfer: item[0] -> item.relativeSeconds, item[1] -> item.value
    code = re.sub(r'item\[0\]', r'item.relativeSeconds', code)
    code = re.sub(r'item\[1\]', r'item.value', code)

    # In ScatterChart, the type is 'N' or 'A', so we check item.type
    # The existing ScatterChart mapped item[0] to x, and item[1] or item[2] to y.
    # If the user refactored ScatterChart to just TelemetryPoint, we need to adapt it:
    # Actually, ScatterChart currently uses:
    # { x: item[0], y: item[1] } for normal, and { x: item[0], y: item[2] } for abnormal.
    if 'ScatterChart' in filename:
        code = re.sub(
            r'data\.filter\(\(item\) => item\[1\] !== null\)\.map\(\(item\) => \(\{\s*x:\s*item\[0\],\s*y:\s*item\[1\]\s*\}\)\)',
            r'data.filter(item => item.type === "N").map(item => ({ x: item.relativeSeconds, y: item.value }))',
            code
        )
        code = re.sub(
            r'data\.filter\(\(item\) => item\[2\] !== null\)\.map\(\(item\) => \(\{\s*x:\s*item\[0\],\s*y:\s*item\[2\]\s*\}\)\)',
            r'data.filter(item => item.type === "A").map(item => ({ x: item.relativeSeconds, y: item.value }))',
            code
        )

    with open(filename, 'w') as f:
        f.write(code)

def patch_chartboard():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Fix item[0] and item[1] for chartData exports
    code = re.sub(r'item\[0\]', r'item.relativeSeconds', code)
    code = re.sub(r'item\[1\]', r'item.value', code)

    # Fix latest values display: `dataCPU[dataCPU.length - 1][1]` -> `dataCPU[dataCPU.length - 1].value`
    code = re.sub(r'\[dataCPU\.length - 1\]\[1\]', r'[dataCPU.length - 1].value', code)
    code = re.sub(r'\[dataMemory\.length - 1\]\[1\]', r'[dataMemory.length - 1].value', code)
    # Scatter latest:
    code = re.sub(r'dataScatter\[dataScatter\.length - 1\]\[1\]\s*\|\|\s*dataScatter\[dataScatter\.length - 1\]\[2\]', r'dataScatter[dataScatter.length - 1].value', code)
    
    # Fix x extraction:
    # sortedData.map((item) => ({ x: item.relativeSeconds, y: item.value })) -> already done by item[0] replace
    
    # Fix [x, y] destructuring in printThroughputChartData:
    code = re.sub(r'sortedData\.forEach\(\(\[x, y\]\) =>', r'sortedData.forEach(({ relativeSeconds: x, value: y }) =>', code)

    # Fix downloading report data access
    code = re.sub(r'dataTransfer\[dataTransfer\.length - 1\]\.relativeSeconds\s*\*\s*1000', r'dataTransfer[dataTransfer.length - 1].relativeSeconds * 1000', code)
    # Because we did item[0] -> item.relativeSeconds globally, we must ensure array access wasn't broken.
    
    # Let's fix [dataTransfer.length - 1].relativeSeconds in downloading json:
    code = re.sub(r'dataTransfer\[dataTransfer\.length - 1\]\[0\]', r'dataTransfer[dataTransfer.length - 1].relativeSeconds', code)

    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == '__main__':
    charts = [
        'web/src/componentes/Charts/CpuChart.tsx',
        'web/src/componentes/Charts/MemoryChart.tsx',
        'web/src/componentes/Charts/TransferChart.tsx',
        'web/src/componentes/Charts/ScatterChart.tsx'
    ]
    for c in charts:
        patch_chart(c)
    
    patch_chartboard()
