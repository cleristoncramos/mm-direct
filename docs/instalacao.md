# Instalação do MM-DIRECT

Este guia instala o MM-DIRECT do zero no **Ubuntu 24.04 LTS**. Os mesmos passos valem para o Ubuntu 22.04 e 20.04. Leva cerca de 10 minutos.

[← Voltar ao README](../README.md)

---

## 1. Pacotes do sistema

```bash
sudo apt-get update
sudo apt-get install build-essential libdb-dev libconfig-dev \
  autoconf automake libtool pkg-config libevent-dev libssl-dev zlib1g-dev libpcre3-dev \
  psmisc lsof nodejs npm
```

| Pacote | Para que serve |
| --- | --- |
| `build-essential` | GCC, `make` e cabeçalhos da biblioteca C |
| `libdb-dev` | Berkeley DB 5.3, que guarda o **log indexado** (árvore B+) |
| `libconfig-dev` | Leitura do `redis_ir.conf` pelo Redis-IR |
| `autoconf automake libtool pkg-config` | Geração do script de compilação do memtier |
| `libevent-dev libssl-dev zlib1g-dev libpcre3-dev` | Bibliotecas exigidas pelo memtier_benchmark 1.3.0 |
| `psmisc lsof` | `fuser` e `lsof`, usados para liberar as portas 6379 e 8081 |
| `nodejs npm` | Backend de controle e painel web (Node.js 18 ou mais novo) |

O `libconfig-dev` e o `libpcre3-dev` ficam no repositório *universe* do Ubuntu, que já vem habilitado na instalação padrão.

## 2. Compilar o Redis-IR

```bash
cd ~/Documentos/projeto/MM-DIRECT
make distclean
make
```

- O `make distclean` apaga compilações anteriores. Use-o na primeira instalação, depois de atualizar o Ubuntu e sempre que trocar de máquina. Assim nenhum arquivo compilado por outro GCC fica misturado no executável.
- A compilação leva cerca de 1 minuto e gera `src/redis-server`.
- Avisos (*warnings*) são esperados: cerca de 20, vindos do jemalloc, do Lua e de `displayRestorerInformation` em `instant_recovery.c`. Erros (*error*) não são.

Verificação:

```bash
ls -la src/redis-server
readelf -d src/redis-server | grep NEEDED    # deve listar libdb-5.3.so e libconfig.so
```

## 3. Compilar e instalar o memtier_benchmark

O Redis-IR inicia a carga de trabalho com o comando `memtier_benchmark` **sem caminho**. Por isso o programa precisa estar instalado no sistema (no `PATH`).

```bash
cd ~/Documentos/projeto/MM-DIRECT/src/memtier_benchmark
autoreconf -ivf
./configure
make
sudo make install
memtier_benchmark --version     # deve mostrar: memtier_benchmark 1.3.0
```

Sem esse passo, a carga "termina" em cerca de 0,002 s e o log do experimento mostra `sh: 1: memtier_benchmark: not found`.

## 4. Dependências do backend e do painel

```bash
cd ~/Documentos/projeto/MM-DIRECT
npm install
```

As dependências do painel (`web/`) são instaladas automaticamente na primeira vez que o backend é iniciado. Para instalá-las antes:

```bash
cd web && npm install && cd ..
```

## 5. Primeira execução

```bash
cd ~/Documentos/projeto/MM-DIRECT
npm start
```

O `npm start`:

1. encerra processos que estejam ocupando as portas 6379 (Redis) e 8081 (backend), usando `sudo fuser` (pede a senha);
2. apaga o log sequencial (`src/logs/sequentialLog.aof`) de uma execução anterior;
3. inicia o backend (`node server.js`), que por sua vez inicia o painel (`npm run dev` em `web/`).

Abra **http://localhost:5173**. Na primeira vez, gere uma base em *Indexed database → Load database* (veja o [guia de uso](guia-de-uso.md)).

Para encerrar, use `Ctrl+C` no terminal do `npm start`.

## Atualizar depois de mudanças no código

| O que mudou | O que fazer |
| --- | --- |
| Arquivos em `src/*.c` ou `src/*.h` | `make` na raiz e reiniciar o `npm start` |
| `server.js` ou `config-mm-direct.js` | Reiniciar o `npm start` |
| Arquivos em `web/src` | Nada: o painel recarrega sozinho; se não, recarregue a página |
| `package.json` | `npm install` (e `cd web && npm install` se for o do painel) |

---

## Solução de problemas

| Mensagem ou sintoma | Causa | Solução |
| --- | --- | --- |
| `fatal error: libconfig.h: No such file or directory` | `libconfig-dev` ausente | `sudo apt-get install libconfig-dev` e `make` |
| `fatal error: db.h: No such file or directory` | `libdb-dev` ausente | `sudo apt-get install libdb-dev` e `make` |
| `No rule to make target '../deps/jemalloc/include/jemalloc/jemalloc.h'` | `make -j` na primeira compilação | Rode `make` sem `-j` |
| `configure: error: pcre is required` (memtier) | `libpcre3-dev` ausente | `sudo apt-get install libpcre3-dev` e repita o `./configure` |
| `memtier_benchmark: not found` no log | memtier não instalado | Passo 3 (`sudo make install`) |
| `npm error enoent Could not read package.json` | Terminal fora da pasta do projeto | `cd ~/Documentos/projeto/MM-DIRECT` |
| `cd: comando não encontrado` ou `^[[200~` no começo da linha | Colagem inseriu caracteres de controle | Digite o comando ou cole uma linha por vez |
| Porta 6379 ou 8081 em uso | Redis ou backend de outra execução | `sudo fuser -k 6379/tcp 8081/tcp` |
| Experimento não encerra após a recuperação | `server.js` antigo, sem leitura da saída de erro do memtier | Atualize o código e reinicie; o progresso do memtier vai para `src/logs/memtier_progress.log` |
| Mudança no C sem efeito | `redis-server` não recompilado | `make` e reinicie o `npm start` |
| Arquivo volta à versão antiga sozinho | Editor (VS Code) salvou um buffer antigo por cima | Feche a aba sem salvar e confira o arquivo |
