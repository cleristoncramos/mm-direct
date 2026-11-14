import os
import re

# Patch server.js to include timestampUs
with open("server.js", "r") as f:
    server_code = f.read()

# I will revert the previous change and make a better one that sends {runId, timestampUs, val...} or similar
# Wait, if I just do it in the python script, I can manipulate exactly what I want.

