import express from "express";
import fs from 'fs';
import csv from 'csv-parser';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from "path";
import { Tail } from "tail";
import child_process from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';
import net from 'net';
import readline from 'readline';
import { modifyConfigFile } from "./config-mm-direct.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getTimestamps = (dateInput) => {
  const date = dateInput || new Date();
  const utc = date.toISOString();
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const p = {};
  parts.forEach(part => p[part.type] = part.value);
  
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    timeZoneName: 'longOffset'
  }).formatToParts(date);
  const nameVal = tzParts.find(pt => pt.type === 'timeZoneName')?.value || 'GMT-03:00';
  
  let offsetStr = '-03:00';
  if (nameVal === 'GMT') {
    offsetStr = '+00:00';
  } else {
    const match = nameVal.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (match) {
      const sign = match[1];
      const hours = match[2].padStart(2, '0');
      const minutes = (match[3] || '00').padStart(2, '0');
      offsetStr = `${sign}${hours}:${minutes}`;
    }
  }
  
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}${offsetStr}`;
  
  return { utc, local };
};


// ─── Leitura dos artefatos de um experimento (usada na finalização, na reconstrução e no histórico) ───

// Status pelos eventos estruturados do Redis-IR
const computeExperimentStatus = (ev) => {
  if (ev["EXPERIMENT_FAILED"] || ev["PRELOAD_FAILED"] || ev["RECOVERY_FAILED"]) return "Failed";
  if (ev["EXPERIMENT_COMPLETED"] && ev["RECOVERY_COMPLETED"]) return "Completed";
  if (ev["EXPERIMENT_COMPLETED"]) return "No failure";
  return "Interrupted";
};

// Todos os eventos EVENT_JSON do log, em ordem, sem descartar repetições: falhas sucessivas,
// vários checkpoints. É a base das marcações dos gráficos (Fase 2 do plano, 14/11/2026).
const EVENT_LIST_FIELDS = ["event", "timestampUs", "relativeMs", "durationMs", "checkpointId", "kind", "keys", "loadedTuples", "reason"];
const parseEventListFromLog = (text) => {
  const list = [];
  const seen = new Set();
  String(text || "").split("\n").forEach((line) => {
    const j = line.indexOf("EVENT_JSON ");
    if (j === -1) return;
    try {
      const obj = JSON.parse(line.substring(j + 11).trim());
      if (!obj.event || obj.timestampUs === undefined) return;
      const key = `${obj.event}@${obj.timestampUs}`;
      if (seen.has(key)) return;           // a mesma linha pode aparecer duas vezes no log
      seen.add(key);
      const item = {};
      EVENT_LIST_FIELDS.forEach((f) => { if (obj[f] !== undefined) item[f] = obj[f]; });
      list.push(item);
    } catch (e) {}
  });
  return list.sort((a, b) => Number(a.timestampUs) - Number(b.timestampUs));
};

// Eventos "EVENT_JSON {...}" e "EVENT NOME k=v ..." de um texto de log → { NOME: {...} } (última ocorrência)
const parseEventsFromLog = (text) => {
  const events = {};
  let runStartUs = null;
  String(text || "").split("\n").forEach((line) => {
    const j = line.indexOf("EVENT_JSON ");
    if (j !== -1) {
      try {
        const obj = JSON.parse(line.substring(j + 11).trim());
        if (obj.runStartUs && !runStartUs) runStartUs = Number(obj.runStartUs);
        if (obj.event) events[obj.event] = obj;
      } catch (e) {}
      return;
    }
    const m = line.match(/EVENT\s+([A-Z0-9_]+)(.*)$/);
    if (m && !events[m[1]]) {
      const kv = {};
      const re = /([a-zA-Z0-9_]+)=(?:"([^"]*)"|(\S+))/g;
      let k;
      while ((k = re.exec(m[2])) !== null) kv[k[1]] = k[2] ?? k[3];
      events[m[1]] = { event: m[1], ...kv };
    }
  });
  return { events, runStartUs };
};

// Hora de uma linha de log do Redis ("53331:M 22 Oct 2026 09:57:58.974 * ...") → epoch em ms.
// O Redis grava no fuso local da máquina, o mesmo do Node; precisão de milissegundo.
const REDIS_MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const redisLogLineMs = (line) => {
  const m = line.match(/(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (!m) return null;
  return new Date(+m[3], REDIS_MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6], +m[7]).getTime();
};

/**
 * Divide o preload e a recuperação em duas fases (ajuste de 22/10):
 *  - contagem: do evento *_STARTED até o Redis-IR abrir o cursor no log indexado
 *    (PRELOAD_INDEX_OPEN) — o Redis-IR conta registros/tuplas do log antes de ler;
 *  - leitura: de PRELOAD_INDEX_OPEN até *_COMPLETED — carga efetiva das tuplas na memória.
 * Também calcula a taxa de leitura (registros/s). Valores em segundos, ou null.
 */
const computeLoadPhases = (logText, ev) => {
  const n = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const opens = [];
  String(logText || "").split("\n").forEach((line) => {
    if (line.includes("PRELOAD_INDEX_OPEN")) {
      const ms = redisLogLineMs(line);
      const rec = line.match(/records=(\d+)/);
      if (ms !== null) opens.push({ ms, records: rec ? Number(rec[1]) : null });
    }
  });
  const phase = (startName, endName, untilName) => {
    const st = n(ev[startName]?.timestampUs), en = n(ev[endName]?.timestampUs);
    if (st === null || en === null) return null;
    const stMs = st / 1000, enMs = en / 1000;
    const limitMs = n(ev[untilName]?.timestampUs) !== null ? n(ev[untilName].timestampUs) / 1000 : Infinity;
    // tolerância de 1 ms: a hora da linha de log tem resolução de milissegundo
    const open = opens.find((o) => o.ms >= Math.floor(stMs) - 1 && o.ms <= enMs + 1 && o.ms < limitMs);
    if (!open) return null;
    const countS = Math.max(0, (open.ms - stMs) / 1000);
    const readS = Math.max(0, (enMs - open.ms) / 1000);
    const records = n(ev[endName]?.recordsProcessed) ?? open.records;
    return {
      countSeconds: parseFloat(countS.toFixed(3)),
      readSeconds: parseFloat(readS.toFixed(3)),
      readRecordsPerSecond: records && readS > 0 ? Math.round(records / readS) : null,
      records,
    };
  };
  return {
    preload: phase("PRELOAD_STARTED", "PRELOAD_COMPLETED", "FAILURE_TRIGGERED"),
    recovery: phase("RECOVERY_STARTED", "RECOVERY_COMPLETED", null),
  };
};

// Campos de results.json com as fases (mesmo formato no fim do ensaio e na reconstrução)
const loadPhaseFields = (phases) => ({
  preloadCountSeconds: phases.preload?.countSeconds ?? null,
  preloadReadSeconds: phases.preload?.readSeconds ?? null,
  preloadReadRecordsPerSecond: phases.preload?.readRecordsPerSecond ?? null,
  recoveryCountSeconds: phases.recovery?.countSeconds ?? null,
  recoveryReadSeconds: phases.recovery?.readSeconds ?? null,
  recoveryReadRecordsPerSecond: phases.recovery?.readRecordsPerSecond ?? null,
});

// CSV de comandos (key,command,startTime,finishTime,latency,type) → [[segundo, comandos]]
// Conta só comandos reais (type N ou A); ignora linhas de marco (Preload, Recovery, Benchmark),
// o cabeçalho repetido após o reinício e o "Database startup" (a referência é o primeiro).
const parseCommandsThroughput = (content, refUs = null) => {
  let ref = refUs;
  const perSec = {};
  String(content || "").split("\n").forEach((line) => {
    const row = line.split(",");
    if (row[0] === "Database startup" && ref === null) { ref = parseInt(row[2], 10) || null; return; }
    if (row.length < 6) return;
    const type = (row[5] || "").trim();
    if (type !== "N" && type !== "A") return;
    const t = parseInt(row[3], 10) || parseInt(row[2], 10);
    if (!t || ref === null) return;
    const sec = Math.floor((t - ref) / 1000000);
    if (sec >= 0) perSec[sec] = (perSec[sec] || 0) + 1;
  });
  return Object.keys(perSec).map((k) => [parseInt(k, 10), perSec[k]]).sort((a, b) => a[0] - b[0]);
};

// CSV de monitoramento (time;cpu;memory, memória em KiB, CPU com vírgula decimal) → [[segundo, cpu%, memKiB]]
const parseMonitoring = (content, refUs = null) => {
  let ref = refUs;
  const out = [];
  String(content || "").split("\n").forEach((line) => {
    const row = line.split(";");
    if (row[0] === "Database startup" && ref === null) { ref = parseInt(row[2], 10) || null; return; }
    if (row.length < 3 || !/^\d+$/.test(row[0]) || ref === null) return;
    const cpu = parseFloat(String(row[1]).replace(",", "."));
    const mem = parseFloat(String(row[2]).replace(",", "."));
    if (isNaN(cpu) || isNaN(mem)) return;
    out.push([parseFloat(((parseInt(row[0], 10) - ref) / 1000000).toFixed(3)), cpu, mem]);
  });
  return out.sort((a, b) => a[0] - b[0]);
};

const app = express();
app.use(cors({
  origin: '*'
}));

const port = 8081;

// start react app
const reactApp = path.join(__dirname, './web');

// listar diretórios do react app
const directories = fs.readdirSync(reactApp)
// se não existir node_modules, instalar as dependências
if (!directories.includes('node_modules')) {
  child_process.execSync('npm install', {
    cwd: reactApp
  })
  child_process.execSync('npm install', {
    cwd: reactApp
  })
}

const reactProcess = child_process.spawn('npm', ['run', 'dev'], {
  cwd: reactApp,
})

reactProcess.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);
});

const rootPath = __dirname;

// Caminhos dos arquivos a serem processados
const inputPath = path.join(rootPath, "src/datasets/datasets.csv");
const pathCpu = path.join(rootPath, "src/system_monitoring/system_monitoring.csv");

// Monitor de arquivos resiliente com tolerância a exclusão, recriação e truncamento
const setupTailWatcher = (filePath, onLineCallback) => {
  let tailInstance = null;
  let retryTimeout = null;
  let isClosed = false;

  const startTailing = () => {
    if (isClosed) return;

    if (!fs.existsSync(filePath)) {
      scheduleRetry();
      return;
    }

    try {
      tailInstance = new Tail(filePath, { follow: true });

      tailInstance.on("line", (data) => {
        if (!isClosed) {
          onLineCallback(data);
        }
      });

      tailInstance.on("error", (error) => {
        cleanupTail();
        scheduleRetry();
      });
    } catch (err) {
      cleanupTail();
      scheduleRetry();
    }
  };

  const cleanupTail = () => {
    if (tailInstance) {
      try {
        tailInstance.unwatch();
      } catch (e) {
        // ignore
      }
      tailInstance = null;
    }
  };

  const scheduleRetry = () => {
    if (isClosed || retryTimeout) return;
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      if (fs.existsSync(filePath)) {
        startTailing();
      } else {
        scheduleRetry();
      }
    }, 500); // Tenta reconectar a cada 500ms
  };

  startTailing();

  return {
    close: () => {
      isClosed = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      cleanupTail();
    }
  };
};

/**
 * Identificador legível do experimento, a partir da data e hora de início no fuso de São Paulo:
 * run_AAAAMMDD_HHMMSS (ex.: run_20261022_105332). Ordena cronologicamente como texto.
 * Se já existir uma pasta com o mesmo segundo, acrescenta _2, _3...
 */
const makeRunId = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const base = `run_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
  const runsDir = path.join(rootPath, "src/runs");
  let id = base, n = 2;
  while (fs.existsSync(path.join(runsDir, id)) || fs.existsSync(path.join(runsDir, "_archive", id))) id = `${base}_${n++}`;
  return id;
};

// Resultado da última restauração da base (registrado no metadata.json do experimento)
let lastBaseRestore = null;

/**
 * Há um Redis respondendo na porta 6379? (conexão TCP aceita = processo vivo, mesmo travado no SHUTDOWN)
 */
const redisPortInUse = () => new Promise((resolve) => {
  const sock = net.createConnection({ host: "127.0.0.1", port: 6379 });
  const done = (v) => { try { sock.destroy(); } catch (e) {} resolve(v); };
  sock.setTimeout(1000, () => done(true));
  sock.once("connect", () => done(true));
  sock.once("error", () => done(false));
});

/**
 * Garante que nenhum redis-server ficou de pé, SEM bloquear o Node.
 *
 * Problema observado (21/10): depois de EXPERIMENT_COMPLETED o Redis-IR recebe SHUTDOWN, grava os
 * relatórios e fica preso esperando as threads (stopThredas/cancelIRThreads; o indexador pode estar
 * processando um lote grande do log). O processo continua vivo segurando a porta 6379:
 *  - o antigo /stop (execSync sem tempo limite) travava o Node inteiro → "Backend disconnected";
 *  - o Load database seguinte subia outro Redis-IR, que saía na hora (porta ocupada) →
 *    "Redis-IR exited before memtier finished".
 * Agora: pede SHUTDOWN; se a porta não liberar em graceMs, mata à força (SIGKILL) quem a ocupa.
 * Os resultados do experimento já foram gravados antes disso, e a base é restaurada do backup a
 * cada START, então matar o processo aqui não perde dados do experimento.
 */
const ensureRedisDown = async (reason, { graceMs = 6000 } = {}) => {
  const run = currentRun;
  if (!(await redisPortInUse())) {
    console.log(`REDIS_ALREADY_DOWN reason=${reason}`);
    return true;
  }
  console.log(`REDIS_STOP_REQUESTED reason=${reason}`);
  child_process.execFile('./redis-cli', ['shutdown'], { cwd: path.join(rootPath, 'src'), timeout: 5000 }, (err) => {
    if (err) console.warn(`redis-cli shutdown (${reason}): ${err.killed ? "sem resposta em 5 s" : err.message.split("\n")[0]}`);
  });
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (!(await redisPortInUse())) { console.log(`REDIS_STOPPED reason=${reason}`); return true; }
  }
  console.warn(`REDIS_FORCE_KILL reason=${reason}: redis-server não encerrou em ${graceMs / 1000} s (preso no SHUTDOWN)`);
  if (run && run.child && run.child.exitCode === null) { try { run.child.kill('SIGKILL'); } catch (e) {} }
  if (prepChildRef && prepChildRef.exitCode === null) { try { prepChildRef.kill('SIGKILL'); } catch (e) {} }
  await new Promise((r) => child_process.execFile('fuser', ['-k', '-KILL', '6379/tcp'], () => r()));
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (!(await redisPortInUse())) { console.log(`REDIS_KILLED reason=${reason}`); return true; }
  }
  console.error(`REDIS_STILL_RUNNING reason=${reason}: a porta 6379 continua ocupada`);
  return false;
};

/** Compatibilidade: chamada sem esperar o resultado */
const stopRedisServer = (reason) => { ensureRedisDown(reason).catch((e) => console.error("ensureRedisDown:", e)); };

