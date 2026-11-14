# MM-DIRECT

**Bancada experimental para recuperação instantânea de bancos de dados em memória.**

O MM-DIRECT executa, mede e compara a recuperação de um banco de dados em memória após uma falha. O núcleo é o **Redis-IR**, uma versão do Redis 5.0.7 que acrescenta um **log indexado** (árvore B+ da Berkeley DB). Com ele, o banco volta a atender clientes logo após reiniciar, enquanto as tuplas são carregadas em segundo plano (incrementalmente) ou quando um cliente pede (sob demanda).

Sobre esse núcleo, o MM-DIRECT acrescenta um painel web (o *Workbench*). Ele serve para configurar o experimento, simular falhas, acompanhar vazão, CPU, memória e latência em tempo real, guardar o histórico e gerar relatórios e comparações em PDF.

---

## Sumário

1. [Técnicas de recuperação comparadas](#técnicas-de-recuperação-comparadas)
2. [Arquitetura](#arquitetura)
3. [Requisitos](#requisitos)
4. [Instalação](#instalação)
5. [Execução](#execução)
6. [Uso em cinco passos](#uso-em-cinco-passos)
7. [O que é medido](#o-que-é-medido)
8. [Estrutura do repositório](#estrutura-do-repositório)
9. [Documentação detalhada](#documentação-detalhada)
10. [Problemas comuns](#problemas-comuns)
11. [Limitações conhecidas](#limitações-conhecidas)
12. [Contexto acadêmico e créditos](#contexto-acadêmico-e-créditos)

---

## Técnicas de recuperação comparadas

| Sigla | Nome no painel | Como o banco é recuperado após a falha |
| --- | --- | --- |
| **IRAIL** | Instant | Recuperação instantânea com **log indexado assíncrono**. O banco atende clientes logo após reiniciar; as tuplas vêm do log indexado em segundo plano e sob demanda. A indexação do log ocorre fora do caminho da transação. |
| **IRSIL** | Instant (sync) | Igual à IRAIL, mas com **indexação síncrona**: cada escrita espera ser indexada antes de confirmar. |
| **SRSL** | Standard | Recuperação **padrão** do Redis: o log sequencial (AOF) é relido inteiro; o banco só atende clientes depois do fim da leitura. |

As siglas seguem a tese de doutorado de Araújo (2022), que deu origem ao Redis-IR. A tese também é a referência para o protocolo experimental e para o formato dos gráficos.

## Arquitetura

```
┌──────────────────────────── Navegador ────────────────────────────┐
│  Workbench (React + TypeScript + Vite + Tailwind + Chart.js)      │
│  http://localhost:5173                                             │
└──────────────┬───────────────────────────────▲─────────────────────┘
               │ HTTP (configuração, histórico)│ WebSocket (telemetria, eventos)
┌──────────────▼───────────────────────────────┴─────────────────────┐
│  Backend de controle (Node.js + Express + ws) — server.js :8081   │
│  • grava o redis_ir.conf  • inicia/encerra o redis-server          │
│  • lê os CSV e o log do Redis-IR  • salva cada ensaio em src/runs │
└──────────────┬─────────────────────────────────────────────────────┘
               │ processo filho (RUN_ID no ambiente)
┌──────────────▼─────────────────────────────────────────────────────┐
│  Redis-IR (C) — src/redis-server :6379                             │
│  • log sequencial (AOF)  • log indexado (Berkeley DB, B+-tree)     │
│  • indexador, checkpointer, restaurador, falha simulada            │
│  • dispara o memtier_benchmark como carga de trabalho              │
└────────────────────────────────────────────────────────────────────┘
```

Detalhes de cada camada estão em [docs/arquitetura.md](docs/arquitetura.md).

## Requisitos

| Item | Versão verificada | Observação |
| --- | --- | --- |
| Sistema operacional | **Ubuntu 24.04 LTS** (também roda no 20.04) | Testado em máquina virtual (VirtualBox) e em instalação limpa, em 14/11/2026 |
| Compilador | GCC 13.3 (`build-essential`) | |
| Berkeley DB | 5.3.28 (`libdb-dev`) | Log indexado |
| libconfig | 1.5 (`libconfig-dev`) | Leitura do `redis_ir.conf` |
| memtier_benchmark | 1.3.0 (código em `src/memtier_benchmark`) | Precisa de `libevent-dev`, `libssl-dev`, `zlib1g-dev`, `libpcre3-dev` e autotools |
| Node.js | 18 ou mais novo | Backend e painel |
| Utilitários | `psmisc` (`fuser`), `lsof`, `top` (procps) | Liberação de portas e monitoramento de CPU/memória |

O relatório de compatibilidade com o Ubuntu 24.04 está em [docs/compatibilidade-ubuntu-24.md](docs/compatibilidade-ubuntu-24.md).

## Instalação

```bash
# 1. Pacotes do sistema
sudo apt-get update
sudo apt-get install build-essential libdb-dev libconfig-dev \
  autoconf automake libtool pkg-config libevent-dev libssl-dev zlib1g-dev libpcre3-dev \
  psmisc lsof nodejs npm

# 2. Redis-IR (na raiz do projeto)
cd ~/Documentos/projeto/MM-DIRECT
make distclean   # só necessário se já houve uma compilação anterior
make

# 3. memtier_benchmark — precisa ficar no PATH, pois o Redis-IR o chama pelo nome
cd src/memtier_benchmark
autoreconf -ivf
./configure
make
sudo make install
memtier_benchmark --version     # deve mostrar 1.3.0

# 4. Dependências do backend (as do painel são instaladas na primeira execução)
cd ~/Documentos/projeto/MM-DIRECT
npm install
```

Passo a passo comentado, verificação e solução de erros de instalação: [docs/instalacao.md](docs/instalacao.md).

## Execução

```bash
cd ~/Documentos/projeto/MM-DIRECT
npm start
```

O `npm start` libera as portas 6379 e 8081 (pede a senha do `sudo`), inicia o backend e, a partir dele, o painel. Abra **http://localhost:5173** no navegador. Não é preciso rodar `npm run dev` em outro terminal.

Sempre que alterar arquivos em `src/*.c`, recompile com `make` antes do `npm start`.

## Uso em cinco passos

1. **Base de dados.** Na seção *Indexed database* da barra lateral, escolha o tamanho (Small, Medium, Large ou X-Large) e use a base da biblioteca ou gere uma nova com *Load database*. A base é restaurada automaticamente antes de cada experimento.
2. **Experimento.** Na seção *Experiment*, escolha a técnica (Instant, Instant (sync) ou Standard), o checkpoint e a falha simulada (instante e número de falhas). Os demais parâmetros ficam em *Advanced settings*.
3. **Start.** O painel mostra a fase atual (Preload, Stable operation, Simulated failure, Restart, Recovering, Running after recovery) e desenha a vazão, CPU, memória e latência em tempo real.
4. **Fim.** O experimento termina sozinho quando a carga reenviada após a última falha acaba. *End experiment* interrompe antes, se necessário.
5. **Histórico.** Em *History*, cada ensaio tem relatório em PDF, exportação em JSON/CSV, anotações e comparação de até três ensaios (RUN A, B e C), com as curvas alinhadas no início ou no instante da falha.

O guia completo da interface está em [docs/guia-de-uso.md](docs/guia-de-uso.md).

## O que é medido

| Medida | Definição |
| --- | --- |
| Duração do preload | Do início ao fim do carregamento inicial da base na memória |
| Operação estável até a falha | Do início da operação estável até a falha simulada |
| Intervalo falha → recuperação | Da falha ao início da recuperação (inclui o reinício do processo) |
| Tempo de recuperação | Do início ao fim da recuperação. Na IR, o banco já atende durante esse período; na SRSL, não |
| Execução da carga após a falha | Da falha até o fim da carga reenviada (*workload runtime*, como na tese) |
| Vazão, CPU, memória, latência | Séries por segundo; médias por fase (estável, recuperação, pós-recuperação) |
| Tuplas e inconsistências | Tuplas carregadas (incrementais e sob demanda) e falhas de carga |

Todos os tempos vêm de eventos estruturados (`EVENT_JSON`) gravados pelo Redis-IR com resolução de microssegundos. A lista de eventos, os arquivos de cada ensaio e os parâmetros do `redis_ir.conf` estão em [docs/referencia.md](docs/referencia.md). O protocolo experimental está em [docs/protocolo-experimental.md](docs/protocolo-experimental.md).

## Estrutura do repositório

```
MM-DIRECT/
├── server.js                 # Backend de controle: API HTTP, WebSockets, ciclo de vida do ensaio
├── config-mm-direct.js       # Gera o redis_ir.conf a partir da configuração do painel
├── redis_ir.conf             # Configuração ativa do Redis-IR (reescrita pelo painel a cada Start)
├── package.json              # Scripts (npm start) e dependências do backend
├── Makefile                  # Compila src/ e deps/
├── src/                      # Redis-IR (C)
│   ├── instant_recovery.c    # Indexador, checkpointer, restaurador, falha simulada, eventos
│   ├── server.c / server.h   # Núcleo do Redis com o estado do experimento
│   ├── memtier_benchmark/    # Código do gerador de carga (versão 1.3.0)
│   ├── logs/                 # (local) log sequencial e log indexado em uso
│   ├── backups/              # (local) base ativa e biblioteca de bases por tamanho
│   └── runs/                 # (local) um diretório por ensaio
├── deps/                     # Dependências do Redis (hiredis, jemalloc, Lua, linenoise)
├── web/                      # Painel (React + TypeScript + Vite)
│   └── src/componentes/      # Charts, Form (barra lateral), History, Report (PDF)
├── docs/                     # Documentação, manuais e exemplos de relatório
├── tests/, utils/            # Testes e utilitários do Redis original
└── _arquivo/                 # Material histórico, não usado pelo sistema
```

Pastas marcadas como *(local)* contêm dados gerados na máquina e não vão para o Git (veja `.gitignore`).

## Documentação detalhada

| Documento | Conteúdo |
| --- | --- |
| [docs/instalacao.md](docs/instalacao.md) | Instalação comentada, verificação e erros de compilação |
| [docs/guia-de-uso.md](docs/guia-de-uso.md) | Cada seção do Workbench e do histórico |
| [docs/protocolo-experimental.md](docs/protocolo-experimental.md) | Fases do ensaio, métricas, boas práticas para a dissertação |
| [docs/arquitetura.md](docs/arquitetura.md) | Camadas, fluxo de um ensaio, comunicação entre processos |
| [docs/referencia.md](docs/referencia.md) | Eventos, arquivos de cada ensaio, parâmetros do `redis_ir.conf`, API do backend |
| [docs/compatibilidade-ubuntu-24.md](docs/compatibilidade-ubuntu-24.md) | Verificação no Ubuntu 24.04 (14/11/2026) |
| [docs/manuais/](docs/manuais/) | Manual original do Redis-IR (pt-br e en) e opções do memtier |
| [docs/exemplos-relatorios/](docs/exemplos-relatorios/) | Exemplos de relatório e comparação em PDF |

## Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| `fatal error: libconfig.h: No such file or directory` | `libconfig-dev` não instalado | `sudo apt-get install libconfig-dev` |
| Carga termina em 0,002 s; log mostra `memtier_benchmark: not found` | memtier não instalado no PATH | `cd src/memtier_benchmark && sudo make install` |
| Experimento não termina depois da recuperação | Backend antigo, sem leitura da saída de erro do memtier | Atualize o código, rode `make` e reinicie o `npm start` |
| Mudança no C não tem efeito | `redis-server` não recompilado | `make` na raiz e reinicie o `npm start` |
| `npm` não encontra `package.json` | Comando rodado fora da pasta do projeto | `cd ~/Documentos/projeto/MM-DIRECT` antes do `npm start` |

Mais casos em [docs/instalacao.md](docs/instalacao.md#solução-de-problemas).

## Limitações conhecidas

- **Validação da recuperação instantânea sob alta concorrência.** Se uma chave é carregada sob demanda no mesmo instante em que o restaurador a carrega, a contagem a registra como inconsistência e o ensaio pode ser marcado como falho. Ocorreu em 1 de 6 ensaios IRAIL numa máquina rápida de 2 núcleos; não ocorreu na máquina virtual usada nos experimentos. Detalhes em [docs/compatibilidade-ubuntu-24.md](docs/compatibilidade-ubuntu-24.md).
- **Tempos dependem da máquina.** A mesma base levou cerca de 242 s para ser recuperada (IRAIL) na máquina virtual e cerca de 11 s numa máquina física. Compare apenas ensaios feitos no mesmo ambiente.
- **Cache do sistema operacional.** A base é restaurada do backup antes de cada Start, então o log costuma estar no cache de disco (cache quente). Isso é registrado no relatório.
- **Somente Linux.** O controle de processos e o monitoramento usam `fuser`, `lsof` e `top`.

## Contexto acadêmico e créditos

O MM-DIRECT é desenvolvido como ferramenta de instrumentação e coleta de dados para pesquisa em bancos de dados em memória e recuperação instantânea na Universidade Federal do Piauí (UFPI).

* **Redis-IR** (recuperação instantânea com log indexado), base do motor de banco de dados: Prof. Arlino Henrique Magalhães de Araújo (UFPI), desenvolvido em sua tese de doutorado.
* **Primeira versão do painel de monitoramento** (2023–2024): Manoel Rocha ([@ManoelRochadev](https://github.com/ManoelRochadev)) e Airck Lima ([@AirckLima](https://github.com/AirckLima)). O histórico de commits dessa fase está preservado no repositório anterior do projeto.
* **Desenvolvimento atual do MM-DIRECT**: Cleriston ([@cleristoncramos](https://github.com/cleristoncramos)).

Referência do protocolo experimental: ARAÚJO, Arlino Henrique Magalhães de. *Main Memory Database Instant Recovery*. Tese (Doutorado em Ciência da Computação) – Universidade Federal do Ceará, Fortaleza, 2022.

## Licença

O código derivado do Redis segue a licença BSD de 3 cláusulas do projeto original (arquivo [COPYING](COPYING)).
