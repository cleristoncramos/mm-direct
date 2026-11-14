# Compatibilidade com o Ubuntu 24.04 LTS

Verificação feita em 14/11/2026. [← Voltar ao README](../README.md)

**Conclusão: o MM-DIRECT funciona no Ubuntu 24.04.** Todas as bibliotecas usadas têm pacote oficial no 24.04, inclusive a Berkeley DB 5.3 do log indexado. Os problemas encontrados vêm da documentação de instalação e de uma condição de corrida, e não da versão do sistema.

---

## 1. Máquina de desenvolvimento (VirtualBox, atualizada do 20.04 para o 24.04)

| Item | Encontrado |
| --- | --- |
| `src/redis-server` | Compilado com GCC 13.3.0 do Ubuntu 24.04; exige glibc 2.38; usa `libdb-5.3.so` e `libconfig.so.9` |
| `memtier_benchmark` 1.3.0 | Compilado no 24.04 (Linux 6.8, OpenSSL 3, libevent 2.1) |
| Experimentos de 14/11/2026 | Recuperação instantânea (assíncrona e síncrona) e padrão, com falha simulada; 5.000 tuplas recuperadas; 0 inconsistências |
| Observação | Cerca de 20 arquivos objeto de 13/07/2026, compilados com o GCC 9.4 do 20.04, ainda estavam no `src/`. Recomenda-se `make distclean && make` |

## 2. Instalação limpa (Ubuntu 24.04.5, GCC 13.3, Node.js 22)

| Etapa | Resultado |
| --- | --- |
| Redis-IR (`make`) | Compilou em 62 s, sem erros. 22 avisos: 18 do jemalloc e do Lua, 4 de `displayRestorerInformation` (`-Wstringop-overflow`, inofensivos) |
| memtier_benchmark 1.3.0 | Compilou sem avisos |
| `server.js` | Sintaxe verificada no Node 22. O painel usa Vite 4 e React 18 (Node 14.18 ou mais novo) |
| Base de teste | 1.000.000 registros, 5.000 tuplas, log indexado de 108 MB, gerada pelo próprio Redis-IR |

### Pacotes no Ubuntu 24.04 (noble)

| Biblioteca | Pacote |
| --- | --- |
| Berkeley DB 5.3 | `libdb-dev` 5.3.21ubuntu2 → `libdb5.3-dev` 5.3.28+dfsg2-7 (main) — [packages.ubuntu.com](https://packages.ubuntu.com/noble/libdb-dev) |
| libconfig | `libconfig-dev` 1.5-0.4build2 (universe) — [Launchpad](https://launchpad.net/ubuntu/noble/+package/libconfig-dev) |
| libevent | `libevent-dev` 2.1.12-stable-9ubuntu2 (main) — [Launchpad](https://launchpad.net/ubuntu/noble/+package/libevent-dev) |
| PCRE (antiga) | `libpcre3-dev` 2:8.39-15build1 (universe) — [packages.ubuntu.com](https://packages.ubuntu.com/en/noble/libpcre3-dev) |

## 3. Experimentos na instalação limpa

Falha 10 s após o início da operação estável, com a carga ainda rodando; carga reenviada após o reinício.

| Modo | Núcleos | Recuperação (s) | Tuplas | Inconsistências | Fim automático |
| --- | --- | --- | --- | --- | --- |
| Instantânea | 2 | 11,17 | 5.166 | 487 | não (validação) |
| Instantânea | 2 | 10,31 – 11,54 (5 ensaios) | 5.000 – 5.001 | 0 | sim |
| Instantânea | 1 | 13,20 | 5.000 | 0 | sim |
| Instantânea, indexação síncrona | 2 | 13,82 | 5.000 | 0 | sim |
| Instantânea, indexação síncrona | 1 | 19,40 | 5.000 | 0 | sim |
| Padrão | 2 | 1,01 | 5.000 | 0 | sim |
| Padrão | 1 | 0,79 | 5.000 | 0 | sim |

A máquina de teste processou cerca de 98 mil ops/s, contra cerca de 2,4 mil ops/s na máquina virtual. Por isso os tempos não são comparáveis entre as duas.

## 4. Problemas encontrados

| Problema | Efeito | Correção |
| --- | --- | --- |
| O README antigo não listava `libconfig-dev` | `make` falha: `libconfig.h: No such file or directory` | Incluído no README e em [instalacao.md](instalacao.md) |
| O memtier precisa estar no PATH, e isso não estava documentado | A carga termina em 0,002 s, sem erro visível | Incluído o `sudo make install` do memtier |
| Objetos compilados antes da atualização do Ubuntu | Executável com código de dois compiladores | `make distclean && make` |
| Condição de corrida na validação da recuperação instantânea | 1 de 6 ensaios em 2 núcleos marcado como falho (5.166 tuplas, 487 "inconsistências") | Pendente: contar como "já carregada" a chave restaurada sob demanda, e validar pelo número de chaves distintas na memória |

Explicação da condição de corrida em [protocolo-experimental.md](protocolo-experimental.md#5-validação-da-recuperação).

## 5. Limitações da verificação

- O painel web não foi executado na instalação limpa (repositório do npm indisponível no ambiente de teste). Ele está validado na máquina de desenvolvimento.
- A libconfig usada no teste foi a 1.7.3, compilada do código-fonte, em vez da 1.5 do apt; a interface em C é a mesma.