// Rotina síncrona de higienização do pipeline antes de novos experimentos
const sanitizePipeline = () => {
  console.log("Iniciando higienização do pipeline (sanitizePipeline)...");

  // a) Derrubar processos remanescentes/zumbis nas portas críticas (6379)
  try {
    child_process.execSync("fuser -k 6379/tcp", { stdio: "ignore" });
    console.log("Processos remanescentes na porta 6379 (Redis) derrubados.");
  } catch (e) {
    // ignorar se a porta já estiver livre
  }

  // Derrubar processos remanescentes na porta 8081 (preservando o processo atual do Node)
  try {
    const ourPid = process.pid.toString();
    const stdout = child_process.execSync("lsof -t -i tcp:8081 -sTCP:LISTEN").toString().trim();
    if (stdout) {
      const pids = stdout.split("\n")
        .map(p => p.trim())
        .filter(p => p && p !== ourPid);
      for (const pid of pids) {
        console.log(`Derrubando processo zumbi na porta 8081 com PID: ${pid}`);
        child_process.execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      }
    }
  } catch (e) {
    // ignorar
  }

  // b) Restaurar a base experimental do backup a CADA início de experimento.
  //    Cada execução acrescenta registros ao log sequencial e ao log indexado (o memtier do
  //    experimento grava nele); sem esta restauração o preload do experimento seguinte
  //    processaria uma base maior e os tempos deixariam de ser comparáveis.
  const logsDir = path.join(rootPath, "src/logs");
  const backupDir = path.join(rootPath, "src/backups");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const indexedLogFile = path.join(logsDir, "indexedLog.db");
  const sequentialLogFile = path.join(logsDir, "sequentialLog.aof");
  const backupIndexedLog = path.join(backupDir, "indexedLog.db.bak");
  const backupSequentialLog = path.join(backupDir, "sequentialLog.aof.bak");

  lastBaseRestore = { restored: false, at: new Date().toISOString(), durationMs: null, error: null };
  if (fs.existsSync(backupIndexedLog) && fs.statSync(backupIndexedLog).size > 8192) {
    const t0 = Date.now();
    try {
      fs.copyFileSync(backupIndexedLog, indexedLogFile);
      // Cópia interna usada pela auto-restauração do Redis-IR em caso de corrupção
      fs.copyFileSync(backupIndexedLog, `${indexedLogFile}.bak`);

      if (fs.existsSync(backupSequentialLog)) {
        fs.copyFileSync(backupSequentialLog, sequentialLogFile);
      } else {
        fs.writeFileSync(sequentialLogFile, "");
      }

      // Ponteiro do indexador = fim do log sequencial restaurado (a base do backup já está
      // inteiramente indexada). Grava como unsigned long long little-endian, igual ao C.
      const seekBuf = Buffer.alloc(8);
      seekBuf.writeBigUInt64LE(BigInt(fs.statSync(sequentialLogFile).size));
      fs.writeFileSync(path.join(logsDir, "finalLogSeek.dat"), seekBuf);
      ["checkpointLogSeek.dat", "finalLogSeekReplica.dat"].forEach((f) => {
        const p = path.join(logsDir, f);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
      });

      const copyMs = Date.now() - t0;
      // Ajuste de 22/10: força a gravação no disco das cópias recém-feitas antes do START.
      // Sem isso o kernel grava essas páginas durante o preload, disputando o disco com a
      // leitura do log indexado (preload da base Média variou de 4,5 s a 14,4 s).
      // O log continua no cache do sistema (cache quente); o sync só tira a escrita pendente.
      let syncMs = null;
      try {
        const ts = Date.now();
        child_process.execSync("sync", { stdio: "ignore", timeout: 300000 });
        syncMs = Date.now() - ts;
      } catch (e) {
        console.warn("sync após restaurar a base falhou:", e.message);
      }
      lastBaseRestore = { restored: true, at: new Date().toISOString(), durationMs: copyMs, syncDurationMs: syncMs, error: null };
      console.log(`BASE_RESTORED_FROM_BACKUP indexedLog=${fs.statSync(indexedLogFile).size}B aof=${fs.statSync(sequentialLogFile).size}B copy=${copyMs}ms sync=${syncMs}ms`);
    } catch(e) {
      lastBaseRestore.error = e.message;
      console.error("Erro ao restaurar backup:", e.message);
    }
  } else {
    console.warn("BASE_NOT_RESTORED reason=no-backup (use o Load database para gerar a base experimental)");
  }

  // Limpar marcadores de execução anterior (runStartUs, runId e falha)
  const tempIrDir = path.join(rootPath, "src/temp_ir_files");
  // failureTriggeredfile.dat é o nome real do marcador (src/server.h: FAILURE_TRIGGERED_FILE)
  // preloadSystemfile.dat = contador de reinícios do modo preload (src/server.h: DATABASE_PRELOAD_FILE);
  // restartCounter2.dat = contador de reinícios da falha POR TEMPO (RESTART_COUNTER2);
  // restartCounter.dat = contador de reinícios após o benchmark (RESTART_COUNTER).
  // Se um experimento for interrompido antes da falha, o contador fica em 0 no disco e o
  // experimento seguinte lê 0 = "reinícios esgotados": restartSystem() apaga o arquivo e NÃO
  // arma o temporizador — a falha simulada nunca acontece (visto em 22/10 com a base X-Large).
  ["run_start.dat", "run_id.dat", "failure_triggered.dat", "failureTriggeredfile.dat", "preloadSystemfile.dat",
   "restartCounter.dat", "restartCounter2.dat"].forEach(fName => {
    const fPath = path.join(tempIrDir, fName);
    try {
      if (fs.existsSync(fPath)) {
        fs.unlinkSync(fPath);
        console.log(`Removido marcador de execução anterior: ${fPath}`);
      }
    } catch(e) {}
  });

  // c) Garantir a criação das pastas e instanciar um arquivo de dataset totalmente limpo
  const datasetDir = path.join(rootPath, "src/datasets");
  const datasetFile = path.join(datasetDir, "datasets.csv");
  try {
    if (!fs.existsSync(datasetDir)) {
      fs.mkdirSync(datasetDir, { recursive: true });
    }
    fs.writeFileSync(datasetFile, "");
    console.log(`Dataset limpo e instanciado em: ${datasetFile}`);
  } catch (e) {
    console.error(`Erro ao criar dataset limpo: ${e.message}`);
  }

  // Garantir a limpeza/criação do arquivo de monitoramento do sistema
  const monitoringDir = path.join(rootPath, "src/system_monitoring");
  const monitoringFile = path.join(monitoringDir, "system_monitoring.csv");
  try {
    if (!fs.existsSync(monitoringDir)) {
      fs.mkdirSync(monitoringDir, { recursive: true });
    }
    fs.writeFileSync(monitoringFile, "");
    console.log(`Monitoramento limpo e instanciado em: ${monitoringFile}`);
  } catch (e) {
    console.error(`Erro ao criar monitoramento limpo: ${e.message}`);
  }
};

// Variáveis de controle
let lendoArquivo = false; // Variável de controle para verificar se o arquivo está sendo lido

let activeConfig = {};
// runId do Redis-IR do experimento ativo (usado nas mensagens de telemetria)
let currentRunId = null;
// Contexto do experimento ativo: { folderId, redisRunId, runDir, logs, config, child, finalized, ... }
let currentRun = null;
const currentRunIdGlobalReset = () => { currentRunId = null; };

