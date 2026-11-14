#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Organização da pasta do MM-DIRECT
#
# Move para pastas próprias os arquivos soltos que o sistema NÃO usa para rodar
# (scripts antigos de correção, logs de testes, PDFs, saídas de execuções
# antigas feitas a partir da raiz). Nada é apagado: tudo vai para docs/ ou
# _arquivo/, e um script de desfazer é gerado.
#
# Não mexe em nada que o sistema usa em tempo de execução:
#   server.js, config-mm-direct.js, redis_ir.conf, package*.json, node_modules/,
#   web/, src/ (exceto logs de testes antigos e arquivos com nome corrompido),
#   src/runs/, src/backups/, src/logs/, deps/, tests/, utils/, Makefile, runtest*.
#
# Uso (a partir de qualquer pasta):
#   bash organizar_projeto.sh            # só mostra o que seria feito
#   bash organizar_projeto.sh --aplicar  # executa
#
# Para desfazer depois:  bash _arquivo/desfazer_organizacao.sh
# ---------------------------------------------------------------------------
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APPLY=0
[[ "${1:-}" == "--aplicar" ]] && APPLY=1

if [[ ! -f server.js || ! -f config-mm-direct.js || ! -d src || ! -d web ]]; then
  echo "Este script precisa estar na raiz do MM-DIRECT (onde ficam server.js e src/)." >&2
  exit 1
fi

# Não reorganiza com o sistema rodando (backend 8081 ou Redis-IR 6379)
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- 3<&-; }
if [[ $APPLY -eq 1 ]] && { port_open 8081 || port_open 6379; }; then
  echo "O backend (8081) ou o Redis-IR (6379) está rodando. Encerre o sistema antes de organizar." >&2
  exit 1
fi

UNDO="_arquivo/desfazer_organizacao.sh"
MOVED=0
SKIPPED=0
UNDO_LINES=()

move() { # move <origem> <pasta destino> [novo nome]
  local src="$1" destdir="$2" name="${3:-$(basename -- "$1")}"
  local dest="$destdir/$name"
  if [[ ! -e "$src" && ! -L "$src" ]]; then return 0; fi
  if [[ -e "$dest" ]]; then
    echo "  [pulado] $src  (já existe $dest)"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi
  printf '  %-50s -> %s\n' "$src" "$dest"
  if [[ $APPLY -eq 1 ]]; then
    mkdir -p -- "$destdir"
    mv -- "$src" "$dest"
    UNDO_LINES+=("mv -- $(printf '%q' "$dest") $(printf '%q' "$src")")
  fi
  MOVED=$((MOVED + 1))
}

[[ $APPLY -eq 0 ]] && echo "SIMULAÇÃO (nada será movido). Rode com --aplicar para executar." && echo

# 1. Documentação ------------------------------------------------------------
echo "Documentação -> docs/"
move "Redis-IR-manual.pdf"                  docs/manuais
move "Redis-IR-manual-pt-br.pdf"            docs/manuais
move "memtier_benchmark usage options.pdf"  docs/manuais "memtier_benchmark-usage-options.pdf"
move "assets"                               docs        "imagens"
move "Claude outputs"                       docs        "exemplos-relatorios"

# 2. Scripts de correção/refatoração já aplicados ------------------------------
echo; echo "Scripts de desenvolvimento antigos -> _arquivo/scripts-desenvolvimento/"
for f in fix_*.cjs fix_*.py fix_*.patch fix_server.js \
         patch_*.py patch_*.cjs refactor_*.py restore_start.py \
         robust_*.cjs instrument_backend.py \
         test_parse.cjs test_spawn.cjs test_spawn.js ws_test.cjs \
         deleted_code.patch diff.txt; do
  [[ -e "$f" ]] && move "$f" _arquivo/scripts-desenvolvimento
done

# 3. Scripts e cenários de teste manual ----------------------------------------
echo; echo "Testes manuais antigos -> _arquivo/testes-manuais/"
for f in trigger.sh payload.json monitor_and_kill.sh monitor2.sh \
         test_auto_recovery.sh test_auto_recovery_corrupt.sh; do
  [[ -e "$f" ]] && move "$f" _arquivo/testes-manuais
done
move "scratch"  _arquivo/testes-manuais
move "ensaios"  _arquivo/testes-manuais

