# Referência técnica

Eventos registrados pelo Redis-IR, arquivos gerados em cada ensaio, parâmetros do `redis_ir.conf` e API do backend.

[← Voltar ao README](../README.md)

---

## 1. Eventos estruturados

O Redis-IR grava cada marco do experimento no log em duas linhas: `EVENT <NOME> chave=valor…` (legível) e `EVENT_JSON {…}` (lida pelo backend). Todo evento traz `runId`, `timestampUs` (relógio do sistema, em µs) e, quando aplicável, `runStartUs` e `relativeMs` (milissegundos desde o início do experimento).

| Evento | Quando ocorre | Campos principais |
| --- | --- | --- |
| `RUN_STARTED` | Início do processo do experimento | `runStartUs` |
| `PRELOAD_STARTED` | Início do carregamento inicial | `expectedTuples`, `distinctTuples` |
| `PRELOAD_COMPLETED` | Fim do carregamento inicial | `durationMs`, `loadedTuples`, `recordsProcessed`, `inconsistencies` |
| `PRELOAD_FAILED` | Base vazia, ausente ou carregamento incompleto | `reason` |
| `STABLE_OPERATION_STARTED` | Início da operação estável | |
| `FAILURE_TIMER_STARTED` | Temporizador da falha armado | `durationMs`, `durationSeconds` |
| `FAILURE_TRIGGERED` | Falha simulada; o processo vai reiniciar | |
| `RUN_CONTINUED_AFTER_FAILURE` | Processo reiniciado reconhece o mesmo ensaio | `runStartUs` |
| `RECOVERY_STARTED` | Início da recuperação | `technique` (SRSL) ou `expectedTuples` (IR) |
| `WORKLOAD_RESUMED` | Carga reenviada após o reinício | |
| `RECOVERY_COMPLETED` | Fim da recuperação | `durationMs`, `loadedTuples`, `recordsProcessed`, `inconsistencies` |
| `RECOVERY_FAILED` | Validação da recuperação falhou | `reason` |
| `POST_RECOVERY_STABLE` | Banco recuperado, de volta à operação normal | |
| `CHECKPOINT_STARTED` / `CHECKPOINT_FINISHED` / `CHECKPOINT_INTERRUPTED` | Ciclo de checkpoint | `checkpointId`, `kind` (FULL ou MFU), `keys` |
| `WORKLOAD_FINISHED` | Memtier terminou a carga | |
| `WORKLOAD_STOPPED` | Carga interrompida antes do fim | |
| `THREADS_CLEANUP_COMPLETED` | Threads do Redis-IR encerradas | |
| `EXPERIMENT_COMPLETED` | Experimento concluído | |
| `EXPERIMENT_FAILED` | Experimento encerrado por erro | `reason` |

## 2. Arquivos de um ensaio

Cada ensaio fica em `src/runs/run_AAAAMMDD_HHMMSS/`. Ensaios arquivados vão para `src/runs/_archive/`.

| Arquivo | Conteúdo |
| --- | --- |
| `metadata.json` | Configuração usada (todos os parâmetros do painel), modo de recuperação, base usada (tamanho, registros, tuplas, tempo de restauração do backup), caminhos |
| `logs.txt` | Saída completa do `redis-server`, incluindo as linhas `EVENT` e `EVENT_JSON` |
| `results.json` | **Fonte principal dos resultados**: eventos, durações, tuplas, registros, inconsistências, divisão da leitura do log (contagem e leitura, com taxa), lista ordenada de eventos (`eventList`) e tamanhos dos logs |
| `datasets.csv` | Um comando por linha: `key,command,startTime,finishTime,latency,type` (tempos em µs). `type`: N (comando normal, com a tupla já na memória), A (comando que precisou carregar a tupla sob demanda), D (marco, como `Database startup`) |
| `system_monitoring.csv` | `time;cpu;memory`: instante (µs), CPU do `redis-server` em % de um núcleo, memória residente em KiB |
| `indexing.csv` | Progresso do indexador ao longo do tempo |
| `memtier_progress.log` | Última linha de progresso do memtier |
| `annotations.json` | Rótulo, etiquetas e notas digitados no histórico |
| `export/report.json` | Resumo gerado para exportação (versão anterior do formato). Para tempos e fases, prefira `results.json` |

Os relatórios em PDF são gerados no navegador, a partir de `results.json` e dos CSV, e não ficam gravados na pasta do ensaio.

## 3. Parâmetros do `redis_ir.conf`

O arquivo fica na raiz do projeto e é reescrito pelo painel a cada Start e a cada *Load database*. Valores `"ON"`/`"OFF"` ligam e desligam recursos.

### Indexador e log

