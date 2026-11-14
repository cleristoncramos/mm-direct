import os
import re

def fix_server_routes():
    with open('server.js', 'r') as f:
        code = f.read()

    # The array is: ['/data', '/cpu', '/memory', '/latencia', '/control']
    # I should change it to: ['/data', '/cpu', '/memory', '/latencia', '/control', '/start', '/stop']
    code = code.replace(
        "if (!['/data', '/cpu', '/memory', '/latencia', '/control'].includes(req.url)) {",
        "if (!['/data', '/cpu', '/memory', '/latencia', '/control', '/start', '/stop'].includes(req.url)) {"
    )

    with open('server.js', 'w') as f:
        f.write(code)

if __name__ == '__main__':
    fix_server_routes()
