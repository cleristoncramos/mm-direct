# Guia de uso do Workbench

Este guia descreve cada parte do painel do MM-DIRECT, na ordem em que é usada num experimento. Os nomes entre aspas são os que aparecem na tela (o painel está em inglês; os relatórios em PDF, em português).

[← Voltar ao README](../README.md)

---

## Visão geral da tela

| Área | O que contém |
| --- | --- |
| Barra superior | Identificador do experimento (`run_AAAAMMDD_HHMMSS`), situação atual, durações medidas (preload, operação estável, recuperação), botões *Export*, *History* e *Start* / *End experiment* |
| Barra lateral (*Experiment setup*) | Base de dados, escolhas principais do experimento e *Advanced settings*. Recolhível pelo botão ☰ |
| Área central | Legenda das fases, gráfico de vazão (*Throughput*) e gráficos de CPU, memória (*Memory (RSS)*) e latência (*Server-side latency*) |
| Terminal | Saída do `redis-server` (*Show terminal* / *Hide terminal*) |

---

## 1. Barra lateral

### 1.1 Indexed database

Mostra a base que será usada e permite trocá-la. A seção abre e fecha com um clique no título (vem fechada).

- **Tamanho da base.** Quatro tamanhos pré-definidos:

  | Tamanho | Registros no log | Tuplas distintas |
  | --- | --- | --- |
  | Small | 100.000 | 500 |
  | Medium | 1.000.000 | 5.000 |
  | Large | 2.000.000 | 10.000 |
  | X-Large | 5.000.000 | 25.000 |

- **Biblioteca de bases.** Cada tamanho gerado fica guardado em `src/backups/bases/<tamanho>/`. Escolher um tamanho já gerado só troca a base ativa, sem gerar de novo.
- **Load database.** Gera uma base nova: inicia o Redis-IR com o memtier, grava o log sequencial (AOF), espera o indexador montar o log indexado e guarda tudo na biblioteca. Leva de segundos a vários minutos, conforme o tamanho e a máquina. O progresso aparece na própria seção e pode ser cancelado.
- **Restauração automática.** Antes de cada *Start*, a base ativa é copiada de volta para `src/logs/`, então todo experimento começa da mesma base. Em seguida o painel roda `sync`, para que a escrita pendente não concorra com o preload.
- Quando o *Start* for usar uma base diferente da selecionada, a seção mostra um aviso.

### 1.2 Experiment

As escolhas principais. Os campos numéricos aceitam digitação ou os botões ▲/▼.

| Campo | Opções | Efeito |
| --- | --- | --- |
| *Recovery technique* | Instant (IRAIL), Instant (sync) (IRSIL), Standard (SRSL) | Liga ou desliga a recuperação instantânea e a indexação síncrona |
| *Preload* | Sempre ligado | Antes da carga, o banco inteiro é carregado na memória (do log indexado na IR; do log sequencial na SRSL), simulando um banco que já estava em operação |
| *Checkpoint* | Ligado/desligado, intervalo | Grava checkpoints do log indexado periodicamente. O intervalo pode ser fixo ou ajustado automaticamente (*Advanced settings › Checkpointer*) |
| *Simulated failure* | Ligado/desligado, *Failure after* (s), *Failures* | Instante da falha, contado do início da operação estável, e número de falhas sucessivas. Cada falha é seguida de reinício, nova submissão da carga e recuperação |

### 1.3 Advanced settings

Parâmetros detalhados, com valores padrão. Cada grupo abre com um clique.

| Grupo | Exemplos de parâmetros |
| --- | --- |
| *Checkpointer* | Número de checkpoints, intervalo fixo ou auto-ajustado, somente tuplas mais usadas (MFU) |
| *Failure* | Atraso do reinício, falha por tempo ou após o preload |
| *Memtier* | Parâmetros do `memtier_benchmark` (número de requisições por cliente `-n`, intervalo de chaves, padrão de chaves, comandos) e número de rodadas |
| *Reports* | Geração dos CSV de comandos, indexação e monitoramento; intervalo do monitoramento de CPU/memória |