| Parâmetro | Efeito |
| --- | --- |
| `aof_filename` | Caminho do log sequencial (`logs/sequentialLog.aof`) |
| `instant_recovery_state` | `ON` = recuperação instantânea (IRAIL/IRSIL); `OFF` = recuperação padrão (SRSL) |
| `instant_recovery_synchronous` | `ON` = indexação síncrona (IRSIL); `OFF` = assíncrona (IRAIL) |
| `indexedlog_structure` | Estrutura do log indexado (`BTREE`) |
| `indexedlog_filename` | Caminho do log indexado (`logs/indexedLog.db`) |
| `starts_log_indexing` | Início da indexação assíncrona: antes (`B`) ou depois (`A`) da recuperação |
| `indexer_time_interval` | Intervalo entre ciclos do indexador, em µs (0 = contínuo) |
| `display_indexer_information`, `indexer_information_time_interaval` | Mensagens periódicas do indexador no log |
| `display_restorer_information`, `restorer_information_time_interaval` | Mensagens periódicas do restaurador no log |
| `indexedlog_replicated`, `indexedlog_replicated_filename` | Réplica do log indexado |
| `log_corruption`, `rebuild_indexedlog` | Simulação de corrupção do log indexado e reconstrução |

### Checkpoint

| Parâmetro | Efeito |
| --- | --- |
| `checkpoint_state` | Liga os checkpoints |
| `checkpoints_only_mfu`, `num_mfu_tuples` | Checkpoint só das tuplas mais usadas |
| `number_checkpoints` | Quantidade de checkpoints (0 = contínuo) |
| `selftune_checkpoint_time_interval` | Ajuste automático do intervalo |
| `checkpoint_time_interval` | Intervalo fixo entre checkpoints (s) |
| `first_checkpoint_start_time` | Atraso do primeiro checkpoint (s) |
| `stop_checkpoint_after_benchmark` | Para os checkpoints quando a carga termina |

### Falha simulada

| Parâmetro | Efeito |
| --- | --- |
| `restart_daley_time` | Atraso antes do reinício (s) |
| `restart_after_time` | Instante da falha, contado do início da operação estável (s) |
| `number_restarts_after_time` | Número de falhas por tempo |
| `preload_database_and_restart`, `number_restarts_after_preloading` | Falha logo após o preload |

### Carga (memtier)

| Parâmetro | Efeito |
| --- | --- |
| `memtier_benchmark_state` | Liga a carga automática |
| `memtier_benchmark_workload_run_times` | Quantas vezes a carga é executada (0 = contínuo) |
| `memtier_benchmark_parameters` | Parâmetros passados ao `memtier_benchmark` |
| `restart_after_bechmarking` | Reinícios após o fim da carga |
| `time_tostop_benchmarking` | Interrompe a carga após N segundos (0 = desligado) |

Parâmetros do memtier mais usados: `-n` (requisições por cliente; o total é `-n × 50 clientes × 4 threads`), `--key-minimum`/`--key-maximum` (intervalo de chaves), `--command` e `--command-ratio`, `--command-key-pattern` (`S` sequencial, `R` aleatório). Lista completa em [manuais/memtier_benchmark-usage-options.pdf](manuais/memtier_benchmark-usage-options.pdf).

### Relatórios e monitoramento

| Parâmetro | Efeito |
| --- | --- |
| `generate_recovery_report`, `recovery_report_filename` | Relatório textual da recuperação |
| `generate_executed_commands_csv`, `executed_commands_csv_filename` | CSV de comandos (base do gráfico de vazão) |
| `generate_indexing_report_csv`, `indexing_report_csv_filename` | CSV do indexador |
| `overwrite_report_files` | Sobrescreve os relatórios após um reinício (use `OFF` em experimentos com falha) |
| `system_monitoring`, `system_monitoring_csv_filename`, `system_monitoring_time_interval` | Monitoramento de CPU e memória (intervalo em s) |
| `stop_system_monitoring_end_benckmark`, `overwrite_system_monitoring` | Fim e sobrescrita do monitoramento |

A grafia dos nomes (`daley`, `interaval`, `bechmarking`, `benckmark`) é a do Redis-IR original e deve ser mantida.

## 4. API do backend (porta 8081)

| Método e rota | Função |
| --- | --- |
| `POST /config` | Recebe a configuração do painel e grava o `redis_ir.conf` |
| `GET /api/runs/current` | Ensaio em andamento |
| `GET /api/runs` | Lista de ensaios (`?archived=1` para os arquivados) |
| `GET /api/runs/:runId/telemetry` | Séries de vazão, CPU e memória de um ensaio |
| `PUT /api/runs/:runId/annotations` | Grava rótulo, etiquetas e notas |
| `POST /api/runs/:runId/archive`, `/unarchive` | Arquiva e restaura um ensaio |
| `GET /api/database-status` | Situação da base ativa |
| `GET /api/database-size-presets` | Tamanhos de base e quais já estão na biblioteca |
| `POST /api/select-database` | Ativa uma base da biblioteca |
| `POST /api/prepare-database`, `GET …/status`, `POST …/cancel` | Gera uma base nova, acompanha e cancela |
| `POST /api/restore-database` | Restaura a base ativa a partir do backup |

**WebSockets:** `/start` (inicia), `/stop` (*End experiment*), `/control` (eventos e situação), `/data` (vazão), `/cpu`, `/memory`, `/latencia`.
