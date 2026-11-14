# Protocolo experimental

Este documento descreve como um ensaio do MM-DIRECT acontece, o que cada medida significa e como planejar experimentos comparáveis.

[← Voltar ao README](../README.md)

---

## 1. Fases de um ensaio

```
 início                      falha                 fim da recuperação          fim da carga
   │◄── preload ──►│◄─ operação estável ─►│◄ reinício ►│◄─ recuperação ─►│◄─ pós-recuperação ─►│
   │               │   (carga rodando)    │            │                 │  (carga reenviada)  │
   RUN_STARTED     STABLE_OPERATION_      FAILURE_     RECOVERY_         RECOVERY_             WORKLOAD_FINISHED
   PRELOAD_STARTED STARTED                TRIGGERED    STARTED           COMPLETED             EXPERIMENT_COMPLETED
```

1. **Preload.** O banco é carregado inteiro na memória a partir da base: do log indexado (recuperação instantânea) ou do log sequencial (recuperação padrão). Simula um banco que já estava em operação antes do experimento.
2. **Operação estável.** O memtier envia a carga de trabalho. O temporizador da falha começa a contar aqui.
3. **Falha simulada.** No instante configurado, o Redis-IR grava um marcador de falha e se reinicia (`execve`). O conteúdo da memória é perdido, como numa queda real.
4. **Reinício.** O processo volta e identifica que é a continuação do mesmo ensaio (`RUN_CONTINUED_AFTER_FAILURE`), com o mesmo identificador.
5. **Recuperação.**
   - **Recuperação instantânea:** o banco volta a aceitar conexões **antes** de recuperar as tuplas. A carga é reenviada logo (`WORKLOAD_RESUMED`). As tuplas vêm do log indexado em segundo plano (carga incremental) ou quando um cliente pede uma chave ainda não carregada (carga sob demanda).
   - **Recuperação padrão:** o log sequencial é relido inteiro; só depois o banco aceita conexões e a carga é reenviada.
6. **Pós-recuperação.** A carga reenviada continua até o fim. Se houver mais falhas configuradas, o ciclo 3–6 se repete.
7. **Fim.** Quando a carga reenviada após a última falha termina, o Redis-IR registra `WORKLOAD_FINISHED`, encerra as threads e registra `EXPERIMENT_COMPLETED`.

A carga é **reenviada inteira** após cada reinício. O ensaio termina quando essa carga acaba, e não quando a recuperação acaba.

## 2. Medidas

| Medida | Eventos usados | Comentário |
| --- | --- | --- |
| Duração do preload | `PRELOAD_STARTED` → `PRELOAD_COMPLETED` | Na recuperação instantânea, dividida em contagem do log e leitura do log indexado (com taxa em registros/s) |
| Operação estável até a falha | `STABLE_OPERATION_STARTED` → `FAILURE_TRIGGERED` | Deve ser igual ao configurado (ex.: 30 s) |
| Intervalo falha → recuperação | `FAILURE_TRIGGERED` → `RECOVERY_STARTED` | Tempo de reinício do processo, incluindo o atraso configurado |
| Tempo de recuperação | `RECOVERY_STARTED` → `RECOVERY_COMPLETED` | Na recuperação instantânea, o banco atende durante todo esse intervalo; na padrão, fica indisponível |
| Tuplas carregadas | `RECOVERY_COMPLETED` | Na recuperação instantânea, dividida em incrementais e sob demanda |
| Registros processados | `RECOVERY_COMPLETED` | Registros do log lidos na recuperação |
| Inconsistências | `RECOVERY_COMPLETED` | Cargas que não puderam ser aplicadas (veja a seção 5) |
| Vazão (ops/s) | `datasets.csv` | Média por fase: estável, recuperação, pós-recuperação; e pico |
| CPU e memória residente | `system_monitoring.csv` | Amostras do `top`; CPU em % de um núcleo (pode passar de 100%) |

Todos os instantes vêm de eventos `EVENT_JSON` com resolução de microssegundos, relativos ao início do experimento (`runStartUs`).

### Como comparar os dois modos

O tempo de recuperação **não mede a mesma coisa** nos dois modos. Na recuperação instantânea, ela acontece com o banco já atendendo. Na padrão, o banco fica fora do ar até o fim. Para comparar disponibilidade e desempenho percebido, use:

- **o intervalo até o banco voltar a atender**: falha → `WORKLOAD_RESUMED`;
- **a curva de vazão alinhada no instante da falha** (comparação com *Align at failure*).

## 3. Planejamento de um experimento

| Decisão | Recomendação |
| --- | --- |
| Tamanho da base | Comece pela Medium (1.000.000 registros, 5.000 tuplas). A vantagem da recuperação instantânea aparece mais em bases maiores, quando reler o log sequencial inteiro custa caro |
| Carga | Mantenha os mesmos parâmetros do memtier entre os ensaios comparados. Para testes rápidos, reduza o `-n` (ex.: `-n 1000` = 200.000 operações) |
| Instante da falha | Escolha um valor em que a carga ainda esteja rodando (ex.: 30 s) |
| Repetições | Pelo menos 3 por modo e configuração; use a aba *Repetitions* para média e desvio-padrão |
| Ambiente | Mesma máquina, mesmos recursos de CPU e memória, sem outras tarefas pesadas. Registre o número de núcleos e a memória da máquina virtual |
| Cache de disco | A base restaurada antes de cada Start fica no cache do sistema operacional (cache quente). Para medir com cache frio, limpe o cache antes do Start (`sync; echo 3 \| sudo tee /proc/sys/vm/drop_caches`) e registre isso nas notas do ensaio |

### Roteiro sugerido para comparar a recuperação instantânea com a padrão

1. Gere ou selecione a base (*Indexed database*).
2. Fixe a falha (ex.: 30 s, 1 falha) e a carga.
3. Rode um ensaio com *Instant* e outro com *Standard*, e repita o par 3 vezes.
4. Dê rótulo e etiquetas a cada ensaio (ex.: `medium`, `rodada-1`).
5. Em *History*, use *Repetitions* para as médias e *Side by side* (alinhado na falha) para as figuras.

## 4. Falhas sucessivas e checkpoints

- **Falhas sucessivas** (*Failures* > 1): cada falha é seguida de reinício, recuperação e nova submissão da carga. O gráfico e o relatório mostram todos os ciclos, com o tempo de recuperação de cada um.
- **Checkpoint** (IR): grava periodicamente o estado do log indexado, encurtando a recuperação. Os períodos de checkpoint aparecem como faixas violeta no gráfico e numa tabela do relatório (`CHECKPOINT_STARTED`, `CHECKPOINT_FINISHED`, `CHECKPOINT_INTERRUPTED`).

## 5. Validação da recuperação

Ao fim de cada recuperação, o Redis-IR compara o número de tuplas carregadas com o esperado e conta as inconsistências. Se carregou menos que o esperado ou houve inconsistência, registra `RECOVERY_FAILED` e `EXPERIMENT_FAILED`.

**Atenção à concorrência.** Na recuperação instantânea, se um cliente pede uma chave no mesmo instante em que o restaurador vai carregá-la, a chave é carregada sob demanda e o comando do restaurador (`setIR`, que só grava se a chave não existir) não tem efeito. A contagem atual registra isso como inconsistência e conta a chave duas vezes. Numa máquina rápida e com vários núcleos, isso pode marcar um ensaio correto como falho: aconteceu em 1 de 6 ensaios com recuperação instantânea num teste em 14/11/2026. Ensaios marcados como *Failed* por esse motivo mostram mais de 100% das tuplas esperadas (ex.: 5.166 de 5.000).