// Finaliza UM experimento específico (contexto `run`), nunca "o atual": o aviso de término do
// processo pode chegar depois que outro experimento já começou.
const finalizeRunResults = (run, reason = "process-exit") => {
  if (!run || run.finalized || !run.runDir) return null;
  run.finalized = true;
  const currentRunDir = run.runDir;
  const currentRunLogs = run.logs;
  const activeConfig = run.config || {};
  const currentRunId = run.redisRunId || run.folderId;
  console.log(`Finalizando resultados do ensaio: ${currentRunId} (motivo: ${reason})`);

  // 1. Copia arquivos CSV se existirem
  const datasetsSrc = path.join(rootPath, "src", activeConfig.executedCommandsCsvFilename || "datasets/datasets.csv");
  const datasetsDest = path.join(currentRunDir, "datasets.csv");
  try {
    if (fs.existsSync(datasetsSrc)) {
      fs.copyFileSync(datasetsSrc, datasetsDest);
      console.log(`CSV de comandos copiado para: ${datasetsDest}`);
    }
  } catch (e) {
    console.error(`Erro ao copiar datasets.csv para o ensaio ${currentRunId}:`, e.message);
  }

  const monitoringSrc = path.join(rootPath, "src", activeConfig.systemMonitoringCsvFilename || "system_monitoring/system_monitoring.csv");
  const monitoringDest = path.join(currentRunDir, "system_monitoring.csv");
  try {
    if (fs.existsSync(monitoringSrc)) {
      fs.copyFileSync(monitoringSrc, monitoringDest);
      console.log(`CSV de monitoramento copiado para: ${monitoringDest}`);
    }
  } catch (e) {
    console.error(`Erro ao copiar system_monitoring.csv para o ensaio ${currentRunId}:`, e.message);
  }

  const indexingSrc = path.join(rootPath, "src", activeConfig.indexingReportCsvFilename || "indexing_report/indexing.csv");
  const indexingDest = path.join(currentRunDir, "indexing.csv");
  try {
    if (fs.existsSync(indexingSrc)) {
      fs.copyFileSync(indexingSrc, indexingDest);
      console.log(`CSV de indexação copiado para: ${indexingDest}`);
    }
  } catch (e) {
    console.error(`Erro ao copiar indexing.csv para o ensaio ${currentRunId}:`, e.message);
  }

  // 2. Analisa logs para identificar marcos de falha/recuperação e metadados científicos
  let failureTimes = { utc: null, local: null };
  let recoveryStartTimes = { utc: null, local: null };
  let recoveryEndTimes = { utc: null, local: null };
  let stabilityTimes = { utc: null, local: null };
  let recoveryDuration = null;

  let recoveredTuples = null;
  let incrementalTuples = null;
  let onDemandTuples = null;
  let recordsProcessed = null;
  let inconsistencies = null;
  let recoveryOperationNature = null;

  let runStartUs = null;
  const phase3Events = {};

  const fullLogs = currentRunLogs.join("\n");
  const logLines = fullLogs.split("\n");

  logLines.forEach((log) => {
    const text = log.toLowerCase();

    // Parse EVENT_JSON
    if (log.includes("EVENT_JSON ")) {
      try {
        const jsonStr = log.substring(log.indexOf("EVENT_JSON ") + 11).trim();
        const evtObj = JSON.parse(jsonStr);
        if (evtObj.runStartUs && !runStartUs) {
          runStartUs = parseInt(evtObj.runStartUs);
        }
        if (evtObj.event) {
          phase3Events[evtObj.event] = evtObj;
        }
      } catch (e) {
        // ignore
      }
    }

    // Parse text EVENT line if EVENT_JSON not present
    if (log.includes("EVENT ")) {
      const nameMatch = log.match(/EVENT\s+([A-Z0-9_]+)/);
      const tsMatch = log.match(/timestampUs=(\d+)/) || log.match(/timestamp=(\d+)/);
      const rsMatch = log.match(/runStartUs=(\d+)/);
      const durMatch = log.match(/durationMs=([\d\.]+)/);
      const relMatch = log.match(/relativeMs=([\d\.]+)/);

      if (nameMatch) {
        const evName = nameMatch[1];
        if (!phase3Events[evName]) {
          const tsUs = tsMatch ? parseInt(tsMatch[1]) : null;
          const rsUs = rsMatch ? parseInt(rsMatch[1]) : runStartUs;
          if (rsUs && !runStartUs) runStartUs = rsUs;

          const relMs = relMatch ? parseFloat(relMatch[1]) : ((tsUs && rsUs) ? (tsUs - rsUs) / 1000.0 : null);
          const durMs = durMatch ? parseFloat(durMatch[1]) : null;

          phase3Events[evName] = {
            event: evName,
            timestampUs: tsUs,
            runStartUs: rsUs,
            relativeMs: relMs,
            durationMs: durMs
          };
        }
      }
    }

    const redisTimeRegex = /^\d+:[M|S|C]\s+([\d\s\w\:\.]+)\s+[\*\#\-]/;
    const matchTime = log.match(redisTimeRegex);
    
    let dateObj = new Date();
    if (matchTime) {
      const parsed = Date.parse(matchTime[1] + " GMT-0300");
      if (!isNaN(parsed)) {
        dateObj = new Date(parsed);
      }
    }
    const times = getTimestamps(dateObj);

    if (text.includes("loading the database from")) {
      recoveryStartTimes = times;
      if (text.includes("indexed log")) {
        recoveryOperationNature = "Recuperação via MM-DIRECT (B-Tree)";
      } else if (text.includes("aof") || text.includes("append only file") || text.includes("sequential log")) {
        recoveryOperationNature = "Recuperação Tradicional (AOF)";
      }
    } else if (text.includes("user requested shutdown") || text.includes("redis is now ready to exit")) {
      failureTimes = times;
    } else if (text.includes("db loaded from indexed log") || text.includes("db loaded from aof") || text.includes("db loaded from append only file")) {
      recoveryEndTimes = times;
      const match = log.match(/loaded from (Indexed Log|AOF):\s*([\d\.]+)\s*seconds/i);
      if (match) {
        recoveryDuration = parseFloat(match[2]);
      } else {
        const matchDisk = log.match(/loaded from disk:\s*([\d\.]+)\s*seconds/i);
        if (matchDisk) recoveryDuration = parseFloat(matchDisk[1]);
        const matchAof = log.match(/loaded from append only file:\s*([\d\.]+)\s*seconds/i);
        if (matchAof) recoveryDuration = parseFloat(matchAof[1]);
      }

      if (text.includes("indexed log")) {
        recoveryOperationNature = "Recuperação via MM-DIRECT (B-Tree)";
      } else {
        recoveryOperationNature = "Recuperação Tradicional (AOF)";
      }

      const tuplesMatch = log.match(/number of tuples loaded into memory:\s*(\d+)/i);
      if (tuplesMatch) {
        recoveredTuples = parseInt(tuplesMatch[1]);
      }
      const incrMatch = log.match(/inclementally\s*=\s*(\d+)/i);
      if (incrMatch) {
        incrementalTuples = parseInt(incrMatch[1]);
      }
      const onDemandMatch = log.match(/on-demand\s*=\s*(\d+)/i);
      if (onDemandMatch) {
        onDemandTuples = parseInt(onDemandMatch[1]);
      }
      const recordsMatch = log.match(/number of records processed:\s*(\d+)/i);
      if (recordsMatch) {
        recordsProcessed = parseInt(recordsMatch[1]);
      } else {
        const aofRecordsMatch = log.match(/records processed from sequential log\s*=\s*(\d+)/i);
        if (aofRecordsMatch) {
          recordsProcessed = parseInt(aofRecordsMatch[1]);
        }
      }
      const inconsistenciesMatch = log.match(/inconsistenes:\s*(\d+)/i);
      if (inconsistenciesMatch) {
        inconsistencies = parseInt(inconsistenciesMatch[1]);
      }
    } else if (text.includes("ready to accept connections")) {
      stabilityTimes = times;
    }
  });

  if (!recoveryOperationNature) {
    recoveryOperationNature = (activeConfig.instantRecoveryState || "ON").toUpperCase() === "ON" ? "Recuperação via MM-DIRECT (B-Tree)" : "Recuperação Tradicional (AOF)";
  }

  // Medição de tamanhos físicos dos arquivos de banco
  let aofSizeBytes = null;
  let indexedLogSizeBytes = null;
  const aofPath = path.join(rootPath, "src", activeConfig.aofFilename || "logs/sequentialLog.aof");
  const indexedLogPath = path.join(rootPath, "src", activeConfig.indexedlogFilename || "logs/indexedLog.db");

  try {
    if (fs.existsSync(aofPath)) {
      aofSizeBytes = fs.statSync(aofPath).size;
    }
  } catch (err) {
    console.error("Erro ao ler tamanho do AOF:", err.message);
  }

  try {
    if (fs.existsSync(indexedLogPath)) {
      indexedLogSizeBytes = fs.statSync(indexedLogPath).size;
    }
  } catch (err) {
    console.error("Erro ao ler tamanho do Indexed Log DB:", err.message);
  }

  // Calcula duração baseada exclusivamente nos marcos UTC
  if (recoveryStartTimes.utc && recoveryEndTimes.utc) {
    const startMs = Date.parse(recoveryStartTimes.utc);
    const endMs = Date.parse(recoveryEndTimes.utc);
    if (!isNaN(startMs) && !isNaN(endMs) && isFinite(startMs) && isFinite(endMs)) {
      recoveryDuration = parseFloat(((endMs - startMs) / 1000).toFixed(3));
    }
  }

  // Phase 3 structured event & duration calculation
  const preloadEvt = phase3Events["PRELOAD_COMPLETED"];
  const recoveryEvt = phase3Events["RECOVERY_COMPLETED"];
  const stableEvt = phase3Events["STABLE_OPERATION_STARTED"];
  const failureEvt = phase3Events["FAILURE_TRIGGERED"];

  const preloadMs = preloadEvt?.durationMs ?? (preloadEvt?.timestampUs && phase3Events["PRELOAD_STARTED"]?.timestampUs ? (preloadEvt.timestampUs - phase3Events["PRELOAD_STARTED"].timestampUs) / 1000.0 : null);
  // Recuperação só existe se houve RECOVERY_COMPLETED. Antes caía no tempo lido do texto do log
  // ("DB loaded from Indexed Log"), que também aparece no PRELOAD — e o preload era exibido como recuperação.
  const recoveryMs = recoveryEvt ? (recoveryEvt.durationMs ?? (recoveryEvt.timestampUs && phase3Events["RECOVERY_STARTED"]?.timestampUs ? (recoveryEvt.timestampUs - phase3Events["RECOVERY_STARTED"].timestampUs) / 1000.0 : null)) : null;
  const stableOperationMs = (failureEvt?.timestampUs && stableEvt?.timestampUs) ? (failureEvt.timestampUs - stableEvt.timestampUs) / 1000.0 : null;

  // Status pelos eventos (antes: "Estável" sempre que o Redis aceitava conexões, ou seja, em toda execução)
  const experimentStatus = computeExperimentStatus(phase3Events);
  const num = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v))) ? null : Number(v);

  const results = {
    id: currentRunId,
    runId: currentRunId,
    runStartUs: runStartUs || phase3Events["PRELOAD_STARTED"]?.timestampUs || phase3Events["RECOVERY_STARTED"]?.timestampUs || null,
    events: {
      preloadStart: phase3Events["PRELOAD_STARTED"] || null,
      preloadEnd: phase3Events["PRELOAD_COMPLETED"] || null,
      stableOperationStart: phase3Events["STABLE_OPERATION_STARTED"] || null,
      failureTimerStart: phase3Events["FAILURE_TIMER_STARTED"] || null,
      failureTriggered: phase3Events["FAILURE_TRIGGERED"] || null,
      recoveryStart: phase3Events["RECOVERY_STARTED"] || null,
      recoveryEnd: phase3Events["RECOVERY_COMPLETED"] || null,
      workloadResumed: phase3Events["WORKLOAD_RESUMED"] || null,
      postRecoveryStable: phase3Events["POST_RECOVERY_STABLE"] || null,
      workloadFinished: phase3Events["WORKLOAD_FINISHED"] || null,
      workloadStopped: phase3Events["WORKLOAD_STOPPED"] || null,
      experimentCompleted: phase3Events["EXPERIMENT_COMPLETED"] || null,
      experimentFailed: phase3Events["EXPERIMENT_FAILED"] || null
    },
    durations: {
      preloadMs,
      stableOperationMs,
      recoveryMs
    },
    timestamp: getTimestamps().utc,
    timestampLocal: getTimestamps().local,
    timezone: "America/Sao_Paulo",
    milestones: {
      failureAtUtc: failureTimes.utc,
      failureAtLocal: failureTimes.local,
      recoveryStartAtUtc: recoveryStartTimes.utc,
      recoveryStartAtLocal: recoveryStartTimes.local,
      recoveryEndAtUtc: recoveryEndTimes.utc,
      recoveryEndAtLocal: recoveryEndTimes.local,
      stabilityAtUtc: stabilityTimes.utc,
      stabilityAtLocal: stabilityTimes.local
    },
    // Fonte: eventos estruturados (durationMs). null quando não houve falha/recuperação.
    recoveryDurationSeconds: recoveryMs !== null ? parseFloat((recoveryMs / 1000).toFixed(3)) : null,
    preloadDurationSeconds: preloadMs !== null && preloadMs !== undefined ? parseFloat((preloadMs / 1000).toFixed(3)) : null,
    stableOperationSeconds: stableOperationMs !== null ? parseFloat((stableOperationMs / 1000).toFixed(3)) : null,
    // logs.txt tem a saída bruta, sem quebrar linhas entre blocos do stdout
    ...loadPhaseFields(computeLoadPhases((() => { try { return fs.readFileSync(path.join(currentRunDir, "logs.txt"), "utf-8"); } catch (e) { return fullLogs; } })(), phase3Events)),
    experimentStatus,
    // Compatibilidade com o HistoryPanel atual: "Estável" passa a significar experimento completo
    status: experimentStatus === "Completed" ? "Estável" : "Interrompido",
    preloadedTuples: num(preloadEvt?.loadedTuples),
    finalizedBy: reason,
    finalizedAt: new Date().toISOString(),
    reconstructed: false,
    recoveredTuples: recoveryEvt ? num(recoveryEvt.loadedTuples) : null,
    incrementalTuples: recoveryEvt ? incrementalTuples : null,
    onDemandTuples: recoveryEvt ? onDemandTuples : null,
    // Registros e inconsistências da recuperação (eventos); sem falha, os do preload
    recordsProcessed: num((recoveryEvt || preloadEvt)?.recordsProcessed) ?? recordsProcessed,
    inconsistencies: num((recoveryEvt || preloadEvt)?.inconsistencies) ?? inconsistencies,
    recoveryOperationNature,
    aofSizeBytes,
    indexedLogSizeBytes,
    eventList: parseEventListFromLog(fullLogs),
  };

  try {
    fs.writeFileSync(path.join(currentRunDir, "results.json"), JSON.stringify(results, null, 2));
    console.log("Arquivo results.json gerado com sucesso!");
  } catch (err) {
    console.error("Erro ao gravar results.json:", err.message);
  }

  // 3. Calcula as métricas científicas consolidadas para o report.json
  let peakThroughput = 0;
  let averageThroughput = 0;
  let totalCommands = 0;

  if (fs.existsSync(datasetsDest)) {
    try {
      const perSec = parseCommandsThroughput(fs.readFileSync(datasetsDest, "utf-8"));
      const counts = perSec.map(([, c]) => c);
      if (counts.length > 0) {
        totalCommands = counts.reduce((acc, curr) => acc + curr, 0);
        peakThroughput = counts.reduce((m, c) => Math.max(m, c), 0);
        averageThroughput = parseFloat((totalCommands / counts.length).toFixed(2));
      }
    } catch (e) {
      console.error("Erro ao computar sumário de throughput:", e.message);
    }
  }

  let peakCpu = 0;
  let averageCpu = 0;
  let peakMemory = 0;
  let averageMemory = 0;

  if (fs.existsSync(monitoringDest)) {
    try {
      const fileContent = fs.readFileSync(monitoringDest, "utf-8");
      const lines = fileContent.split("\n");
      const cpus = [];
      const mems = [];

      lines.forEach((lineText) => {
        const row = lineText.split(";");
        if (row.length < 3) return;
        if (row[0].match(/^\d+$/)) {
          // o top usa vírgula decimal ("69,2"): sem o replace, parseFloat devolvia 69
          const c = parseFloat(String(row[1]).replace(",", "."));
          const m = parseFloat(String(row[2]).replace(",", "."));
          if (!isNaN(c) && !isNaN(m)) { cpus.push(c); mems.push(m); }
        }
      });

      if (cpus.length > 0) {
        peakCpu = Math.max(...cpus);
        const sumCpu = cpus.reduce((acc, curr) => acc + curr, 0);
        averageCpu = parseFloat((sumCpu / cpus.length).toFixed(2));
      }
      if (mems.length > 0) {
        const memsMb = mems.map(m => m / 1024);
        peakMemory = Math.max(...memsMb);
        const sumMem = memsMb.reduce((acc, curr) => acc + curr, 0);
        averageMemory = parseFloat((sumMem / memsMb.length).toFixed(2));
      }
    } catch (e) {
      console.error("Erro ao computar sumário de CPU/Memória:", e.message);
    }
  }

  // 4. Grava report.json no diretório export/
  const exportDir = path.join(currentRunDir, "export");
  try {
    fs.mkdirSync(exportDir, { recursive: true });
  } catch (e) {}

  const metadataPath = path.join(currentRunDir, "metadata.json");
  let startedAtUtc = getTimestamps().utc;
  let startedAtLocal = getTimestamps().local;
  if (fs.existsSync(metadataPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      startedAtUtc = meta.timestamp;
      startedAtLocal = meta.timestampLocal || getTimestamps(new Date(meta.timestamp)).local;
    } catch (e) {}
  }

  const report = {
    runId: currentRunId,
    mode: (activeConfig.instantRecoveryState || "ON").toUpperCase() === "ON" ? "MM-DIRECT (B-Tree)" : "Tradicional (AOF)",
    timezone: "America/Sao_Paulo",
    startedAtUtc,
    startedAtLocal,
    failureAtUtc: failureTimes.utc,
    failureAtLocal: failureTimes.local,
    recoveryStartAtUtc: recoveryStartTimes.utc,
    recoveryStartAtLocal: recoveryStartTimes.local,
    recoveryEndAtUtc: recoveryEndTimes.utc,
    recoveryEndAtLocal: recoveryEndTimes.local,
    stabilityAtUtc: stabilityTimes.utc,
    stabilityAtLocal: stabilityTimes.local,
    recoveryDurationSeconds: results.recoveryDurationSeconds,
    preloadDurationSeconds: results.preloadDurationSeconds,
    stableOperationSeconds: results.stableOperationSeconds,
    experimentStatus: results.experimentStatus,
    status: results.status,
    config: activeConfig,
    throughputSummary: {
      peakThroughput,
      averageThroughput,
      totalCommands
    },
    cpuSummary: {
      peakCpu,
      averageCpu
    },
    memorySummary: {
      peakMemory,
      averageMemory
    },
    recoveredTuples: results.recoveredTuples,
    incrementalTuples: results.incrementalTuples,
    onDemandTuples: results.onDemandTuples,
    recordsProcessed: results.recordsProcessed,
    inconsistencies: results.inconsistencies,
    recoveryOperationNature,
    aofSizeBytes,
    indexedLogSizeBytes
  };

  try {
    fs.writeFileSync(path.join(exportDir, "report.json"), JSON.stringify(report, null, 2));
    console.log("Relatório export/report.json gerado com sucesso!");
  } catch (err) {
    console.error("Erro ao gravar report.json:", err.message);
  }

  // Libera o "experimento ativo" apenas se ainda for este
  if (currentRun === run) {
    currentRun = null;
    currentRunIdGlobalReset();
  }

  return results;
};

const server = app.listen(port, () => {
  console.log(`rota para configuração do arquivo redis_ir.conf: http://localhost:${port}/config`);
  // Recupera resultados de experimentos que terminaram sem results.json
  try { reconstructMissingResults(); } catch (e) { console.error("Erro na reconstrução de resultados:", e.message); }
});

// Criar um servidor WebSocket

// --- Telemetry Instrumentation ---
const telemetryCounters = { data: 0, cpu: 0, memory: 0, latencia: 0 };
const firstPacketSent = { data: false, cpu: false, memory: false, latencia: false };

function sendTelemetry(ws, payload) {
    if (ws.readyState !== 1) return;
    const channel = payload.channel;
    if (!firstPacketSent[channel]) {
        console.log(`WS_FIRST_PACKET channel=${channel} payload=${JSON.stringify(payload)}`);
        firstPacketSent[channel] = true;
    }
    telemetryCounters[channel] = (telemetryCounters[channel] || 0) + 1;
    if (telemetryCounters[channel] % 100 === 0) {
        console.log(`WS_SENT channel=${channel} count=${telemetryCounters[channel]}`);
    }
    ws.send(JSON.stringify(payload));
}
// ----------------------------------

const wss = new WebSocketServer({ noServer: true });

