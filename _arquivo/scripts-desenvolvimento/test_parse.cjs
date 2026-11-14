const fs = require('fs');
const fileContent = fs.readFileSync('src/runs/run_1786321731571/datasets.csv', 'utf8');
const lines = fileContent.split('\n');
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
console.log(contagemComandos.map(c => `${c[0]}:${c[1]}`).join(', '));
