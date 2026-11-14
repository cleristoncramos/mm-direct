import os
import re

def fix_array_errors():
    with open('web/src/componentes/Charts/ChartBoard.tsx', 'r') as f:
        code = f.read()

    # Find [0] in sorts and fixes
    code = code.replace('dataTransfer.length > 0 ? dataTransfer[dataTransfer.length - 1][0] * 1000', 'dataTransfer.length > 0 ? dataTransfer[dataTransfer.length - 1].relativeSeconds * 1000')
    code = code.replace('(dataTransfer[dataTransfer.length - 1][0] - failureTime) * 1000', '(dataTransfer[dataTransfer.length - 1].relativeSeconds - failureTime) * 1000')
    code = code.replace('(dataTransfer[dataTransfer.length - 1][0] - recoveryStartTime) * 1000', '(dataTransfer[dataTransfer.length - 1].relativeSeconds - recoveryStartTime) * 1000')
    code = code.replace('(dataTransfer[dataTransfer.length - 1][0] - recoveryEndTime) * 1000', '(dataTransfer[dataTransfer.length - 1].relativeSeconds - recoveryEndTime) * 1000')
    code = code.replace('(dataTransfer[dataTransfer.length - 1][0] - stabilityTime) * 1000', '(dataTransfer[dataTransfer.length - 1].relativeSeconds - stabilityTime) * 1000')
    code = code.replace('a[0] - b[0]', 'a.relativeSeconds - b.relativeSeconds')
    code = code.replace('a.relativeSeconds - b.relativeSeconds - b.relativeSeconds', 'a.relativeSeconds - b.relativeSeconds')

    # Now fix the websocket handlers by replacing `if (Array.isArray(message))` block entirely.
    # The handlers start with `if (Array.isArray(message))` and we need to change it to use JSON object
    
    array_check_pattern = r'if\s*\(\s*Array\.isArray\(message\)\s*\)\s*\{'
    replacement = r'if (message && message.runId && message.timestampUs !== undefined) {'
    code = re.sub(array_check_pattern, replacement, code)

    with open('web/src/componentes/Charts/ChartBoard.tsx', 'w') as f:
        f.write(code)

if __name__ == '__main__':
    fix_array_errors()