function handleStart(ws) {
    // Não inicia experimento enquanto a base estiver sendo preparada (Load database):
    // o sanitizePipeline derrubaria o Redis da preparação no meio da geração.
    if (prepState.phase === "running") {
      console.warn("START_REJECTED reason=database-preparation-running");
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "EVENT", event: "START_REJECTED", reason: "Database preparation in progress. Wait for Load database to finish." }));
        ws.close();
      }
      return;
    }

    // Se o experimento anterior ainda não foi finalizado (ex.: interrompido), finaliza-o AGORA,
    // antes que o sanitizePipeline limpe os CSVs compartilhados e derrube o Redis dele.
    if (currentRun && !currentRun.finalized) {
      console.warn(`RUN_FINALIZED_BEFORE_NEW_START runId=${currentRun.redisRunId || currentRun.folderId}`);
      finalizeRunResults(currentRun, "next-start");
    }

    sanitizePipeline();

    // 1. Cria diretório do ensaio
    const runId = makeRunId();
    const runDir = path.join(rootPath, "src/runs", runId);
    try {
      fs.mkdirSync(runDir, { recursive: true });
      console.log(`Diretório do ensaio criado em: ${runDir}`);
    } catch(err) {
      console.error("Erro ao criar diretório do ensaio:", err.message);
    }

    currentRunId = runId;
    // Contexto deste experimento: a finalização usa estes valores, nunca globais
    const run = {
      folderId: runId,
      redisRunId: null,
      runDir,
      logs: [],
      config: { ...activeConfig },
      child: null,
      finalized: false,
      completionHandled: false,
    };
    currentRun = run;

    // 2. Grava metadata.json
    const startTimes = getTimestamps();
    const metadata = {
      id: runId,
      timestamp: startTimes.utc,
      timestampLocal: startTimes.local,
      timezone: "America/Sao_Paulo",
      config: activeConfig,
      mode: (activeConfig.instantRecoveryState || "ON").toUpperCase() === "ON" ? "MM-DIRECT (B-Tree)" : "Tradicional (AOF)",
      initialExpectedState: "Carregando Banco",
      database: (() => {
        const m = readJson(DB_PATHS.backupMeta);
        return m ? {
          sizePreset: m.sizePreset || null,
          records: m.records ?? null,
          distinctTuples: m.distinctTuples ?? null,
          indexedLogSizeBytes: fileSize(DB_PATHS.indexedLog),
          generatedWith: m.memtierBenchmarkParameters || null,
          generatedAt: m.createdAt || null,
          restoredFromBackup: lastBaseRestore ? lastBaseRestore.restored : false,
          restoreDurationMs: lastBaseRestore ? lastBaseRestore.durationMs : null,
          syncDurationMs: lastBaseRestore ? (lastBaseRestore.syncDurationMs ?? null) : null
        } : null;
      })(),
      caminhos: {
        aof: path.join(rootPath, "src", activeConfig.aofFilename || "logs/sequentialLog.aof"),
        datasets: path.join(rootPath, "src", activeConfig.executedCommandsCsvFilename || "datasets/datasets.csv"),
        monitoring: path.join(rootPath, "src", activeConfig.systemMonitoringCsvFilename || "system_monitoring/system_monitoring.csv")
      }
    };

    try {
      fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
      console.log("Arquivo metadata.json gravado com sucesso!");
    } catch(err) {
      console.error("Erro ao gravar metadata.json:", err.message);
    }

    const redisServerPath = path.join(rootPath, 'src');
    // O Redis-IR usa RUN_ID como identificador do experimento (server.c lê getenv("RUN_ID"); o
    // ambiente é mantido no execve do reinício). Assim a pasta, a tela, os eventos e o PDF usam o
    // MESMO id; antes eram dois: run_<ms do Node> na pasta e run_<µs do Redis-IR> na tela.
    const child = child_process.spawn('./redis-server', [], { cwd: redisServerPath, env: Object.assign({}, process.env, { RUN_ID: runId }) });
    run.child = child;

    // A saída de erro do redis-server PRECISA ser lida. O memtier (iniciado pelo Redis-IR) herda
    // esse canal e escreve nele o progresso a cada segundo. Sem leitura, o buffer do pipe (64 KiB)
    // enche em alguns minutos, a escrita do memtier bloqueia e ele nunca termina: a carga acaba,
    // mas WORKLOAD_FINISHED e EXPERIMENT_COMPLETED não chegam (run_20261114_140403, 14/11/2026).
    // A última linha de progresso fica guardada em memtier_progress.log, na pasta do experimento.
    let lastStderr = "";
    child.stderr.on('data', (data) => {
      const text = data.toString();
      const parts = text.split(/[\r\n]+/).filter((l) => l.trim());
      if (parts.length) lastStderr = parts[parts.length - 1];
      if (!/\[RUN #\d+/.test(text)) {
        // Mensagens que não são o progresso do memtier (erros) vão para o log do experimento
        try { fs.appendFileSync(path.join(run.runDir, "logs.txt"), text.endsWith("\n") ? text : text + "\n"); } catch (e) {}
      }
    });
    const progressTimer = setInterval(() => {
      if (!lastStderr) return;
      try { fs.writeFileSync(path.join(run.runDir, "memtier_progress.log"), lastStderr + "\n"); } catch (e) {}
    }, 5000);
    child.on('exit', () => clearInterval(progressTimer));

    child.on('error', (err) => {
      console.error(`Erro ao iniciar o servidor Redis: ${err}`);
      if (ws.readyState === 1) {
        ws.send(`Erro ao iniciar o servidor Redis: ${err.message}`);
      }
    });

    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      
      // Sincroniza o runId do Node com o runId real gerado internamente pelo Redis-IR
      const runIdMatch = output.match(/RUN_STARTED runId=(\S+)/) || output.match(/RUN_CONTINUED_AFTER_FAILURE runId=(\S+)/);
      if (runIdMatch && runIdMatch[1] !== run.redisRunId) {
        run.redisRunId = runIdMatch[1];
        if (currentRun === run) currentRunId = run.redisRunId;
        console.log(`RUNID_SYNCED_FROM_REDIS runId=${run.redisRunId}`);
      }

      // Contagem real informada pelo Redis-IR ao abrir o log indexado (antes do preload).
      // Fica registrada junto com o tamanho do arquivo, para só ser exibida enquanto
      // o arquivo validado for o mesmo.
      const validatedMatch = output.match(/INDEXED_LOG_VALIDATED path=\S+ records=(\d+) distinct_tuples=(\d+)/);
      if (validatedMatch) {
        saveValidatedCounts(parseInt(validatedMatch[1], 10), parseInt(validatedMatch[2], 10), run.redisRunId || run.folderId);
      }

      const memtierErr = detectMemtierError(output);
      if (memtierErr && ws.readyState === 1) {
        // Linha no formato de evento que o ChartBoard já entende (estado FAILED + motivo)
        ws.send(`EVENT EXPERIMENT_FAILED reason="memtier_benchmark could not run: ${memtierErr.replace(/"/g, "'")}"`);
      }

      // Acumula logs locais do ensaio (na pasta DESTE experimento)
      run.logs.push(output);

      // Vigia: falha por tempo configurada, mas o Redis-IR não armou o temporizador
      // (FAILURE_TIMER_STARTED) logo após o início da operação estável.
      if (!run.failureWatchArmed && /"event":"STABLE_OPERATION_STARTED"/.test(output)) {
        run.failureWatchArmed = true;
        const c = run.config || {};
        const timeFailure = (c.enableRestartAfterTime === true || c.enableRestartAfterTime === "ON" || Number(c.restartAfterTime) > 0)
          && Number(c.numberRestartsAfterTime) > 0;
        if (timeFailure) {
          setTimeout(() => {
            if (run.finalized || run.logs.some((l) => l.includes('"event":"FAILURE_TIMER_STARTED"') || l.includes('"event":"FAILURE_TRIGGERED"'))) return;
            const msg = "WARNING: time-based failure is configured, but Redis-IR did not start the failure timer (FAILURE_TIMER_STARTED missing). The simulated failure will not happen in this run.";
            console.warn(`FAILURE_TIMER_MISSING runId=${run.redisRunId || run.folderId}`);
            try { fs.appendFileSync(path.join(run.runDir, "logs.txt"), msg + "\n"); } catch (e) {}
            if (ws.readyState === 1) ws.send(msg);
          }, 5000);
        }
      }
      try {
        fs.appendFileSync(path.join(run.runDir, "logs.txt"), output);
      } catch(err) {
        // Ignorar
      }

      // Fim do experimento: grava os resultados sem depender do botão End experiment.
      // Espera 2 s (o Redis-IR grava os CSVs em intervalos), desliga o Redis e finaliza no 'exit'.
      // Se o processo não sair em 10 s, finaliza mesmo assim.
      if (!run.completionHandled && /"event":"(EXPERIMENT_COMPLETED|EXPERIMENT_FAILED)"/.test(output)) {
        run.completionHandled = true;
        console.log(`EXPERIMENT_END_DETECTED runId=${run.redisRunId || run.folderId} — finalizing in 2 s`);
        setTimeout(() => {
          if (run.finalized) return;
          child_process.execFile('./redis-cli', ['shutdown'], { cwd: redisServerPath, timeout: 5000 }, (err) => {
            if (err) console.warn("Shutdown após conclusão falhou:", err.killed ? "sem resposta em 5 s" : err.message.split("\n")[0]);
          });
          setTimeout(() => {
            if (!run.finalized) {
              console.warn("Redis não encerrou em 10 s; finalizando o ensaio assim mesmo.");
              finalizeRunResults(run, "completion-timeout");
            }
            // Resultados já gravados: o redis-server preso no SHUTDOWN é encerrado à força
            if (child.exitCode === null && child.signalCode === null) {
              console.warn("REDIS_FORCE_KILL reason=completion: redis-server preso no SHUTDOWN");
              try { child.kill('SIGKILL'); } catch (e) {}
            }
          }, 10000);
        }, 2000);
      }

      if (ws.readyState === 1) {
        ws.send('Redis server started');
        ws.send(output);

        const regex2 = /Generating information about executed database commands .../;
        const regex3 = /Generating system monitoring .../;

        if (regex2.test(output)) {
          console.log('Gerando informações sobre os comandos do banco de dados executados ...');
          ws.send('Generating information database commands');
        }

        if (regex3.test(output)) {
          console.log('Gerando monitoramento do sistema ...');
          ws.send('Generating system monitoring');
        }
      }
    });

    child.on('exit', (code, signal) => {
      console.log(`Processo redis-server encerrado com código ${code} e sinal ${signal}`);
      if (ws.readyState === 1) {
        ws.send(`Redis server stopped with code ${code}`);
      }
      // Finaliza ESTE ensaio (não "o atual"): o aviso de término pode chegar depois de outro START
      finalizeRunResults(run, run.completionHandled ? "experiment-end" : "process-exit");
    });
}

wss.on('connection', (ws, req) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/start') {
    handleStart(ws);
  } else if (pathname === '/control') {
    // Envia o estado atual da preparação para quem acabou de conectar
    // (ex.: página recarregada no meio de um Load database).
    try { ws.send(JSON.stringify(prepSnapshot())); } catch (e) {}
  } else if (pathname === '/stop') {
    // End experiment: nunca bloquear o Node aqui (ver stopRedisServer)
    stopRedisServer('end-experiment');
  }
});

const CHANNELS = ['/control', '/data', '/cpu', '/memory', '/latencia', '/start', '/stop'];
const clientsByChannel = new Map(CHANNELS.map(c => [c, new Set()]));

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!CHANNELS.includes(pathname)) {
    console.warn('WS_CONNECTION_REJECTED', pathname);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clientsByChannel.get(pathname).add(ws);
    console.log('WS_CONNECTION_ACCEPTED', pathname, 'total=', clientsByChannel.get(pathname).size);
    ws.on('close', () => clientsByChannel.get(pathname).delete(ws));
    ws.on('error', () => clientsByChannel.get(pathname).delete(ws));
    wss.emit('connection', ws, req);
  });
});

function broadcast(channel, payload) {
  const key = channel.startsWith('/') ? channel : '/' + channel;
  const set = clientsByChannel.get(key);
  if (!set) {
    console.warn(`BROADCAST_NO_CHANNEL channel=${channel}`);
    return;
  }
  if (set.size === 0) {
    console.warn(`BROADCAST_NO_LISTENERS channel=${channel}`);
    return;
  }
  const msg = JSON.stringify(payload);
  let sent = 0;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) { ws.send(msg); sent++; }
  }
  console.log(`BROADCAST_SENT channel=${channel} listeners=${set.size} sent=${sent}`);
}


// rota para configurar o arquivo de configuração do MM-DIRECT
app.post('/config', express.json(), (req, res) => {
  const config = req.body;
  activeConfig = config; // Salva configuração ativa
  modifyConfigFile(config, rootPath);
  
  try {
    const confContent = fs.readFileSync(path.join(rootPath, "redis_ir.conf"), "utf8");
    const p1 = confContent.match(/preload_database_and_restart = [^;]*;/);
    const p2 = confContent.match(/number_restarts_after_preloading = [^;]*;/);
    const p3 = confContent.match(/number_restarts_after_time = [^;]*;/);
    const p4 = confContent.match(/restart_after_time = [^;]*;/);
    console.log("Valores escritos no redis_ir.conf:", p1 ? p1[0] : "n/a", "|", p2 ? p2[0] : "n/a", "|", p3 ? p3[0] : "n/a", "|", p4 ? p4[0] : "n/a");
  } catch (e) {
    console.error("Erro ao ler redis_ir.conf:", e);
  }

  res.json(config);
});

// Metadados do experimento em andamento (usado pelo relatório PDF da tela ao vivo)
app.get('/api/runs/current', (req, res) => {
  if (!currentRun || !currentRun.runDir) return res.json(null);
  const meta = readJson(path.join(currentRun.runDir, "metadata.json"));
  res.json({ folderId: currentRun.folderId || null, metadata: meta || null });
});

// ─── Histórico: pastas, anotações e arquivamento ───
const RUNS_DIR = path.join(rootPath, "src/runs");
const ARCHIVE_DIR = path.join(RUNS_DIR, "_archive");
const RUN_ID_RE = /^run_[\w.-]+$/;

// Pasta de um experimento, ativo ou arquivado
const resolveRunDir = (runId) => {
  if (!RUN_ID_RE.test(runId)) return null;
  const active = path.join(RUNS_DIR, runId);
  if (fs.existsSync(active)) return { dir: active, archived: false };
  const archived = path.join(ARCHIVE_DIR, runId);
  if (fs.existsSync(archived)) return { dir: archived, archived: true };
  return null;
};

const readRunEntry = (runPath, folder, archived) => {
  const tryJson = (p) => {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { console.error(`Error parsing ${p}`); return null; }
  };
  const results = tryJson(path.join(runPath, "results.json"));
  // Experimentos finalizados antes de 22/10 não têm as fases de contagem/leitura: calcula uma vez
  // a partir do logs.txt e grava no results.json (null quando o log não permite)
  if (results && results.preloadReadSeconds === undefined && !(currentRun && currentRun.runDir === runPath)) {
    try {
      const logPath = path.join(runPath, "logs.txt");
      const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8") : "";
      const { events } = parseEventsFromLog(text);
      Object.assign(results, loadPhaseFields(computeLoadPhases(text, events)));
      fs.writeFileSync(path.join(runPath, "results.json"), JSON.stringify(results, null, 2));
    } catch (e) {
      console.warn(`LOAD_PHASES_BACKFILL_FAILED ${folder}: ${e.message}`);
    }
  }
  // Eventos da carga após a falha (desde 14/11/2026): completa o results.json uma vez a partir do log
  // e a lista completa de eventos (falhas sucessivas, checkpoints)
  if (results && results.events && (results.events.workloadResumed === undefined || !Array.isArray(results.eventList)) && !(currentRun && currentRun.runDir === runPath)) {
    try {
      const logPath = path.join(runPath, "logs.txt");
      const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8") : "";
      const { events } = parseEventsFromLog(text);
      results.events.workloadResumed = events["WORKLOAD_RESUMED"] || null;
      results.events.postRecoveryStable = events["POST_RECOVERY_STABLE"] || null;
      results.events.workloadFinished = events["WORKLOAD_FINISHED"] || null;
      results.events.workloadStopped = events["WORKLOAD_STOPPED"] || null;
      results.eventList = parseEventListFromLog(text);
      fs.writeFileSync(path.join(runPath, "results.json"), JSON.stringify(results, null, 2));
    } catch (e) {
      console.warn(`WORKLOAD_EVENTS_BACKFILL_FAILED ${folder}: ${e.message}`);
    }
  }
  return {
    id: folder,
    archived,
    active: !!(currentRun && currentRun.runDir === runPath),
    metadata: tryJson(path.join(runPath, "metadata.json")),
    results,
    report: tryJson(path.join(runPath, "export/report.json")),
    annotations: tryJson(path.join(runPath, "annotations.json")),
  };
};

