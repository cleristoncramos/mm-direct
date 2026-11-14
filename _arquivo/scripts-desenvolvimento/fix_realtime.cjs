const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

const newDataLogic = `
    if (req.url === '/data') {
      let dbStartupTime = 0;
      const arrayParaVerificarSeJaFoiEnviado = [];
      let checkInterval = null;

      const lerTudo = () => {
        if (!fs.existsSync(inputPath)) return;
        try {
            const fileContent = fs.readFileSync(inputPath, 'utf8');
            const lines = fileContent.split('\\n');
            const contagemComandos = [];
            
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts[0] === 'Database startup' && !dbStartupTime) {
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
            
            // Send fully formed seconds (all except the last one, which might still be accumulating)
            // But if it's the very end, we should send all. We can't know if it's the end here, so we send length - 1.
            const len = contagemComandos.length;
            if (len > 0) {
                for (let i = 0; i < len - 1; i++) {
                    const sec = contagemComandos[i][0];
                    if (!arrayParaVerificarSeJaFoiEnviado.includes(sec)) {
                        if (ws.readyState === 1) ws.send(JSON.stringify(contagemComandos[i]));
                        arrayParaVerificarSeJaFoiEnviado.push(sec);
                    }
                }
            }
            // Send the last item if the file hasn't been modified in 2 seconds
            try {
                const stats = fs.statSync(inputPath);
                const age = Date.now() - stats.mtimeMs;
                if (age > 2000 && len > 0) {
                    const lastSec = contagemComandos[len - 1][0];
                    if (!arrayParaVerificarSeJaFoiEnviado.includes(lastSec)) {
                        if (ws.readyState === 1) ws.send(JSON.stringify(contagemComandos[len - 1]));
                        arrayParaVerificarSeJaFoiEnviado.push(lastSec);
                    }
                }
            } catch(e) {}
            
        } catch (e) {}
      };

      if (ws.readyState === 1) ws.send("CLEAR");
      lerTudo();
      checkInterval = setInterval(lerTudo, 500);

      ws.on('close', () => {
        if (checkInterval) clearInterval(checkInterval);
      });
    }
`;

const newLatenciaLogic = `
    else if (req.url === '/latencia') {
      let dbStartupTime = 0;
      const enviadasNormal = [];
      const enviadasRecuperacao = [];
      let checkInterval = null;

      const lerTudo = () => {
        if (!fs.existsSync(inputPath)) return;
        try {
            const fileContent = fs.readFileSync(inputPath, 'utf8');
            const lines = fileContent.split('\\n');
            const contagemNormal = [];
            const contagemRecuperacao = [];
            
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts[0] === 'Database startup' && !dbStartupTime) {
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
            
            const isFinished = () => {
                try {
                    const age = Date.now() - fs.statSync(inputPath).mtimeMs;
                    return age > 2000;
                } catch(e) { return false; }
            };
            const fin = isFinished();

            const lenN = contagemNormal.length;
            for (let i = 0; i < lenN; i++) {
                if (i === lenN - 1 && !fin) continue;
                const sec = contagemNormal[i][0];
                if (!enviadasNormal.includes(sec)) {
                    if (ws.readyState === 1) ws.send(JSON.stringify({
                        type: "N", sec: sec, val: contagemNormal[i][1] / contagemNormal[i][2]
                    }));
                    enviadasNormal.push(sec);
                }
            }

            const lenR = contagemRecuperacao.length;
            for (let i = 0; i < lenR; i++) {
                if (i === lenR - 1 && !fin) continue;
                const sec = contagemRecuperacao[i][0];
                if (!enviadasRecuperacao.includes(sec)) {
                    if (ws.readyState === 1) ws.send(JSON.stringify({
                        type: "R", sec: sec, val: contagemRecuperacao[i][1] / contagemRecuperacao[i][2]
                    }));
                    enviadasRecuperacao.push(sec);
                }
            }
        } catch (e) {}
      };

      if (ws.readyState === 1) ws.send("CLEAR");
      lerTudo();
      checkInterval = setInterval(lerTudo, 500);

      ws.on('close', () => {
        if (checkInterval) clearInterval(checkInterval);
      });
    }
`;

content = content.replace(/if\s*\(req\.url\s*===\s*'\/data'\)\s*\{[\s\S]*?\/\/\s*rota\s*websocket\s*para\s*o\s*dataset\s*de\s*uso\s*de\s*cpu/, newDataLogic.trim() + '\n    \n    // rota websocket para o dataset de uso de cpu');

content = content.replace(/else\s*if\s*\(req\.url\s*===\s*'\/latencia'\)\s*\{[\s\S]*?\/\/\s*rota\s*websocket\s*para\s*o\s*dataset\s*de\s*uso\s*de\s*memoria/, newLatenciaLogic.trim() + '\n    \n    // rota websocket para o dataset de uso de memoria');

fs.writeFileSync('server.js', content);
console.log('Real-time parsing applied!');
