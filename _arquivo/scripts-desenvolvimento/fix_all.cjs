const fs = require('fs');
const path = require('path');

let content = fs.readFileSync('server.js', 'utf8');

const newDataLogic = `
    if (req.url === '/data') {
      const lerTudo = () => {
        if (!fs.existsSync(inputPath)) return;
        try {
            if (ws.readyState === 1) ws.send("CLEAR");
            const fileContent = fs.readFileSync(inputPath, 'utf8');
            const lines = fileContent.split('\\n');
            let dbStartupTime = 0;
            const contagemComandos = [];
            
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts[0] === 'Database startup') {
                    dbStartupTime = parseInt(parts[2], 10);
                } else if (dbStartupTime && parts[0] !== 'key' && parts[0] !== 'Recovery' && parts[5] !== '0') {
                    const endTime = parseInt(parts[3], 10);
                    if (!isNaN(endTime)) {
                        const tempoEmSegundos = Math.floor((endTime - dbStartupTime) / 1000000);
                        if (tempoEmSegundos >= 0) {
                            const entryIndex = contagemComandos.findIndex(e => e[0] === tempoEmSegundos);
                            if (entryIndex === -1) {
                                contagemComandos.push([tempoEmSegundos, 1]);
                            } else {
                                contagemComandos[entryIndex][1]++;
                            }
                        }
                    }
                }
            }
            
            // Send all
            for (const item of contagemComandos) {
                if (ws.readyState === 1) ws.send(JSON.stringify(item));
            }
        } catch (e) {
            console.error(e);
        }
      };

      lerTudo();

      let debounce = null;
      let watcher = null;
      try {
        watcher = fs.watch(path.dirname(inputPath), (eventType, filename) => {
          if (filename === path.basename(inputPath)) {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
              lerTudo();
            }, 500);
          }
        });
      } catch(e) {}

      ws.on('close', () => {
        if (watcher) watcher.close();
      });
    }
`;

const newLatenciaLogic = `
    else if (req.url === '/latencia') {
      const lerTudo = () => {
        if (!fs.existsSync(inputPath)) return;
        try {
            if (ws.readyState === 1) ws.send("CLEAR");
            const fileContent = fs.readFileSync(inputPath, 'utf8');
            const lines = fileContent.split('\\n');
            let dbStartupTime = 0;
            
            const contagemNormal = [];
            const contagemRecuperacao = [];
            
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts[0] === 'Database startup') {
                    dbStartupTime = parseInt(parts[2], 10);
                } else if (dbStartupTime && parts[0] !== 'key' && parts[0] !== 'Recovery' && parts[5] !== '0') {
                    const endTime = parseInt(parts[3], 10);
                    const latencia = parseFloat(parts[4]);
                    const tipo = parts[5];
                    
                    if (!isNaN(endTime) && !isNaN(latencia)) {
                        const tempoEmSegundos = Math.floor((endTime - dbStartupTime) / 1000000);
                        if (tempoEmSegundos >= 0) {
                            if (tipo === 'N' || tipo === 'n') {
                                const entryIndex = contagemNormal.findIndex(e => e[0] === tempoEmSegundos);
                                if (entryIndex === -1) {
                                    contagemNormal.push([tempoEmSegundos, latencia, 1]);
                                } else {
                                    contagemNormal[entryIndex][1] += latencia;
                                    contagemNormal[entryIndex][2]++;
                                }
                            } else if (tipo === 'R' || tipo === 'r') {
                                const entryIndex = contagemRecuperacao.findIndex(e => e[0] === tempoEmSegundos);
                                if (entryIndex === -1) {
                                    contagemRecuperacao.push([tempoEmSegundos, latencia, 1]);
                                } else {
                                    contagemRecuperacao[entryIndex][1] += latencia;
                                    contagemRecuperacao[entryIndex][2]++;
                                }
                            }
                        }
                    }
                }
            }
            
            // Average latency
            for (const item of contagemNormal) {
                if (ws.readyState === 1) ws.send(JSON.stringify({
                    type: "N",
                    sec: item[0],
                    val: item[1] / item[2]
                }));
            }
            for (const item of contagemRecuperacao) {
                if (ws.readyState === 1) ws.send(JSON.stringify({
                    type: "R",
                    sec: item[0],
                    val: item[1] / item[2]
                }));
            }
        } catch (e) {
            console.error(e);
        }
      };

      lerTudo();

      let debounce = null;
      let watcher = null;
      try {
        watcher = fs.watch(path.dirname(inputPath), (eventType, filename) => {
          if (filename === path.basename(inputPath)) {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
              lerTudo();
            }, 500);
          }
        });
      } catch(e) {}

      ws.on('close', () => {
        if (watcher) watcher.close();
      });
    }
`;

// Substituir as lógicas de /data e /latencia inteiras!
content = content.replace(/if\s*\(req\.url\s*===\s*'\/data'\)\s*\{[\s\S]*?\/\/\s*rota\s*websocket\s*para\s*o\s*dataset\s*de\s*uso\s*de\s*cpu/, newDataLogic.trim() + '\n    \n    // rota websocket para o dataset de uso de cpu');

content = content.replace(/else\s*if\s*\(req\.url\s*===\s*'\/latencia'\)\s*\{[\s\S]*?\/\/\s*rota\s*websocket\s*para\s*o\s*dataset\s*de\s*uso\s*de\s*memoria/, newLatenciaLogic.trim() + '\n    \n    // rota websocket para o dataset de uso de memoria');

fs.writeFileSync('server.js', content);
console.log('Done replacement');