// Lista experimentos (?archived=1 lista os arquivados)
app.get('/api/runs', (req, res) => {
  const archived = req.query.archived === "1";
  const baseDir = archived ? ARCHIVE_DIR : RUNS_DIR;
  if (!fs.existsSync(baseDir)) return res.json([]);
  try {
    const runs = [];
    for (const folder of fs.readdirSync(baseDir)) {
      if (!RUN_ID_RE.test(folder)) continue; // ignora _archive e outras pastas
      const runPath = path.join(baseDir, folder);
      if (!fs.statSync(runPath).isDirectory()) continue;
      runs.push(readRunEntry(runPath, folder, archived));
    }
    runs.sort((a, b) => b.id.localeCompare(a.id));
    res.json(runs);
  } catch (err) {
    console.error("Erro ao listar ensaios:", err);
    res.status(500).json({ error: "Erro ao listar ensaios" });
  }
});

// Rótulo, notas e etiquetas do experimento (annotations.json na pasta do experimento)
app.put('/api/runs/:runId/annotations', express.json(), (req, res) => {
  const found = resolveRunDir(req.params.runId);
  if (!found) return res.status(404).json({ error: "run not found" });
  const body = req.body || {};
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((t) => clean(t, 32)).filter(Boolean))].slice(0, 12)
    : [];
  const annotations = {
    label: clean(body.label, 120),
    notes: clean(body.notes, 4000),
    tags,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(path.join(found.dir, "annotations.json"), JSON.stringify(annotations, null, 2));
    res.json(annotations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Arquivar / restaurar: move a pasta entre src/runs/ e src/runs/_archive/ (nada é apagado)
const moveRun = (runId, toArchive, res) => {
  const found = resolveRunDir(runId);
  if (!found) return res.status(404).json({ error: "run not found" });
  if (currentRun && currentRun.runDir === found.dir) return res.status(409).json({ error: "This experiment is still running." });
  if (found.archived === toArchive) return res.json({ ok: true, archived: toArchive });
  const dest = path.join(toArchive ? ARCHIVE_DIR : RUNS_DIR, runId);
  if (fs.existsSync(dest)) return res.status(409).json({ error: "Destination already exists." });
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(found.dir, dest);
    console.log(`RUN_${toArchive ? "ARCHIVED" : "RESTORED"} ${runId}`);
    res.json({ ok: true, archived: toArchive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.post('/api/runs/:runId/archive', (req, res) => moveRun(req.params.runId, true, res));
app.post('/api/runs/:runId/unarchive', (req, res) => moveRun(req.params.runId, false, res));

// Reconhece falhas do memtier_benchmark na saída do Redis-IR (o memtier é chamado via system()
// e herda stdout/stderr). Ex.: binário compilado com OpenSSL 1.1 em sistema com OpenSSL 3.
const detectMemtierError = (text) => {
  const lib = text.match(/memtier_benchmark: error while loading shared libraries: ([^\n]+)/);
  if (lib) return `missing library (${lib[1].trim()}). Rebuild memtier on this machine — see src/backups/prep_last.log.`;
  if (/memtier_benchmark: (command )?not found/.test(text)) return "memtier_benchmark not found in PATH.";
  const conn = text.match(/memtier_benchmark[^\n]*(Connection refused|connection failed)[^\n]*/i);
  if (conn) return `could not connect to Redis (${conn[1]}).`;
  return null;
};

// ─── Base experimental (Indexed Log): status, contagens reais e preparação ───

const DB_PATHS = (() => {
  const logsDir = path.join(rootPath, "src/logs");
  const backupDir = path.join(rootPath, "src/backups");
  return {
    logsDir,
    backupDir,
    indexedLog: path.join(logsDir, "indexedLog.db"),
    sequentialLog: path.join(logsDir, "sequentialLog.aof"),
    backupIndexedLog: path.join(backupDir, "indexedLog.db.bak"),
    backupSequentialLog: path.join(backupDir, "sequentialLog.aof.bak"),
    backupMeta: path.join(backupDir, "backup_meta.json"),
    validatedMeta: path.join(backupDir, "validated_meta.json"),
  };
})();

const fileSize = (p) => {
  try { return fs.existsSync(p) ? fs.statSync(p).size : 0; } catch (e) { return 0; }
};

const readJson = (p) => {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null; } catch (e) { return null; }
};

// Conta os comandos SET/INCR e as chaves distintas do log sequencial (protocolo RESP).
// É uma contagem real do conteúdo gravado, ao contrário da estimativa antiga (tamanho/30).
const countAofRecords = (aofPath) => new Promise((resolve) => {
  if (!fs.existsSync(aofPath) || fileSize(aofPath) === 0) return resolve(null);
  const rl = readline.createInterface({ input: fs.createReadStream(aofPath), crlfDelay: Infinity });
  let records = 0;
  const keys = new Set();
  let argsLeft = 0;
  let expectBulk = false;
  let args = [];
  rl.on("line", (raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (argsLeft === 0) {
      if (line.startsWith("*")) {
        argsLeft = parseInt(line.slice(1), 10) || 0;
        args = [];
        expectBulk = false;
      }
      return;
    }
    if (!expectBulk) {
      if (line.startsWith("$")) expectBulk = true;
      return;
    }
    args.push(line);
    expectBulk = false;
    argsLeft--;
    if (argsLeft === 0 && args.length >= 2) {
      const cmd = args[0].toLowerCase();
      if (cmd === "set" || cmd === "incr") {
        records++;
        keys.add(args[1]);
      }
    }
  });
  rl.on("close", () => resolve({ records, distinctTuples: keys.size }));
  rl.on("error", () => resolve(null));
});

// Registra a contagem informada pelo Redis-IR (linha INDEXED_LOG_VALIDATED),
// associada ao tamanho do arquivo naquele momento.
const saveValidatedCounts = (records, distinctTuples, runId) => {
  try {
    if (!fs.existsSync(DB_PATHS.backupDir)) fs.mkdirSync(DB_PATHS.backupDir, { recursive: true });
    fs.writeFileSync(DB_PATHS.validatedMeta, JSON.stringify({
      records,
      distinctTuples,
      indexedLogSizeBytes: fileSize(DB_PATHS.indexedLog),
      runId: runId || null,
      validatedAt: new Date().toISOString()
    }, null, 2));
    console.log(`INDEXED_LOG_COUNTS_SAVED records=${records} distinct_tuples=${distinctTuples}`);
  } catch (e) {
    console.error("Erro ao salvar contagem validada:", e.message);
  }
};

// Helper para obter status do banco de dados indexado
const getDatabaseStatus = () => {
  const { logsDir, backupDir, indexedLog, sequentialLog, backupIndexedLog, backupSequentialLog } = DB_PATHS;

  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  // Não mexe nos arquivos enquanto a preparação estiver gerando a base
  if (prepState.phase !== "running" && fileSize(indexedLog) <= 8192 && fs.existsSync(backupIndexedLog)) {
    try {
      fs.copyFileSync(backupIndexedLog, indexedLog);
      if (fs.existsSync(backupSequentialLog)) fs.copyFileSync(backupSequentialLog, sequentialLog);
    } catch (e) {}
  }

  const exists = fs.existsSync(indexedLog);
  const sizeBytes = fileSize(indexedLog);
  const isValid = sizeBytes > 8192;

  // Contagens: só exibimos números medidos para ESTE arquivo.
  // 1) Redis-IR (INDEXED_LOG_VALIDATED) — fonte mais confiável;
  // 2) contagem do log sequencial feita ao final do Load database;
  // caso contrário, null (o painel mostra "não verificado").
  let records = null;
  let distinctTuples = null;
  let countsSource = null;
  let countsAt = null;

  if (isValid) {
    const validated = readJson(DB_PATHS.validatedMeta);
    const meta = readJson(DB_PATHS.backupMeta);
    if (validated && validated.indexedLogSizeBytes === sizeBytes) {
      records = validated.records;
      distinctTuples = validated.distinctTuples;
      countsSource = "redis-ir";
      countsAt = validated.validatedAt;
    } else if (meta && meta.countsSource === "aof" && meta.indexedLogSizeBytes === sizeBytes) {
      records = meta.records;
      distinctTuples = meta.distinctTuples;
      countsSource = "aof";
      countsAt = meta.createdAt;
    }
  }
  const metaForSize = readJson(DB_PATHS.backupMeta);
  const backupSize = fileSize(DB_PATHS.backupIndexedLog);
  const backupMetaMatches = !!(metaForSize && metaForSize.indexedLogSizeBytes === backupSize);
  const sizePreset = backupMetaMatches ? (metaForSize.sizePreset || null) : null;

  // Depois de um experimento o arquivo de trabalho cresce (registros gravados pelo memtier do
  // experimento), mas o próximo START restaura o backup. O painel mostra a base que será usada:
  // a do backup, quando ela tem contagem registrada e o arquivo atual difere dela.
  let shownSize = sizeBytes;
  const liveDiffersFromBackup = backupSize > 8192 && sizeBytes !== backupSize;
  if (backupMetaMatches && (liveDiffersFromBackup || records === null) && metaForSize.records != null) {
    records = metaForSize.records;
    distinctTuples = metaForSize.distinctTuples ?? null;
    countsSource = "backup";
    countsAt = metaForSize.createdAt || null;
    shownSize = backupSize;
  }

  return {
    exists,
    sizeBytes: shownSize,
    liveSizeBytes: sizeBytes,
    records,
    distinctTuples,
    countsSource,
    countsAt,
    sizePreset,
    path: "logs/indexedLog.db",
    backupExists: fs.existsSync(backupIndexedLog),
    backupSizeBytes: fileSize(backupIndexedLog),
    isValid,
    lastValidation: new Date().toISOString()
  };
};

app.get('/api/database-status', (req, res) => {
  res.json(getDatabaseStatus());
});

app.post('/api/restore-database', (req, res) => {
  if (prepState.phase === "running") {
    return res.status(409).json({ success: false, error: "Database preparation in progress." });
  }
  const { indexedLog, sequentialLog, backupIndexedLog, backupSequentialLog } = DB_PATHS;
  if (fs.existsSync(backupIndexedLog)) {
    try {
      fs.copyFileSync(backupIndexedLog, indexedLog);
      if (fs.existsSync(backupSequentialLog)) fs.copyFileSync(backupSequentialLog, sequentialLog);
      return res.json({ success: true, message: "Backup restaurado com sucesso.", dbStatus: getDatabaseStatus() });
    } catch(err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  return res.status(400).json({ success: false, error: "No backup available." });
});

// ─── Tamanho da base experimental ───
// O tamanho é controlado pela própria geração (memtier), que só produz entradas válidas:
// registros = clientes × threads × -n ; tuplas distintas = --key-maximum.
// A proporção registros/tupla (200) é a mesma da base padrão (1.000.000 / 5.000).
const DB_SIZE_PRESETS = {
  small:  { label: "Small",        records: 100000,  tuples: 500 },
  medium: { label: "Medium",       records: 1000000, tuples: 5000 },
  large:  { label: "Large",        records: 2000000, tuples: 10000 },
  xlarge: { label: "X-Large",      records: 5000000, tuples: 25000 },
};
const DEFAULT_DB_SIZE_PRESET = "medium";

// ─── Biblioteca de bases prontas (Fase 3 do plano, 14/11/2026) ───
// O orientador pediu que o experimento comece de uma base que já existe ("a ideia é que o banco
// de dados já exista"). Cada tamanho guarda a sua base em src/backups/bases/<tamanho>/; escolher
// o tamanho no painel só seleciona a base (segundos), e gerar uma nova fica como opção avançada.
// A base ativa continua nos arquivos de sempre (src/backups/*.bak), que o START restaura.
// Os arquivos ativos e os da biblioteca são hardlinks: o mesmo conteúdo, sem ocupar o disco duas
// vezes. Por isso nada pode gravar "por cima" de um .bak: sempre apagar e criar de novo.
const BASES_DIR = path.join(rootPath, "src/backups/bases");
const LIBRARY_FILES = [
  ["indexedLog.db.bak", "backupIndexedLog"],
  ["sequentialLog.aof.bak", "backupSequentialLog"],
  ["backup_meta.json", "backupMeta"],
];
const baseDir = (preset) => path.join(BASES_DIR, preset);

// Liga (ou copia, se o hardlink não for possível) src -> dest, substituindo dest
const linkOrCopy = (src, dest) => {
  try { fs.unlinkSync(dest); } catch (e) {}
  try { fs.linkSync(src, dest); } catch (e) { fs.copyFileSync(src, dest); }
};

const libraryEntry = (preset) => {
  const dir = baseDir(preset);
  const idx = path.join(dir, "indexedLog.db.bak");
  if (fileSize(idx) <= 8192) return null;
  const meta = readJson(path.join(dir, "backup_meta.json")) || {};
  return {
    records: meta.records ?? null,
    distinctTuples: meta.distinctTuples ?? null,
    indexedLogSizeBytes: fileSize(idx),
    sequentialLogSizeBytes: fileSize(path.join(dir, "sequentialLog.aof.bak")),
    createdAt: meta.createdAt || null,
    memtierBenchmarkParameters: meta.memtierBenchmarkParameters || null,
  };
};

// Guarda a base ativa (src/backups/*.bak) na biblioteca, no tamanho indicado
const storeActiveBaseInLibrary = (preset) => {
  if (!preset || !DB_SIZE_PRESETS[preset]) return false;
  if (fileSize(DB_PATHS.backupIndexedLog) <= 8192) return false;
  const dir = baseDir(preset);
  fs.mkdirSync(dir, { recursive: true });
  LIBRARY_FILES.forEach(([name, key]) => {
    if (fs.existsSync(DB_PATHS[key])) linkOrCopy(DB_PATHS[key], path.join(dir, name));
    else { try { fs.unlinkSync(path.join(dir, name)); } catch (e) {} }
  });
  console.log(`BASE_STORED_IN_LIBRARY preset=${preset}`);
  return true;
};

// Torna ativa a base do tamanho indicado (o próximo START a restaura)
const activateLibraryBase = (preset) => {
  const entry = libraryEntry(preset);
  if (!entry) return { ok: false, error: `No ${DB_SIZE_PRESETS[preset]?.label || preset} database in the library. Generate it first.` };
  const dir = baseDir(preset);
  fs.mkdirSync(DB_PATHS.backupDir, { recursive: true });
  LIBRARY_FILES.forEach(([name, key]) => {
    const src = path.join(dir, name);
    if (fs.existsSync(src)) linkOrCopy(src, DB_PATHS[key]);
    else { try { fs.unlinkSync(DB_PATHS[key]); } catch (e) {} }
  });
  // Arquivos de trabalho: a base selecionada já fica pronta em src/logs (o START restaura de novo)
  try {
    fs.mkdirSync(DB_PATHS.logsDir, { recursive: true });
    fs.copyFileSync(DB_PATHS.backupIndexedLog, DB_PATHS.indexedLog);
    if (fs.existsSync(DB_PATHS.backupSequentialLog)) fs.copyFileSync(DB_PATHS.backupSequentialLog, DB_PATHS.sequentialLog);
  } catch (e) {
    console.warn("Cópia da base selecionada para src/logs falhou:", e.message);
  }
  console.log(`BASE_ACTIVATED preset=${preset}`);
  return { ok: true };
};

// Na primeira execução com a biblioteca, a base atual entra nela (sem copiar: hardlink)
const migrateActiveBaseToLibrary = () => {
  try {
    const meta = readJson(DB_PATHS.backupMeta);
    const preset = meta?.sizePreset;
    if (preset && DB_SIZE_PRESETS[preset] && !libraryEntry(preset) && fileSize(DB_PATHS.backupIndexedLog) > 8192
        && meta.indexedLogSizeBytes === fileSize(DB_PATHS.backupIndexedLog)) {
      storeActiveBaseInLibrary(preset);
    }
  } catch (e) {
    console.warn("Migração da base para a biblioteca falhou:", e.message);
  }
};

// Valores de referência medidos no Load database de 1.000.000 registros desta máquina
// (2.330 ops/s; AOF 70,8 MB; log indexado 106,4 MB). Substituídos pela última medição real.
const DB_REFERENCE = { opsPerSec: 2300, aofBytesPerRecord: 71, indexedBytesPerRecord: 107 };

const getDbReference = () => {
  const meta = readJson(DB_PATHS.backupMeta);
  const ref = { ...DB_REFERENCE, measured: false };
  if (meta && meta.records > 0) {
    if (meta.memtierDurationSeconds > 0) ref.opsPerSec = meta.records / meta.memtierDurationSeconds;
    else if (meta.duration > 0) ref.opsPerSec = meta.records / meta.duration;
    if (meta.sequentialLogSizeBytes > 0) ref.aofBytesPerRecord = meta.sequentialLogSizeBytes / meta.records;
    if (meta.indexedLogSizeBytes > 0) ref.indexedBytesPerRecord = meta.indexedLogSizeBytes / meta.records;
    ref.measured = true;
  }
  return ref;
};

// Lê um parâmetro numérico do memtier aceitando "-x N", "-xN", "--long=N" e "--long N"
const readMemtierNumber = (params, short, long) => {
  const re = new RegExp(`(?:^|\\s)(?:-${short}\\s*|--${long}(?:=|\\s+))(\\d+)`);
  const m = params.match(re);
  return m ? parseInt(m[1], 10) : null;
};

// Substitui (ou acrescenta) um parâmetro numérico do memtier
const setMemtierNumber = (params, short, long, value) => {
  const re = new RegExp(`(^|\\s)(?:-${short}\\s*|--${long}(?:=|\\s+))\\d+`, "g");
  if (re.test(params)) return params.replace(re, `$1--${long}=${value}`);
  return `${params} --${long}=${value}`;
};

const applyDatabaseSize = (baseParams, presetKey) => {
  const preset = DB_SIZE_PRESETS[presetKey] || DB_SIZE_PRESETS[DEFAULT_DB_SIZE_PRESET];
  let params = (baseParams || "").trim();
  // memtier: padrão 4 threads × 50 clientes
  const threads = readMemtierNumber(params, "t", "threads") || 4;
  const clients = readMemtierNumber(params, "c", "clients") || 50;
  const connections = threads * clients;
  const requestsPerClient = Math.max(1, Math.ceil(preset.records / connections));

  params = setMemtierNumber(params, "n", "requests", requestsPerClient);
  params = setMemtierNumber(params, "_none_", "key-minimum", 1);
  params = setMemtierNumber(params, "_none_", "key-maximum", preset.tuples);

  return {
    params,
    preset: presetKey in DB_SIZE_PRESETS ? presetKey : DEFAULT_DB_SIZE_PRESET,
    targetRecords: requestsPerClient * connections,
    targetTuples: preset.tuples,
    connections,
  };
};

// Espaço livre no disco do projeto (bytes) — null se o Node não suportar statfs
const freeDiskBytes = () => {
  try {
    if (typeof fs.statfsSync !== "function") return null;
    const st = fs.statfsSync(DB_PATHS.logsDir);
    return st.bavail * st.bsize;
  } catch (e) {
    return null;
  }
};

// Estimativas de tempo e disco para cada preset
const estimateDatabaseSize = (records) => {
  const ref = getDbReference();
  const aof = records * ref.aofBytesPerRecord;
  const indexed = records * ref.indexedBytesPerRecord;
  return {
    seconds: Math.round(records / ref.opsPerSec),
    // AOF + log indexado + cópias no backup + cópia interna .bak do Redis-IR
    diskBytes: Math.round(2 * aof + 3 * indexed),
    indexedLogBytes: Math.round(indexed),
    measured: ref.measured,
  };
};

app.get('/api/database-size-presets', (req, res) => {
  const meta = readJson(DB_PATHS.backupMeta);
  res.json({
    defaultPreset: DEFAULT_DB_SIZE_PRESET,
    currentPreset: meta?.sizePreset || null,
    freeDiskBytes: freeDiskBytes(),
    presets: Object.entries(DB_SIZE_PRESETS).map(([key, p]) => ({
      key,
      label: p.label,
      records: p.records,
      tuples: p.tuples,
      ...estimateDatabaseSize(p.records),
      // Base pronta na biblioteca (null se ainda não foi gerada)
      library: libraryEntry(key),
    })),
  });
});

// Seleciona a base pronta de um tamanho (não gera nada)
app.post('/api/select-database', express.json(), (req, res) => {
  const preset = (req.body || {}).sizePreset;
  if (!DB_SIZE_PRESETS[preset]) return res.status(400).json({ success: false, error: "Unknown database size." });
  if (prepState.phase === "running") return res.status(409).json({ success: false, error: "Database preparation in progress." });
  if (currentRun && !currentRun.finalized) return res.status(409).json({ success: false, error: "An experiment is running." });
  const r = activateLibraryBase(preset);
  if (!r.ok) return res.status(404).json({ success: false, error: r.error });
  res.json({ success: true, dbStatus: getDatabaseStatus() });
});

// Estado da preparação (Load database), compartilhado com o canal /control
const prepState = {
  phase: "idle",          // idle | running | completed | failed
  step: null,             // texto curto da etapa atual
  progress: null,         // 0-100 (progresso do memtier), quando disponível
  startedAt: null,
  finishedAt: null,
  error: null,
  result: null
};
let prepChildRef = null;
let prepCancelRequested = false;

const prepSnapshot = () => ({ type: "PREPARATION_STATE", ...prepState });

const setPrepStep = (step, extra = {}) => {
  Object.assign(prepState, { step }, extra);
  broadcastToAllSockets({ type: "EVENT", event: "DATABASE_PREPARATION_PROGRESS", step: prepState.step, progress: prepState.progress, startedAt: prepState.startedAt });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const redisCliShutdown = () => {
  try {
    child_process.execSync('./redis-cli shutdown', { cwd: path.join(rootPath, 'src'), stdio: 'ignore', timeout: 15000 });
  } catch (e) {}
};

const PREP_MAX_DURATION_MS = 30 * 60 * 1000;   // limite mínimo da preparação (ampliado conforme o tamanho da base)
// O indexador V2 lê um lote inteiro do AOF para memória antes de gravar; com um AOF grande o
// primeiro lote pode levar minutos sem mexer no finalLogSeek. Por isso a tolerância é longa.
const PREP_INDEXER_STALL_MS = 10 * 60 * 1000;   // nada avançou por 10 min = travado
const PREP_LOG_MAX_BYTES = 5 * 1024 * 1024;     // limite do log da preparação

// Posição (em bytes) do log sequencial até onde o indexador já gravou no B-tree.
// O Redis-IR grava esse valor em logs/finalLogSeek.dat logo após cada dbp->sync(),
// então "seek == tamanho do AOF" significa indexação concluída e sincronizada em disco.
const FINAL_LOG_SEEK_PATH = path.join(rootPath, "src/logs/finalLogSeek.dat");
const readFinalLogSeek = () => {
  try {
    const buf = fs.readFileSync(FINAL_LOG_SEEK_PATH);
    if (buf.length < 8) return null;
    return Number(buf.readBigUInt64LE(0));
  } catch (e) {
    return null;
  }
};

const prepareExperimentalDatabase = async (options = {}) => {
  const startTime = Date.now();
  prepCancelRequested = false;
  const maxDurationMs = Math.max(PREP_MAX_DURATION_MS, options.maxDurationMs || 0);
  Object.assign(prepState, { phase: "running", step: "Starting", progress: null, startedAt: new Date(startTime).toISOString(), finishedAt: null, error: null, result: null });

  broadcastToAllSockets({
    type: "EVENT",
    event: "DATABASE_PREPARATION_STARTED",
    startedAt: prepState.startedAt,
    message: "Iniciando preparação da base experimental..."
  });

  const { logsDir, backupDir, indexedLog, sequentialLog, backupIndexedLog, backupSequentialLog, backupMeta } = DB_PATHS;
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const redisServerPath = path.join(rootPath, 'src');

  // Log completo da preparação (saída do Redis-IR + memtier), para diagnóstico
  const prepLogPath = path.join(backupDir, "prep_last.log");
  let prepLogBytes = 0;
  const plog = (text) => {
    if (prepLogBytes > PREP_LOG_MAX_BYTES) return;
    try {
      fs.appendFileSync(prepLogPath, text);
      prepLogBytes += Buffer.byteLength(text);
    } catch (e) {}
  };
  try { fs.writeFileSync(prepLogPath, `# Load database iniciado em ${new Date(startTime).toISOString()}\n`); } catch (e) {}
  const plogState = (label) => {
    plog(`\n# [${label}] t=${((Date.now() - startTime) / 1000).toFixed(1)}s aof=${fileSize(sequentialLog)}B indexedLog=${fileSize(indexedLog)}B finalLogSeek=${readFinalLogSeek()}\n`);
  };

  const fail = (reason) => {
    plogState("FALHA");
    plog(`# motivo: ${reason}\n`);
    // Restaura a base anterior (se houver backup) para não deixar o projeto sem banco
    try {
      if (fs.existsSync(backupIndexedLog)) {
        fs.copyFileSync(backupIndexedLog, indexedLog);
        // O Redis-IR copia o log indexado para logs/indexedLog.db.bak ao encerrar;
        // após uma tentativa falha essa cópia fica vazia e quebraria a auto-restauração do C.
        fs.copyFileSync(backupIndexedLog, `${indexedLog}.bak`);
        if (fs.existsSync(backupSequentialLog)) fs.copyFileSync(backupSequentialLog, sequentialLog);
      }
    } catch (e) {}
    if (Object.keys(activeConfig).length > 0) {
      try { modifyConfigFile(activeConfig, rootPath); } catch (e) {}
    }
    Object.assign(prepState, { phase: "failed", step: null, error: reason, finishedAt: new Date().toISOString() });
    broadcastToAllSockets({ type: "EVENT", event: "DATABASE_PREPARATION_FAILED", reason });
    console.error(`DATABASE_PREPARATION_FAILED reason=${reason}`);
    return { success: false, error: reason, dbStatus: getDatabaseStatus() };
  };

  // 1. Configuração exclusiva da preparação: sem falha simulada, sem reinícios,
  //    sem relatórios — apenas memtier gravando no log e o indexador montando o B-tree.
  const memtierParams = (options.memtierBenchmarkParameters || activeConfig.memtierBenchmarkParameters || "").trim();
  const prepConfig = {
    ...activeConfig,
    instantRecoveryState: "ON",
    memtierBenchmarkState: "ON",
    memtierBenchmarkWorkloadRunTimes: 1,
    restartAfterTime: 0,
    numberRestartsAfterTime: 0,
    preloadDatabaseAndRestart: 0,
    numberRestartsAfterPreloading: 0,
    restartAfterBenchmarking: 0,
    timeTostopBenchmarking: 0,
    generateRecoveryReport: "OFF",
    generateExecutedCommandsCsv: "OFF",
    generateIndexingReportCsv: "OFF",
    systemMonitoring: "OFF",
  };
  if (memtierParams) prepConfig.memtierBenchmarkParameters = memtierParams;
  try {
    modifyConfigFile(prepConfig, rootPath);
  } catch (e) {
    return fail(`Could not write the preparation config: ${e.message}`);
  }

  // 2. Garante porta 6379 livre e limpa marcadores de execução anterior
  setPrepStep("Stopping previous Redis instances");
  if (!(await ensureRedisDown("prepare-database"))) {
    return fail("Port 6379 is still in use by another redis-server. Stop it (fuser -k 6379/tcp) and try again.");
  }
  // Nomes reais definidos em src/server.h (FAILURE_TRIGGERED_FILE, DATABASE_PRELOAD_FILE)
  ["run_start.dat", "run_id.dat", "failure_triggered.dat", "failureTriggeredfile.dat", "preloadSystemfile.dat",
   "restartCounter.dat", "restartCounter2.dat"].forEach((f) => {
    const p = path.join(redisServerPath, "temp_ir_files", f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
  });

  // 3. Remove a base atual (o backup em src/backups continua intacto até o sucesso).
  //    Remove também os ponteiros de indexação (finalLogSeek/checkpointLogSeek): eles
  //    apontam para posições do log antigo e fariam o indexador pular o log novo.
  try {
    if (fs.existsSync(indexedLog)) fs.unlinkSync(indexedLog);
    if (fs.existsSync(sequentialLog)) fs.unlinkSync(sequentialLog);
    fs.readdirSync(logsDir)
      .filter((f) => /LogSeek.*\.dat$/i.test(f))
      .forEach((f) => { try { fs.unlinkSync(path.join(logsDir, f)); } catch (e) {} });
  } catch (e) {}

  // 4. Executa o Redis-IR em modo de preparação (runId prep_*)
  setPrepStep("Generating load with memtier", { progress: 0 });
  const runId = `prep_${Date.now()}`;
  const env = Object.assign({}, process.env, { RUN_ID: runId });
  const prepChild = child_process.spawn('./redis-server', ['--daemonize', 'no'], { cwd: redisServerPath, env });
  prepChildRef = prepChild;

  let memtierFinished = false;
  let memtierDurationSeconds = null;
  let memtierError = null;
  let childExited = false;
  let spawnError = null;
  let lastProgressBroadcast = 0;

  // Lê stdout e stderr (o memtier herda os dois). Sem isso o buffer do pipe enche
  // e o Redis/memtier ficam bloqueados escrevendo — a versão anterior não lia.
  const onOutput = (chunk) => {
    const text = chunk.toString();
    plog(text);
    const progressMatches = [...text.matchAll(/\[RUN #\d+\s+(\d+)%/g)];
    if (progressMatches.length > 0) {
      const pct = parseInt(progressMatches[progressMatches.length - 1][1], 10);
      if (!isNaN(pct) && Date.now() - lastProgressBroadcast > 500) {
        lastProgressBroadcast = Date.now();
        setPrepStep("Generating load with memtier", { progress: pct });
      }
    }
    const finishedMatch = text.match(/Memtier benchmark execution finished: ([\d.]+) seconds/);
    if (finishedMatch || /Memtier benchmark execution finished/.test(text)) {
      memtierFinished = true;
      if (finishedMatch) memtierDurationSeconds = parseFloat(finishedMatch[1]);
    }
    const memtierErr = detectMemtierError(text);
    if (memtierErr && !memtierError) memtierError = memtierErr;
    if (/Memtier benchmark aborted|EXPERIMENT_FAILED/.test(text)) {
      console.warn("PREP_REDIS_REPORTED_FAILURE", text.trim().slice(0, 300));
    }
  };
  prepChild.stdout.on('data', onOutput);
  prepChild.stderr.on('data', onOutput);
  prepChild.on('error', (err) => { spawnError = err; });
  prepChild.on('exit', () => { childExited = true; });

  // 5. Aguarda o memtier terminar (ou falha / cancelamento / tempo limite)
  while (!memtierFinished && !childExited && !spawnError && !prepCancelRequested) {
    if (Date.now() - startTime > maxDurationMs) break;
    await sleep(500);
  }

  if (spawnError) { prepChildRef = null; return fail(`Could not start redis-server: ${spawnError.message}`); }
  if (prepCancelRequested) { redisCliShutdown(); prepChildRef = null; return fail("Preparation cancelled by the user."); }
  if (!memtierFinished) {
    redisCliShutdown();
    prepChildRef = null;
    return fail(childExited
      ? "Redis-IR exited before memtier finished."
      : "Preparation timed out.");
  }

  plogState("MEMTIER_CONCLUIDO");

  // 6. Aguarda o indexador alcançar o fim do log sequencial.
  //    Critério: finalLogSeek >= tamanho do AOF, com o AOF parado (o Redis faz fsync a cada 1 s).
  await sleep(2000);
  if (memtierError || fileSize(sequentialLog) === 0) {
    redisCliShutdown();
    prepChildRef = null;
    return fail(memtierError
      ? `memtier_benchmark could not run: ${memtierError}`
      : "memtier finished but nothing was written to the sequential log (empty AOF). See src/backups/prep_last.log.");
  }

  setPrepStep("Indexing the log (B-tree)", { progress: null });
  let lastSeek = readFinalLogSeek();
  let lastSeekChange = Date.now();
  let lastAof = fileSize(sequentialLog);
  let lastIdxSize = fileSize(indexedLog);
  let aofStableSince = Date.now();
  let indexed = false;
  let stalled = false;
  let lastIndexBroadcast = 0;

  while (!childExited && !prepCancelRequested) {
    if (Date.now() - startTime > maxDurationMs) break;
    await sleep(500);

    const aof = fileSize(sequentialLog);
    const seek = readFinalLogSeek();

    if (aof !== lastAof) { lastAof = aof; aofStableSince = Date.now(); }
    if (seek !== lastSeek) { lastSeek = seek; lastSeekChange = Date.now(); }

    const idxSize = fileSize(indexedLog);
    if (idxSize !== lastIdxSize) { lastIdxSize = idxSize; lastSeekChange = Date.now(); }

    if (aof > 0 && Date.now() - lastIndexBroadcast > 1000) {
      lastIndexBroadcast = Date.now();
      // Enquanto o primeiro lote não termina, o seek fica em 0: progresso indeterminado.
      const pct = seek ? Math.min(100, Math.floor((seek / aof) * 100)) : null;
      setPrepStep(pct === null ? "Indexing the log (B-tree) — first batch" : "Indexing the log (B-tree)", { progress: pct });
    }

    if (aof > 0 && seek !== null && seek >= aof && Date.now() - aofStableSince >= 2000) {
      indexed = true;
      break;
    }
    if (Date.now() - lastSeekChange > PREP_INDEXER_STALL_MS) {
      stalled = true;
      break;
    }
  }
  plogState(indexed ? "INDEXACAO_CONCLUIDA" : "INDEXACAO_INTERROMPIDA");

  if (!indexed && !prepCancelRequested) {
    redisCliShutdown();
    prepChildRef = null;
    return fail(childExited
      ? "Redis-IR exited before the indexer finished."
      : stalled
        ? `The indexer stopped advancing (finalLogSeek=${lastSeek ?? "missing"} of ${lastAof} bytes). See src/backups/prep_last.log.`
        : "Preparation timed out during indexing.");
  }

  // 7. Encerra o Redis e espera o processo sair (até 10 s)
  setPrepStep("Stopping Redis");
  redisCliShutdown();
  for (let i = 0; i < 20 && !childExited; i++) await sleep(500);
  if (!childExited) {
    try { prepChild.kill('SIGTERM'); } catch (e) {}
    await sleep(1000);
  }
  prepChildRef = null;
  if (prepCancelRequested) return fail("Preparation cancelled by the user.");

  // 8. Valida e conta
  const sizeBytes = fileSize(indexedLog);
  plogState("REDIS_ENCERRADO");
  if (sizeBytes <= 8192) {
    return fail("The indexed database was not generated (empty file). See src/backups/prep_last.log.");
  }

  setPrepStep("Counting records");
  const counts = await countAofRecords(sequentialLog);
  const duration = (Date.now() - startTime) / 1000;

  // 9. Salva backup + metadados (contagem real, origem e tamanho do arquivo)
  setPrepStep("Saving backup");
  try {
    // Os .bak podem ser hardlinks da biblioteca: apaga antes de copiar, para não alterar a base
    // de outro tamanho guardada nela.
    [backupIndexedLog, backupSequentialLog, backupMeta].forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} });
    fs.copyFileSync(indexedLog, backupIndexedLog);
    if (fs.existsSync(sequentialLog)) fs.copyFileSync(sequentialLog, backupSequentialLog);
    fs.writeFileSync(backupMeta, JSON.stringify({
      records: counts ? counts.records : null,
      distinctTuples: counts ? counts.distinctTuples : null,
      countsSource: counts ? "aof" : null,
      indexedLogSizeBytes: sizeBytes,
      sequentialLogSizeBytes: fileSize(sequentialLog),
      indexedLogPath: "logs/indexedLog.db",
      memtierBenchmarkParameters: prepConfig.memtierBenchmarkParameters || null,
      sizePreset: options.sizePreset || null,
      targetRecords: options.targetRecords || null,
      targetTuples: options.targetTuples || null,
      memtierDurationSeconds,
      duration,
      createdAt: new Date().toISOString()
    }, null, 2));
    storeActiveBaseInLibrary(options.sizePreset);
  } catch (e) {
    console.error("Erro ao salvar backup:", e.message);
  }

  // Restaura a configuração do experimento, se já houver uma ativa
  if (Object.keys(activeConfig).length > 0) {
    try { modifyConfigFile(activeConfig, rootPath); } catch (e) {}
  }

  const result = {
    success: true,
    records: counts ? counts.records : null,
    distinctTuples: counts ? counts.distinctTuples : null,
    duration,
    dbStatus: getDatabaseStatus()
  };

  Object.assign(prepState, { phase: "completed", step: null, progress: 100, finishedAt: new Date().toISOString(), result });
  broadcastToAllSockets({
    type: "EVENT",
    event: "DATABASE_PREPARATION_COMPLETED",
    records: result.records,
    distinct_tuples: result.distinctTuples,
    indexed_log_path: "logs/indexedLog.db",
    size_bytes: sizeBytes,
    duration
  });
  console.log(`DATABASE_PREPARATION_COMPLETED records=${result.records} distinct_tuples=${result.distinctTuples} duration=${duration}s`);
  return result;
};

app.post('/api/prepare-database', express.json(), async (req, res) => {
  if (prepState.phase === "running") {
    return res.status(409).json({ success: false, error: "A database preparation is already running." });
  }
  if (currentRun && !currentRun.finalized) {
    return res.status(409).json({ success: false, error: "An experiment is running. Stop it before loading the database." });
  }
  const body = req.body || {};
  const baseParams = (body.memtierBenchmarkParameters || activeConfig.memtierBenchmarkParameters || "").trim();
  const sized = applyDatabaseSize(baseParams, body.sizePreset);
  const estimate = estimateDatabaseSize(sized.targetRecords);

  // Verifica espaço em disco antes de apagar a base atual
  const free = freeDiskBytes();
  if (free !== null && free < estimate.diskBytes) {
    const gb = (n) => (n / 1024 ** 3).toFixed(1);
    return res.status(507).json({
      success: false,
      error: `Not enough disk space for the ${DB_SIZE_PRESETS[sized.preset].label} database: ` +
             `about ${gb(estimate.diskBytes)} GB needed, ${gb(free)} GB free.`
    });
  }

  console.log(`DATABASE_PREPARATION_SIZE preset=${sized.preset} records=${sized.targetRecords} tuples=${sized.targetTuples} params="${sized.params}"`);
  try {
    const result = await prepareExperimentalDatabase({
      memtierBenchmarkParameters: sized.params,
      sizePreset: sized.preset,
      targetRecords: sized.targetRecords,
      targetTuples: sized.targetTuples,
      // limite de tempo: 3× a estimativa (mínimo de 30 min)
      maxDurationMs: estimate.seconds * 3 * 1000,
    });
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch(err) {
    Object.assign(prepState, { phase: "failed", step: null, error: err.message, finishedAt: new Date().toISOString() });
    broadcastToAllSockets({ type: "EVENT", event: "DATABASE_PREPARATION_FAILED", reason: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/prepare-database/status', (req, res) => {
  res.json(prepSnapshot());
});

app.post('/api/prepare-database/cancel', (req, res) => {
  if (prepState.phase !== "running") {
    return res.status(400).json({ success: false, error: "No database preparation is running." });
  }
  prepCancelRequested = true;
  redisCliShutdown();
  res.json({ success: true });
});

// Rota para ler a telemetria historica de um ensaio
// ─── Reconstrução de resultados a partir do logs.txt ───
// Experimentos que terminaram sem results.json (Redis nunca desligado, ou morto no START seguinte)
// ainda têm todos os eventos no logs.txt. Reconstrói durações, tuplas e status a partir deles.
// Os CSVs de vazão/CPU desses experimentos não são recuperáveis (foram sobrescritos pelos seguintes).
const reconstructRunResults = (runDir, folderId) => {
  const logsPath = path.join(runDir, "logs.txt");
  if (!fs.existsSync(logsPath)) return null;
  const text = fs.readFileSync(logsPath, "utf-8");
  if (!text.includes("EVENT_JSON")) return null; // anterior aos eventos estruturados: nada confiável a extrair
  const { events: ev, runStartUs } = parseEventsFromLog(text);
  const meta = readJson(path.join(runDir, "metadata.json")) || {};
  const n = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const durMs = (endName, startName) => {
    const e = ev[endName];
    if (!e) return null;
    if (n(e.durationMs) !== null) return n(e.durationMs);
    const st = ev[startName];
    return (n(e.timestampUs) && n(st?.timestampUs)) ? (n(e.timestampUs) - n(st.timestampUs)) / 1000 : null;
  };
  const preloadMs = durMs("PRELOAD_COMPLETED", "PRELOAD_STARTED");
  const recoveryMs = durMs("RECOVERY_COMPLETED", "RECOVERY_STARTED");
  const stableMs = (n(ev["FAILURE_TRIGGERED"]?.timestampUs) && n(ev["STABLE_OPERATION_STARTED"]?.timestampUs))
    ? (n(ev["FAILURE_TRIGGERED"].timestampUs) - n(ev["STABLE_OPERATION_STARTED"].timestampUs)) / 1000 : null;
  const experimentStatus = computeExperimentStatus(ev);
  const rec = ev["RECOVERY_COMPLETED"];
  const pre = ev["PRELOAD_COMPLETED"];
  const sec = (ms) => ms !== null ? parseFloat((ms / 1000).toFixed(3)) : null;
  const results = {
    id: ev["RUN_STARTED"]?.runId || folderId,
    runId: ev["RUN_STARTED"]?.runId || folderId,
    folderId,
    runStartUs: runStartUs || null,
    eventList: parseEventListFromLog(text),
    events: {
      preloadStart: ev["PRELOAD_STARTED"] || null,
      preloadEnd: pre || null,
      stableOperationStart: ev["STABLE_OPERATION_STARTED"] || null,
      failureTimerStart: ev["FAILURE_TIMER_STARTED"] || null,
      failureTriggered: ev["FAILURE_TRIGGERED"] || null,
      recoveryStart: ev["RECOVERY_STARTED"] || null,
      recoveryEnd: rec || null,
      workloadResumed: ev["WORKLOAD_RESUMED"] || null,
      postRecoveryStable: ev["POST_RECOVERY_STABLE"] || null,
      workloadFinished: ev["WORKLOAD_FINISHED"] || null,
      workloadStopped: ev["WORKLOAD_STOPPED"] || null,
      experimentCompleted: ev["EXPERIMENT_COMPLETED"] || null,
      experimentFailed: ev["EXPERIMENT_FAILED"] || null
    },
    durations: { preloadMs, stableOperationMs: stableMs, recoveryMs },
    preloadDurationSeconds: sec(preloadMs),
    stableOperationSeconds: sec(stableMs),
    recoveryDurationSeconds: sec(recoveryMs),
    ...loadPhaseFields(computeLoadPhases(text, ev)),
    experimentStatus,
    status: experimentStatus === "Completed" ? "Estável" : "Interrompido",
    preloadedTuples: n(pre?.loadedTuples),
    recoveredTuples: rec ? n(rec.loadedTuples) : null,
    recordsProcessed: n((rec || pre)?.recordsProcessed),
    inconsistencies: n((rec || pre)?.inconsistencies),
    recoveryOperationNature: (meta.config?.instantRecoveryState || "ON").toUpperCase() === "ON" ? "Recuperação via MM-DIRECT (B-Tree)" : "Recuperação Tradicional (AOF)",
    timestamp: meta.timestamp || null,
    timestampLocal: meta.timestampLocal || null,
    timezone: "America/Sao_Paulo",
    reconstructed: true,
    reconstructedAt: new Date().toISOString(),
    reconstructionNote: "Rebuilt from logs.txt; throughput and CPU/memory CSVs were not saved for this run.",
  };
  fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify(results, null, 2));
  return results;
};

const reconstructMissingResults = () => {
  const runsDir = path.join(rootPath, "src/runs");
  if (!fs.existsSync(runsDir)) return;
  let rebuilt = 0;
  for (const folder of fs.readdirSync(runsDir)) {
    if (!/^run_[\w.-]+$/.test(folder)) continue; // ignora _archive
    const runDir = path.join(runsDir, folder);
    try {
      if (!fs.statSync(runDir).isDirectory()) continue;
      if (currentRun && currentRun.runDir === runDir) continue; // nunca o experimento ativo
      if (fs.existsSync(path.join(runDir, "results.json"))) continue;
      if (reconstructRunResults(runDir, folder)) rebuilt++;
    } catch (e) {
      console.error(`Falha ao reconstruir ${folder}:`, e.message);
    }
  }
  if (rebuilt > 0) console.log(`RESULTS_RECONSTRUCTED count=${rebuilt} (a partir de logs.txt)`);
};

app.get('/api/runs/:runId/telemetry', (req, res) => {
  const { runId } = req.params;
  const found = resolveRunDir(runId);
  if (!found) return res.status(404).json({ error: "run not found" });
  const runDir = found.dir;
  const results = readJson(path.join(runDir, "results.json"));
  // Referência de tempo = início do experimento (runStartUs), a mesma da tela ao vivo e dos eventos.
  // Sem ela, usa a linha "Database startup" do próprio CSV.
  const refUs = results?.runStartUs ? Number(results.runStartUs) : null;

  const telemetry = { throughput: [], monitoring: [], runStartUs: refUs };
  try {
    const datasetsPath = path.join(runDir, "datasets.csv");
    if (fs.existsSync(datasetsPath)) telemetry.throughput = parseCommandsThroughput(fs.readFileSync(datasetsPath, "utf-8"), refUs);
  } catch (err) {
    console.error("Erro ao ler datasets de run:", err.message);
  }
  try {
    const monitoringPath = path.join(runDir, "system_monitoring.csv");
    if (fs.existsSync(monitoringPath)) telemetry.monitoring = parseMonitoring(fs.readFileSync(monitoringPath, "utf-8"), refUs);
  } catch (err) {
    console.error("Erro ao ler monitoramento de run:", err.message);
  }
  res.json(telemetry);
});

// função para contagem de comandos por segundo
const processaCSV = async (ws, inputPath, ctx) => {
  try {
    if (!fs.existsSync(inputPath)) return;
    fs.createReadStream(inputPath, {
      start: ctx.total,
    })
      .on('error', (err) => {
        console.error(`Erro na leitura do stream CSV: ${err.message}`);
      })
      .pipe(csv())
      .on('error', (err) => {
        console.error(`Erro no parser CSV: ${err.message}`);
      })
      .on('data', (row) => {
        ctx.total++;
        lendoArquivo = true;

        // Processar cada linha do CSV
        if (ctx.total === 1) {
          ctx.database_startup_time = parseInt(row.startTime);
        } else if (ctx.total >= 3) {
          if (row.type !== '0' && !isNaN(row.finishTime)) {
            const tempoTermino = parseInt(row.finishTime);
            const tempoEmSegundos = Math.floor((tempoTermino - ctx.database_startup_time) / 1000000);

            if (tempoEmSegundos >= 0) {
              const entryIndex = ctx.contagemComandos.findIndex(entry => entry[0] === tempoEmSegundos);

              if (entryIndex === -1) {
                ctx.contagemComandos.push({ sec: tempoEmSegundos, timestampUs: endTime, count: 1 });
              } else {
                ctx.contagemComandos[entryIndex].count++;
              }
            }
          }
        }

        // Verificar se o tamanho do array aumentou e enviar o penúltimo elemento apenas uma vez
        for (let i = 0; i < ctx.contagemComandos.length; i++) {
          if (ctx.contagemComandos.length > ctx.arrayParaVerificarSeJaFoiEnviado.length) {
            if (i === ctx.contagemComandos.length - 2) {
              ctx.arrayParaVerificarSeJaFoiEnviado.push(ctx.contagemComandos[i]);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify(ctx.contagemComandos[i]));
              }
            }
          }
        }
      })
      .on('end', () => {
        console.log('CSV file successfully processed');
        lendoArquivo = false;
      });
  } catch (err) {
    console.error(`Erro em processaCSV: ${err.message}`);
  }
}

// função para calcular latência
const processaLatencia = async (ws, inputPath, ctx) => {
  try {
    if (!fs.existsSync(inputPath)) return;
    fs.createReadStream(inputPath, {
      start: ctx.totalLatencia,
    })
      .on('error', (err) => {
        console.error(`Erro na leitura do stream de Latência: ${err.message}`);
      })
      .pipe(csv())
      .on('error', (err) => {
        console.error(`Erro no parser de Latência: ${err.message}`);
      })
      .on('data', (row) => {
        ctx.totalLatencia++;
        lendoArquivo = true;

        if (ctx.totalLatencia === 1) {
          ctx.database_startup_time_latencia = parseInt(row.startTime);
        } else if (ctx.totalLatencia >= 3) {
          if (parseInt(row.type) != '0') {
            const num = parseInt((parseInt(row.startTime) - ctx.database_startup_time_latencia) / 1000000);
            if (row.type === 'N') {
              ctx.x1.push(num);
              ctx.y1.push(parseInt(row.latency));
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ x1: [num, parseInt(row.latency)] }));
              }
            }
            if (row.type === 'A') {
              ctx.x2.push(num);
              ctx.y2.push(parseInt(row.latency));
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ x2: [num, parseInt(row.latency)] }));
              }
            }
          }
        }
      });
  } catch (err) {
    console.error(`Erro em processaLatencia: ${err.message}`);
  }
}

// função para processar o dataset de uso de cpu
const processaCpu = async (ws, pathCpu, ctx) => {
  try {
    if (!fs.existsSync(pathCpu)) return;
    const data = await fs.promises.readFile(pathCpu, 'utf-8');
    const lines = data.trim().split('\n');

    if (lines.length > 2) {
      const databaseStartupLine = lines[1].split(';');
      if (databaseStartupLine.length < 3) return;
      const databaseStartupTime = parseInt(databaseStartupLine[2]);

      ctx.databaseStartupCpu = databaseStartupTime;

      lines.splice(0, 2); 

      for (let i = 0; i < lines.length; i++) {
        const linha = lines[i].split(';');
        if (linha.length >= 2 && linha[0].match(/^\d+$/)) {
          const num = Math.floor((parseInt(linha[0]) - databaseStartupTime) / 1000000);
          ctx.x.push(num);
          const cpuVal = parseFloat(linha[1].replace(',', '.'));
          ctx.y.push(cpuVal);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify([num, cpuVal]));
          }
        }
      }
    }
  } catch (err) {
    console.error(`Erro em processaCpu: ${err.message}`);
  }
}

