const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('server.js', 'utf8');

const newDataLogic = `
    if (req.url === '/data') {
      const dataCtx = {
        total: 0,
        database_startup_time: 0,
        contagemComandos: [],
        arrayParaVerificarSeJaFoiEnviado: []
      };

      const lerTudo = async () => {
        if (!fs.existsSync(inputPath)) return;
        dataCtx.total = 0;
        dataCtx.contagemComandos = [];
        dataCtx.arrayParaVerificarSeJaFoiEnviado = [];
        if (ws.readyState === 1) ws.send("CLEAR");
        await processaCSV(ws, inputPath, dataCtx);
      };

      lerTudo();

      // Monitor file changes using fs.watch
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
      const latCtx = {
        totalLatencia: 0,
        database_startup_time_latencia: 0,
        x1: [],
        y1: [],
        x2: [],
        y2: []
      };

      const lerTudo = async () => {
        if (!fs.existsSync(inputPath)) return;
        latCtx.totalLatencia = 0;
        latCtx.x1 = [];
        latCtx.y1 = [];
        latCtx.x2 = [];
        latCtx.y2 = [];
        if (ws.readyState === 1) ws.send("CLEAR");
        await processaLatencia(ws, inputPath, latCtx);
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

// Substituir na server.js
let newContent = content.replace(/if\s*\(req\.url\s*===\s*'\/data'\)\s*\{[\s\S]*?\/\/\s*rota\s*websocket\s*para\s*o\s*dataset\s*de\s*uso\s*de\s*cpu/, newDataLogic.trim() + '\n    \n    // rota websocket para o dataset de uso de cpu');

newContent = newContent.replace(/else\s*if\s*\(req\.url\s*===\s*'\/latencia'\)\s*\{[\s\S]*?\/\/\s*rota\s*websocket\s*para\s*o\s*dataset\s*de\s*uso\s*de\s*memoria/, newLatenciaLogic.trim() + '\n    \n    // rota websocket para o dataset de uso de memoria');

fs.writeFileSync('server.js', newContent);
console.log('server.js patched successfully');
