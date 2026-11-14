const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
c = c.replace(/csv\(\{ skipLines: 1 \}\)/g, "csv({ headers: ['key', 'command', 'startTime', 'finishTime', 'latency', 'type'], skipLines: 0 })");
fs.writeFileSync('server.js', c);
console.log('patched');