// função para processar o dataset de uso de memória
const processaMemoria = async (ws, pathMemoria, ctx) => {
  try {
    if (!fs.existsSync(pathMemoria)) return;
    const data = await fs.promises.readFile(pathMemoria, 'utf-8');
    const lines = data.trim().split('\n');

    if (lines.length > 2) {
      const databaseStartupLine = lines[1].split(';');
      if (databaseStartupLine.length < 3) return;
      const databaseStartupTime = parseInt(databaseStartupLine[2]);

      ctx.databaseStartupMemoria = databaseStartupTime;

      lines.splice(0, 2); 

      for (let i = 0; i < lines.length; i++) {
        const linha = lines[i].split(';');
        if (linha.length >= 3 && linha[0].match(/^\d+$/)) {
          const num = Math.floor((parseInt(linha[0]) - databaseStartupTime) / 1000000);
          ctx.x.push(num);
          ctx.y.push(parseFloat(linha[2]));
        }
      }
    }
  } catch (err) {
    console.error(`Erro em processaMemoria: ${err.message}`);
  }
};

// Envia eventos de controle (preparação da base etc.) a todos os clientes do canal /control.
// Antes isto usava um Set "activeSockets" que nunca recebia conexões, então os eventos
// DATABASE_PREPARATION_* não chegavam a nenhum navegador.
const broadcastToAllSockets = (dataObj) => {
  const jsonStr = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj);
  const set = clientsByChannel.get('/control');
  if (!set) return;
  set.forEach((ws) => {
    if (ws.readyState === 1) {
      try { ws.send(jsonStr); } catch(e) {}
    }
  });
};