A lista completa dos parâmetros do `redis_ir.conf` está na [referência](referencia.md#3-parâmetros-do-redis_irconf).

---

## 2. Durante o experimento

### 2.1 Situações exibidas

| Situação | Significado |
| --- | --- |
| *Waiting* | Nenhum experimento em execução |
| *Preloading* | Carregando a base na memória |
| *Stable operation* | Carga rodando normalmente |
| *Failure triggered* | Falha simulada; o processo está reiniciando |
| *Recovering* | Recuperação em andamento (na IR, o banco já atende clientes) |
| *Running after recovery* | Recuperação concluída; a carga reenviada continua |
| *Completed* | Carga terminou após a última falha; experimento encerrado |
| *Failed* | Erro no preload ou na validação da recuperação |

### 2.2 Gráfico de vazão (*Throughput*)

- Uma linha contínua, do início ao fim, em operações por segundo. Quando o banco está fora do ar, a linha vai a zero, mas não é interrompida.
- Cor da linha por fase: azul (operação estável), âmbar (da falha ao fim da recuperação), verde (após a recuperação).
- Faixas de fundo: ciano (preload), vermelho (reinício entre a falha e a recuperação), âmbar (recuperação), violeta tracejada (checkpoint). Linha tracejada vermelha = falha simulada; linha verde = fim da recuperação, com o rótulo "*N* s (Recovery time)", como nas figuras da tese.
- O eixo horizontal é sempre "segundos desde o início do experimento" e é o mesmo nos quatro gráficos.

### 2.3 Fim do experimento

O experimento termina **sozinho** quando:

1. todas as falhas configuradas já ocorreram;
2. a última recuperação terminou; e
3. a carga reenviada após a última falha chegou ao fim.

Nesse momento o Redis-IR registra `WORKLOAD_FINISHED` e `EXPERIMENT_COMPLETED`, e o painel salva o ensaio em `src/runs/`. Com a carga padrão (`-n 5000`, isto é, 1.000.000 de operações), a carga reenviada leva alguns minutos numa máquina virtual.

*End experiment* interrompe o experimento a qualquer momento; o que já foi medido fica salvo.

---

## 3. Histórico (*History*)

### 3.1 Lista de experimentos

- Ordenação (*Newest first* / *Oldest first*), busca por texto (identificador, rótulo, etiquetas) e filtros por situação e por modo de recuperação (instantânea ou padrão).
- Datas no formato dd/mm/aa, hh:mm.
- *Archive* move o ensaio para `src/runs/_archive/` (nada é apagado). Para trazer de volta, marque *Show archived* e use *Restore*.

### 3.2 Detalhes de um experimento

- Durações medidas, parâmetros, linha do tempo de eventos (*Event timeline*), gráficos e arquivos do ensaio.
- *Notes*: rótulo (*Label*), etiquetas (*Tags*) e anotações livres, salvos em `annotations.json` na pasta do ensaio.
- *Export*: relatório em PDF (em português) e resumo em JSON.

### 3.3 Comparação

1. Clique em *Compare* e selecione 2 ou 3 experimentos concluídos. O primeiro escolhido é a referência (**RUN A**); os outros são RUN B e RUN C.
2. A aba *Side by side* mostra:
   - as diferenças de configuração entre os ensaios, com aviso quando eles não medem a mesma situação;
   - a tabela de medidas, com a diferença de cada ensaio para o RUN A (valor e percentual);
   - as curvas de vazão, CPU e memória sobrepostas, alinhadas no início (*Align at start*) ou no instante da falha (*Align at failure*).
3. A aba *Repetitions* agrupa ensaios com a mesma configuração e calcula média e desvio-padrão de cada medida, para avaliar a variação entre repetições.
4. *Export* gera o relatório comparativo em PDF, o JSON e o CSV da comparação.

O PDF só pode ser exportado depois que as curvas de todos os ensaios terminam de carregar.
