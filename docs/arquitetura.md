# Arquitetura do MM-DIRECT

[← Voltar ao README](../README.md)

O MM-DIRECT tem três camadas que rodam na mesma máquina: o **Redis-IR** (C), o **backend de controle** (Node.js) e o **Workbench** (React). Tudo é local para que a rede não interfira nas medições.

---

## 1. Redis-IR (`src/`)

Versão do Redis 5.0.7 com recuperação instantânea, criada na tese de doutorado do Prof. Arlino H. M. de Araújo (UFC, 2022).

| Componente | Onde fica | Função |
| --- | --- | --- |
| Log sequencial (AOF) | `src/logs/sequentialLog.aof` | Registro de todas as escritas, como no Redis original |
| Log indexado | `src/logs/indexedLog.db` | Árvore B+ da Berkeley DB, com os registros do log organizados por chave. Permite recuperar uma tupla sem reler o log inteiro |
| Indexador | `instant_recovery.c` | Lê o log sequencial e grava no log indexado. Assíncrono (padrão) ou síncrono (*Synchronous indexing*). A posição já indexada fica em `src/logs/finalLogSeek.dat` |
| Checkpointer | `instant_recovery.c` | Grava periodicamente o estado do log indexado (completo ou só tuplas mais usadas, MFU) |
| Restaurador | `instant_recovery.c` | Na recuperação, percorre o log indexado e carrega cada tupla com o comando interno `setIR` (que só grava se a chave não existir) |
| Carga sob demanda | `server.c` / `instant_recovery.c` | Quando um cliente pede uma chave ainda não restaurada, ela é buscada no log indexado na hora |
| Falha simulada | `instant_recovery.c` | Temporizador que, no instante configurado, grava um marcador em `src/temp_ir_files/` e reinicia o processo com `execve` |
| Estado do experimento | `server.h` (`experiment_*`) | Máquina de estados (preload, estável, falha, recuperação, concluído) e os eventos `EVENT_JSON` |
| Gerador de carga | `executeMemtierBenchmark` | Executa `memtier_benchmark` com os parâmetros do `redis_ir.conf`; o progresso vai para `src/logs/memtier_progress.log` |
| Relatórios | `instant_recovery.c` | CSV de comandos (`src/datasets/`), de indexação (`src/indexing_report/`) e de CPU/memória via `top` (`src/system_monitoring/`) |

A configuração vem de `redis_ir.conf` (na raiz do projeto), lido com a libconfig a cada início do processo, inclusive após uma falha simulada.

## 2. Backend de controle (`server.js`, porta 8081)

| Responsabilidade | Como |
| --- | --- |
| Configuração | `POST /config` recebe o formulário do painel; `config-mm-direct.js` reescreve o `redis_ir.conf` |
| Bases de dados | Prepara bases (`/api/prepare-database`), mantém a biblioteca em `src/backups/bases/<tamanho>/` (por *hardlink*, sem duplicar espaço em disco) e copia a base ativa para `src/logs/` antes de cada Start |
| Ciclo do ensaio | Cria `src/runs/run_<data>_<hora>/`, inicia `./redis-server` com a variável `RUN_ID`, lê a saída padrão e a de erro e, ao fim, copia CSVs e gera `results.json` e `export/report.json` |
| Telemetria ao vivo | Lê os CSV de forma incremental e envia por WebSocket a vazão por segundo, CPU, memória, latência e eventos |
| Histórico | `GET /api/runs`, telemetria de ensaios antigos, anotações e arquivamento |
| Painel | Na inicialização, instala as dependências de `web/` (se faltarem) e executa `npm run dev` |

**Canais WebSocket:** `/start`, `/stop`, `/control`, `/data`, `/cpu`, `/memory`, `/latencia`.

## 3. Workbench (`web/`, porta 5173)

React 18 + TypeScript + Vite 4 + Tailwind CSS + Chart.js.

| Pasta | Conteúdo |
| --- | --- |
| `web/src/componentes/Form/` | Barra lateral: *Indexed database*, *Experiment*, *Advanced settings* |
| `web/src/componentes/Charts/` | Gráficos ao vivo e as anotações de fase (`phaseAnnotations.ts`) |
| `web/src/componentes/History/` | Lista, filtros, anotações, comparação e repetições |
| `web/src/componentes/Report/` | Relatórios em PDF (ensaio individual e comparação) |
| `web/src/i18n/strings.ts` | Textos da interface |
| `web/src/store/` | Estado global (Zustand) |

## 4. Fluxo de um ensaio

```
Workbench           Backend (server.js)                    Redis-IR (redis-server)            memtier
   │ Start ─────────► POST /config → redis_ir.conf
   │                  restaura a base, sync
   │                  cria src/runs/run_…/, metadata.json
   │                  spawn ./redis-server (RUN_ID) ─────► RUN_STARTED, preload
   │ ◄── WebSocket ── lê log e CSV                         STABLE_OPERATION_STARTED ──────────► carga
   │                                                       FAILURE_TRIGGERED → execve
   │                                                       RECOVERY_STARTED / WORKLOAD_RESUMED ► carga reenviada
   │                                                       RECOVERY_COMPLETED
   │                                                       WORKLOAD_FINISHED ◄───────────────── fim da carga
   │                                                       EXPERIMENT_COMPLETED
   │ ◄── COMPLETED ── copia CSV, gera results.json,
   │                  export/report.json; encerra o Redis
```

O mesmo `RUN_ID` é mantido no reinício por `execve`, então a pasta do ensaio, a tela, os eventos e o PDF usam o mesmo identificador.