// Helper para ler apenas linhas completas de arquivos (evita linhas truncadas)
const readCompleteLines = (fileContent) => {
  if (!fileContent) return [];
  const lines = fileContent.split('\n');
  if (!fileContent.endsWith('\n')) {
    lines.pop(); // Remove última linha incompleta
  }
  return lines.filter(l => l.trim().length > 0);
};

// conexão websocket

// --- Background Collectors ---
let dataInterval, cpuInterval, memInterval, latInterval;

const sentDataIndices = new Set();
const sentCpuSeconds = new Set();
const sentMemSeconds = new Set();
const sentLatIndices = new Set();

// Estado da leitura incremental do datasets.csv para o throughput ao vivo (um por experimento)
const newDataTail = (runId) => ({ runId, offset: 0, partial: "", counts: new Map(), maxSec: -1, lastEmitted: -1, lastGrowthMs: 0 });
let dataTail = newDataTail(null);
const resetDataTail = () => { dataTail = newDataTail(currentRunId); };

function startCollectors() {


  // DATA — throughput ao vivo (comandos concluídos por segundo, tipos N e A do datasets.csv).
  // Lê o arquivo de forma incremental, a partir de onde parou, e conta TODAS as linhas novas.
  // (Antes lia só as últimas 1000 linhas a cada 0,5 s, o que limitava o valor a ~2000 ops/s
  // e deixava a linha achatada quando o banco executava mais do que isso.)
  // Um segundo só é enviado depois de fechado (já chegaram comandos de um segundo posterior)
  // ou quando o arquivo para de crescer por 1,5 s (ex.: no instante da falha).
  // Segundos sem comandos entre dois segundos com comandos vão como 0 (banco fora do ar).
  setInterval(() => {
    try {
      if (dataTail.runId !== currentRunId) resetDataTail();
      if (!currentRunId || !fs.existsSync(inputPath)) return;

      const size = fs.statSync(inputPath).size;
      if (size < dataTail.offset) {            // arquivo recriado
        dataTail.offset = 0;
        dataTail.partial = "";
      }
      if (size > dataTail.offset) {
        const MAX_CHUNK = 32 * 1024 * 1024;
        const len = Math.min(size - dataTail.offset, MAX_CHUNK);
        const buf = Buffer.alloc(len);
        const fd = fs.openSync(inputPath, "r");
        try { fs.readSync(fd, buf, 0, len, dataTail.offset); } finally { fs.closeSync(fd); }
        dataTail.offset += len;
        dataTail.lastGrowthMs = Date.now();

        const text = dataTail.partial + buf.toString("utf8");
        const lines = text.split("\n");
        dataTail.partial = lines.pop();          // última linha pode estar incompleta
        for (const line of lines) {
          const parts = line.split(",");
          if (parts.length < 6) continue;
          const typeStr = parts[5].trim();
          if (typeStr !== "N" && typeStr !== "A") continue;
          const timeUs = parseInt(parts[3], 10);
          if (!Number.isFinite(timeUs)) continue;
          const sec = Math.floor(timeUs / 1000000);
          if (sec <= dataTail.lastEmitted) continue; // segundo já enviado
          dataTail.counts.set(sec, (dataTail.counts.get(sec) || 0) + 1);
          if (sec > dataTail.maxSec) dataTail.maxSec = sec;
        }
      }

      // Segundos prontos para envio
      const idle = Date.now() - dataTail.lastGrowthMs > 1500;
      const limit = idle ? dataTail.maxSec : dataTail.maxSec - 1;
      const ready = [...dataTail.counts.keys()].filter((sec) => sec <= limit).sort((x, y) => x - y);
      for (const sec of ready) {
        if (dataTail.lastEmitted >= 0) {
          const gap = sec - dataTail.lastEmitted;
          if (gap > 1 && gap <= 60) {
            for (let z = dataTail.lastEmitted + 1; z < sec; z++) {
              broadcast('data', { type: "TELEMETRY", channel: "data", runId: currentRunId, timestampUs: z * 1000000, value: 0 });
            }
          }
        }
        broadcast('data', { type: "TELEMETRY", channel: "data", runId: currentRunId, timestampUs: sec * 1000000, value: dataTail.counts.get(sec) });
        dataTail.counts.delete(sec);
        dataTail.lastEmitted = sec;
      }
    } catch (e) {}
  }, 500);

  // CPU
  setInterval(() => {
    if (!fs.existsSync(pathCpu)) return;
    try {
      const output = child_process.execSync(`tail -n 1000 ${pathCpu}`).toString('utf8');
      const lines = output.split('\n');
      lines.forEach((line) => {
        const parts = line.split(';');
        if (parts.length >= 3 && parts[0].match(/^\d+$/)) {
          const timeUs = parseInt(parts[0], 10);
          const val = parseFloat(parts[1].replace(',', '.'));
          if (!isNaN(timeUs) && !isNaN(val) && !sentCpuSeconds.has(timeUs)) {
            sentCpuSeconds.add(timeUs);
            if (sentCpuSeconds.size > 2000) sentCpuSeconds.delete(sentCpuSeconds.values().next().value);
            broadcast('cpu', { type: "TELEMETRY", channel: "cpu", runId: currentRunId, timestampUs: timeUs, value: val });
          }
        }
      });
    } catch (e) {}
  }, 500);

  // MEMORY
  setInterval(() => {
    if (!fs.existsSync(pathCpu)) return;
    try {
      const output = child_process.execSync(`tail -n 1000 ${pathCpu}`).toString('utf8');
      const lines = output.split('\n');
      lines.forEach((line) => {
        const parts = line.split(';');
        if (parts.length >= 3 && parts[0].match(/^\d+$/)) {
          const timeUs = parseInt(parts[0], 10);
          const val = parseFloat(parts[2].replace(',', '.'));
          if (!isNaN(timeUs) && !isNaN(val) && !sentMemSeconds.has(timeUs)) {
            sentMemSeconds.add(timeUs);
            if (sentMemSeconds.size > 2000) sentMemSeconds.delete(sentMemSeconds.values().next().value);
            broadcast('memory', { type: "TELEMETRY", channel: "memory", runId: currentRunId, timestampUs: timeUs, value: val });
          }
        }
      });
    } catch (e) {}
  }, 500);

  // LATENCIA
  setInterval(() => {
    if (!fs.existsSync(inputPath)) return;
    try {
      const output = child_process.execSync(`tail -n 1000 ${inputPath}`).toString('utf8');
      const lines = output.split('\n');
      lines.forEach((line) => {
        const parts = line.split(',');
        if (parts.length >= 6) {
          const typeStr = parts[5] ? parts[5].trim() : '';
          if (typeStr === 'N' || typeStr === 'A') {
            const timeUs = parseInt(parts[2], 10) || parseInt(parts[3], 10);
            const val = parseFloat(parts[4]);
            if (isNaN(timeUs) || isNaN(val)) {
              console.warn('LATENCIA_LINE_SKIPPED', { line, timeUs, val, parts });
            } else if (!sentLatIndices.has(timeUs)) {
              sentLatIndices.add(timeUs);
              if (sentLatIndices.size > 2000) sentLatIndices.delete(sentLatIndices.values().next().value);
              broadcast('latencia', { type: "TELEMETRY", channel: "latencia", runId: currentRunId, timestampUs: timeUs, value: val, metricType: typeStr });
            }
          }
        }
      });
    } catch (e) {}
  }, 500);
}

startCollectors();
migrateActiveBaseToLibrary();

// Tratamento global de erros de processo (Boas Práticas de Resiliência)
process.on('unhandledRejection', (reason, promise) => {
  console.error("Rejeição Não Tratada (Unhandled Rejection) detectada:", reason);
  // Log estruturado para diagnóstico sem derrubar o processo caso não seja fatal
});

// Não há supervisor reiniciando o Node (npm run start chama node server.js direto): sair aqui
// deixava a interface em "Backend disconnected" até alguém reiniciar o terminal. Agora o erro é
// registrado em src/backups/server_errors.log (com a pilha) e o backend continua no ar.
process.on('uncaughtException', (error) => {
  console.error("Exceção Não Capturada (Uncaught Exception) detectada:", error);
  try {
    const dir = path.join(rootPath, "src/backups");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "server_errors.log"), `[${new Date().toISOString()}] ${error && error.stack ? error.stack : String(error)}\n\n`);
  } catch (e) {}
});
