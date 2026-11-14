const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// Fix CPU
content = content.replace(
  /if \(lines\[0\] === "Database startup"\) \{\s*if \(lines\.length >= 3 && lines\[2\]\) \{\s*cpuCtx\.databaseStartupCpu = parseInt\(lines\[2\], 10\);\s*\}\s*return;\s*\}/g,
  `if (lines[0] === "Database startup") {
          if (!cpuCtx.databaseStartupCpu && lines.length >= 3 && lines[2]) {
            cpuCtx.databaseStartupCpu = parseInt(lines[2], 10);
          }
          return;
        }`
);

// Fix Memoria
content = content.replace(
  /if \(lines\[0\] === "Database startup"\) \{\s*if \(lines\.length >= 3 && lines\[2\]\) \{\s*memCtx\.databaseStartupMemoria = parseInt\(lines\[2\], 10\);\s*\}\s*return;\s*\}/g,
  `if (lines[0] === "Database startup") {
        if (!memCtx.databaseStartupMemoria && lines.length >= 3 && lines[2]) {
          memCtx.databaseStartupMemoria = parseInt(lines[2], 10);
        }
        return;
      }`
);

fs.writeFileSync('server.js', content);
console.log('CPU and Memoria parsing fixed!');