# 4. Logs de testes antigos ------------------------------------------------------
echo; echo "Logs de testes antigos -> _arquivo/logs-testes/"
for f in redis_test.log server_test_run.log server.log; do
  [[ -e "$f" ]] && move "$f" _arquivo/logs-testes/raiz
done
move "artifacts" _arquivo/logs-testes "artifacts"
# Logs soltos em src/ deixados por testes de setembro (o Redis-IR não os usa;
# os logs de cada execução ficam em src/runs/<id>/logs.txt)
for f in src/phase3_test.log src/phase3_validation.log src/phase4_validation.log \
         src/populate.log src/server_test_run.log src/test.log src/test2.log \
         src/test_output.log src/test_no_fail_output.log \
         src/test_scenario_b_output.log src/test_scenario_b_empty_output.log \
         src/scenario_*.log; do
  [[ -e "$f" ]] && move "$f" _arquivo/logs-testes/src
done

# 5. Saídas de execuções antigas feitas com a raiz como pasta de trabalho -------
#    (o sistema atual roda o Redis-IR dentro de src/ e usa src/logs, src/datasets...)
echo; echo "Saídas antigas na raiz -> _arquivo/execucao-antiga-na-raiz/"
for f in logs datasets indexing_report recovery_report system_monitoring temp_ir_files \
         dump.rdb system_monitoring.tmp test.conf config.json; do
  [[ -e "$f" ]] && move "$f" _arquivo/execucao-antiga-na-raiz
done

# 6. Arquivos com nome corrompido em src/ (bytes inválidos, criados por engano) --
echo; echo "Arquivos com nome corrompido em src/ -> _arquivo/nomes-corrompidos/"
n=0
for f in src/*; do
  base="$(basename -- "$f")"
  [[ -f "$f" ]] || continue
  case "$base" in
    *[![:print:]]*|" "*)
      n=$((n + 1))
      move "$f" _arquivo/nomes-corrompidos "arquivo_${n}.bin"
      ;;
  esac
done

# 7. Cópia de segurança antiga do .git -----------------------------------------
echo; echo "Backup antigo do git -> _arquivo/git-salvo/"
move ".git (salvo)" _arquivo "git-salvo"

echo
if [[ $APPLY -eq 0 ]]; then
  echo "$MOVED itens seriam movidos ($SKIPPED pulados). Nada foi alterado."
  echo "Para executar:  bash organizar_projeto.sh --aplicar"
  exit 0
fi

# Ignora o backup do git no repositório (são milhares de arquivos internos)
if ! grep -qxF "_arquivo/git-salvo/" .gitignore 2>/dev/null; then
  [[ -s .gitignore && -n "$(tail -c1 .gitignore)" ]] && echo >> .gitignore
  printf '# Cópia antiga da pasta .git (não versionar)\n_arquivo/git-salvo/\n' >> .gitignore
  UNDO_LINES+=("sed -i '/^# Cópia antiga da pasta .git (não versionar)\$/d; /^_arquivo\\/git-salvo\\/\$/d' .gitignore")
fi

# Explicação do conteúdo do arquivo
mkdir -p _arquivo
if [[ ! -e _arquivo/LEIA-ME.md ]]; then
  cat > _arquivo/LEIA-ME.md <<'EOF'
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
EOF
  UNDO_LINES+=("rm -f _arquivo/LEIA-ME.md")
fi

# Script de desfazer (na ordem inversa)
{
  echo "#!/usr/bin/env bash"
  echo "# Desfaz a organização feita por organizar_projeto.sh em $(date '+%d/%m/%Y %H:%M')"
  echo "set -e"
  echo "cd \"\$(dirname \"\${BASH_SOURCE[0]}\")/..\""
  echo "mv -- _arquivo/organizar_projeto.sh organizar_projeto.sh 2>/dev/null || true"
  for (( i=${#UNDO_LINES[@]}-1; i>=0; i-- )); do echo "${UNDO_LINES[$i]}"; done
  echo "rm -f -- _arquivo/desfazer_organizacao.sh"
  echo "find _arquivo docs -depth -type d -empty -delete 2>/dev/null || true"
  echo "echo 'Organização desfeita.'"
} > "$UNDO"
chmod +x "$UNDO"

# Este script também vai para o arquivo
mv -- "$ROOT/organizar_projeto.sh" _arquivo/organizar_projeto.sh

echo "$MOVED itens movidos ($SKIPPED pulados)."
echo "Para desfazer:  bash $UNDO"
