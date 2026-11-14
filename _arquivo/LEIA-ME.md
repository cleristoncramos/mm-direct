# _arquivo

Material histórico do desenvolvimento do MM-DIRECT. **Nada aqui é usado pelo sistema
ou pelos experimentos**; está guardado só para consulta.

| Pasta | Conteúdo |
| --- | --- |
| `scripts-desenvolvimento/` | Scripts de correção, patch e refatoração já aplicados ao código (`fix_*`, `patch_*`, `refactor_*`, diffs). |
| `testes-manuais/` | Scripts e cenários de teste manual (disparo via curl, monitoramento, teste de recuperação automática, fase 5). |
| `logs-testes/` | Logs de testes de setembro/2026 que estavam soltos na raiz e em `src/`. |
| `execucao-antiga-na-raiz/` | Saídas de execuções antigas feitas com a raiz como pasta de trabalho (`logs/`, `datasets/`, `dump.rdb`...). O sistema atual grava tudo em `src/`. |
| `nomes-corrompidos/` | Arquivos com nome inválido que estavam em `src/`, renomeados para `arquivo_N.bin`. |
| `git-salvo/` | Cópia antiga da pasta `.git` (ignorada pelo git). |

Para devolver tudo ao lugar original: `bash _arquivo/desfazer_organizacao.sh`
