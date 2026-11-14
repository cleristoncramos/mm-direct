#!/usr/bin/env bash
# Desfaz a organização feita por organizar_projeto.sh em 09/11/2026 21:18
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mv -- _arquivo/organizar_projeto.sh organizar_projeto.sh 2>/dev/null || true
rm -f _arquivo/LEIA-ME.md
sed -i '/^# Cópia antiga da pasta .git (não versionar)$/d; /^_arquivo\/git-salvo\/$/d' .gitignore
mv -- _arquivo/git-salvo .git\ \(salvo\)
mv -- _arquivo/nomes-corrompidos/arquivo_2.bin $'src/0X2\357\210U'
mv -- _arquivo/nomes-corrompidos/arquivo_1.bin $'src/ \2510\321qU'
mv -- _arquivo/execucao-antiga-na-raiz/config.json config.json
mv -- _arquivo/execucao-antiga-na-raiz/test.conf test.conf
mv -- _arquivo/execucao-antiga-na-raiz/system_monitoring.tmp system_monitoring.tmp
mv -- _arquivo/execucao-antiga-na-raiz/dump.rdb dump.rdb
mv -- _arquivo/execucao-antiga-na-raiz/temp_ir_files temp_ir_files
mv -- _arquivo/execucao-antiga-na-raiz/system_monitoring system_monitoring
mv -- _arquivo/execucao-antiga-na-raiz/recovery_report recovery_report
mv -- _arquivo/execucao-antiga-na-raiz/indexing_report indexing_report
mv -- _arquivo/execucao-antiga-na-raiz/datasets datasets
mv -- _arquivo/execucao-antiga-na-raiz/logs logs
mv -- _arquivo/logs-testes/src/scenario_b_verified.log src/scenario_b_verified.log
mv -- _arquivo/logs-testes/src/scenario_b_real_empty.log src/scenario_b_real_empty.log
mv -- _arquivo/logs-testes/src/scenario_b_proven.log src/scenario_b_proven.log
mv -- _arquivo/logs-testes/src/scenario_b_final.log src/scenario_b_final.log
mv -- _arquivo/logs-testes/src/scenario_b_empty.log src/scenario_b_empty.log
mv -- _arquivo/logs-testes/src/scenario_b_config.log src/scenario_b_config.log
mv -- _arquivo/logs-testes/src/scenario_b_bdb.log src/scenario_b_bdb.log
mv -- _arquivo/logs-testes/src/scenario_b.log src/scenario_b.log
mv -- _arquivo/logs-testes/src/scenario_ac_full.log src/scenario_ac_full.log
mv -- _arquivo/logs-testes/src/scenario_ac_final.log src/scenario_ac_final.log
mv -- _arquivo/logs-testes/src/scenario_ac_complete.log src/scenario_ac_complete.log
mv -- _arquivo/logs-testes/src/scenario_ac.log src/scenario_ac.log
mv -- _arquivo/logs-testes/src/test_scenario_b_empty_output.log src/test_scenario_b_empty_output.log
mv -- _arquivo/logs-testes/src/test_scenario_b_output.log src/test_scenario_b_output.log
mv -- _arquivo/logs-testes/src/test_no_fail_output.log src/test_no_fail_output.log
mv -- _arquivo/logs-testes/src/test_output.log src/test_output.log
mv -- _arquivo/logs-testes/src/test2.log src/test2.log
mv -- _arquivo/logs-testes/src/test.log src/test.log
mv -- _arquivo/logs-testes/src/server_test_run.log src/server_test_run.log
mv -- _arquivo/logs-testes/src/populate.log src/populate.log
mv -- _arquivo/logs-testes/src/phase4_validation.log src/phase4_validation.log
mv -- _arquivo/logs-testes/src/phase3_validation.log src/phase3_validation.log
mv -- _arquivo/logs-testes/src/phase3_test.log src/phase3_test.log
mv -- _arquivo/logs-testes/artifacts artifacts
mv -- _arquivo/logs-testes/raiz/server.log server.log
mv -- _arquivo/logs-testes/raiz/server_test_run.log server_test_run.log
mv -- _arquivo/logs-testes/raiz/redis_test.log redis_test.log
mv -- _arquivo/testes-manuais/ensaios ensaios
mv -- _arquivo/testes-manuais/scratch scratch
mv -- _arquivo/testes-manuais/test_auto_recovery_corrupt.sh test_auto_recovery_corrupt.sh
mv -- _arquivo/testes-manuais/test_auto_recovery.sh test_auto_recovery.sh
mv -- _arquivo/testes-manuais/monitor2.sh monitor2.sh
mv -- _arquivo/testes-manuais/monitor_and_kill.sh monitor_and_kill.sh
mv -- _arquivo/testes-manuais/payload.json payload.json
mv -- _arquivo/testes-manuais/trigger.sh trigger.sh
mv -- _arquivo/scripts-desenvolvimento/diff.txt diff.txt
mv -- _arquivo/scripts-desenvolvimento/deleted_code.patch deleted_code.patch
mv -- _arquivo/scripts-desenvolvimento/ws_test.cjs ws_test.cjs
mv -- _arquivo/scripts-desenvolvimento/test_spawn.js test_spawn.js
mv -- _arquivo/scripts-desenvolvimento/test_spawn.cjs test_spawn.cjs
mv -- _arquivo/scripts-desenvolvimento/test_parse.cjs test_parse.cjs
mv -- _arquivo/scripts-desenvolvimento/instrument_backend.py instrument_backend.py
mv -- _arquivo/scripts-desenvolvimento/robust_watch.cjs robust_watch.cjs
mv -- _arquivo/scripts-desenvolvimento/robust_parser.cjs robust_parser.cjs
mv -- _arquivo/scripts-desenvolvimento/restore_start.py restore_start.py
mv -- _arquivo/scripts-desenvolvimento/refactor_ws.py refactor_ws.py
mv -- _arquivo/scripts-desenvolvimento/refactor_server.py refactor_server.py
mv -- _arquivo/scripts-desenvolvimento/refactor_chartboard.py refactor_chartboard.py
mv -- _arquivo/scripts-desenvolvimento/patch_server.cjs patch_server.cjs
mv -- _arquivo/scripts-desenvolvimento/patch_csv.cjs patch_csv.cjs
mv -- _arquivo/scripts-desenvolvimento/patch_websocket_protocol.py patch_websocket_protocol.py
mv -- _arquivo/scripts-desenvolvimento/patch_server_routes.py patch_server_routes.py
mv -- _arquivo/scripts-desenvolvimento/patch_server.py patch_server.py
mv -- _arquivo/scripts-desenvolvimento/patch_frontend_badges.py patch_frontend_badges.py
mv -- _arquivo/scripts-desenvolvimento/patch_charts_step6.py patch_charts_step6.py
mv -- _arquivo/scripts-desenvolvimento/patch_charts_step5.py patch_charts_step5.py
mv -- _arquivo/scripts-desenvolvimento/patch_charts_step4.py patch_charts_step4.py
mv -- _arquivo/scripts-desenvolvimento/patch_charts_logs.py patch_charts_logs.py
mv -- _arquivo/scripts-desenvolvimento/patch_charts.py patch_charts.py
mv -- _arquivo/scripts-desenvolvimento/patch_chartboard_state.py patch_chartboard_state.py
mv -- _arquivo/scripts-desenvolvimento/patch_chartboard_parsers.py patch_chartboard_parsers.py
mv -- _arquivo/scripts-desenvolvimento/fix_server.js fix_server.js
mv -- _arquivo/scripts-desenvolvimento/fix_frontend_freeze.patch fix_frontend_freeze.patch
mv -- _arquivo/scripts-desenvolvimento/fix_oom.py fix_oom.py
mv -- _arquivo/scripts-desenvolvimento/fix_realtime.cjs fix_realtime.cjs
mv -- _arquivo/scripts-desenvolvimento/fix_cpu_memory.cjs fix_cpu_memory.cjs
mv -- _arquivo/scripts-desenvolvimento/fix_all.cjs fix_all.cjs
mv -- docs/exemplos-relatorios Claude\ outputs
mv -- docs/imagens assets
mv -- docs/manuais/memtier_benchmark-usage-options.pdf memtier_benchmark\ usage\ options.pdf
mv -- docs/manuais/Redis-IR-manual-pt-br.pdf Redis-IR-manual-pt-br.pdf
mv -- docs/manuais/Redis-IR-manual.pdf Redis-IR-manual.pdf
rm -f -- _arquivo/desfazer_organizacao.sh
find _arquivo docs -depth -type d -empty -delete 2>/dev/null || true
echo 'Organização desfeita.'
