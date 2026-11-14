#!/bin/bash
set -e

echo "=== VALIDAÇÃO INTEGRADA DAS CORREÇÕES DA FASE 5 ==="

SCRATCH_DIR="$(dirname "$0")"
PROJECT_DIR="$(cd "$SCRATCH_DIR/.." && pwd)"

cd "$PROJECT_DIR"

TEST_PASSED=0
TEST_FAILED=0

assert_equal() {
    local label="$1"
    local expected="$2"
    local actual="$3"
    if [ "$expected" == "$actual" ]; then
        echo "  [PASS] $label (Esperado: '$expected', Obtido: '$actual')"
        TEST_PASSED=$((TEST_PASSED + 1))
    else
        echo "  [FAIL] $label (Esperado: '$expected', Obtido: '$actual')"
        TEST_FAILED=$((TEST_FAILED + 1))
    fi
}

echo ""
echo "--- 1. Limpeza de Ambiente e Início do Experimento ---"

pkill -9 redis-server || true
sleep 1

# Remover resíduos de execuções anteriores (Problema 2)
rm -rf src/datasets/* src/system_monitoring/* src/indexing_report/* src/temp_ir_files/* datasets.csv system_monitoring.csv indexing.csv results.json

# Ajustar redis_ir.conf para teste automatizado (3s de op estável)
sed -i 's/restart_after_time = [0-9]*/restart_after_time = 3/' redis_ir.conf
sed -i 's/number_restarts_after_time = [0-9]*/number_restarts_after_time = 1/' redis_ir.conf

cd "$PROJECT_DIR/src"
./redis-server > "$PROJECT_DIR/scratch/phase5_run.log" 2>&1 &
SERVER_PID=$!
cd "$PROJECT_DIR"

echo "Aguardando conclusão do experimento (16 segundos)..."
sleep 16

if kill -0 $SERVER_PID 2>/dev/null; then
    "$PROJECT_DIR/src/redis-cli" shutdown 2>/dev/null || kill -9 $SERVER_PID 2>/dev/null || true
fi

LOG_FILE="$PROJECT_DIR/scratch/phase5_run.log"

echo ""
echo "--- 2. Validação do Problema 1: Ordem de STABLE_OPERATION_STARTED e FAILURE_TIMER_STARTED ---"
LINE_STABLE=$(grep -n "STABLE_OPERATION_STARTED" "$LOG_FILE" | head -n 1 | cut -d: -f1)
LINE_TIMER=$(grep -n "FAILURE_TIMER_STARTED" "$LOG_FILE" | head -n 1 | cut -d: -f1)

if [ -n "$LINE_STABLE" ] && [ -n "$LINE_TIMER" ] && [ "$LINE_STABLE" -lt "$LINE_TIMER" ]; then
    echo "  [PASS] STABLE_OPERATION_STARTED (linha $LINE_STABLE) emitido antes de FAILURE_TIMER_STARTED (linha $LINE_TIMER)."
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "  [FAIL] Ordem incorreta: STABLE_OPERATION_STARTED (linha $LINE_STABLE) vs FAILURE_TIMER_STARTED (linha $LINE_TIMER)."
    TEST_FAILED=$((TEST_FAILED + 1))
fi

echo ""
echo "--- 3. Validação do Problema 2: runId Novo e Fresco runStartUs ---"
if grep -q "RUN_STARTED" "$LOG_FILE"; then
    echo "  [PASS] RUN_STARTED emitido para nova execução."
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "  [FAIL] RUN_STARTED ausente."
    TEST_FAILED=$((TEST_FAILED + 1))
fi

if grep -q "RUN_CONTINUED_AFTER_FAILURE" "$LOG_FILE"; then
    echo "  [PASS] RUN_CONTINUED_AFTER_FAILURE emitido na recuperação pós-falha."
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "  [FAIL] RUN_CONTINUED_AFTER_FAILURE ausente na reinicialização."
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Verificar se a diferença relativa entre runStartUs e PRELOAD_STARTED é próxima de 0 (e não 1500s)
RUN_START_US=$(grep -o 'runStartUs=[0-9]*' "$LOG_FILE" | head -n 1 | cut -d= -f2)
PRELOAD_TS_US=$(grep -o 'PRELOAD_STARTED.*timestampUs=[0-9]*' "$LOG_FILE" | head -n 1 | grep -o 'timestampUs=[0-9]*' | cut -d= -f2)

if [ -n "$RUN_START_US" ] && [ -n "$PRELOAD_TS_US" ]; then
    DELTA_MS=$(( (PRELOAD_TS_US - RUN_START_US) / 1000 ))
    if [ "$DELTA_MS" -ge 0 ] && [ "$DELTA_MS" -lt 5000 ]; then
        echo "  [PASS] Eixo temporal inicial é relativo e próximo de 0 (delta = ${DELTA_MS}ms)."
        TEST_PASSED=$((TEST_PASSED + 1))
    else
        echo "  [FAIL] Eixo temporal desmesurado (delta = ${DELTA_MS}ms)."
        TEST_FAILED=$((TEST_FAILED + 1))
    fi
fi

echo ""
echo "--- 4. Validação do Problema 5: Ordem de Encerramento das Threads ---"
LINE_REC_END=$(grep -n "RECOVERY_COMPLETED" "$LOG_FILE" | head -n 1 | cut -d: -f1)
LINE_CLEANUP=$(grep -n "THREADS_CLEANUP_COMPLETED" "$LOG_FILE" | head -n 1 | cut -d: -f1)
LINE_EXP_END=$(grep -n "EXPERIMENT_COMPLETED" "$LOG_FILE" | tail -n 1 | cut -d: -f1)

if [ -n "$LINE_REC_END" ] && [ -n "$LINE_CLEANUP" ] && [ -n "$LINE_EXP_END" ] && \
   [ "$LINE_REC_END" -lt "$LINE_CLEANUP" ] && [ "$LINE_CLEANUP" -lt "$LINE_EXP_END" ]; then
    echo "  [PASS] Ordem correta das threads: RECOVERY_COMPLETED (linha $LINE_REC_END) -> THREADS_CLEANUP_COMPLETED (linha $LINE_CLEANUP) -> EXPERIMENT_COMPLETED (linha $LINE_EXP_END)."
    TEST_PASSED=$((TEST_PASSED + 1))
else
    echo "  [FAIL] Sequência incorreta de encerramento de threads."
    TEST_FAILED=$((TEST_FAILED + 1))
fi

# Verificar se nenhuma thread do indexer/checkpointer iniciou APÓS EXPERIMENT_COMPLETED
if [ -n "$LINE_EXP_END" ]; then
    AFTER_EXP_COMPLETED_LOGS=$(awk "NR > $LINE_EXP_END" "$LOG_FILE")
    if echo "$AFTER_EXP_COMPLETED_LOGS" | grep -q "Indexer thread V2 started\|Checkpointer thread started"; then
        echo "  [FAIL] Threads iniciaram após EXPERIMENT_COMPLETED."
        TEST_FAILED=$((TEST_FAILED + 1))
    else
        echo "  [PASS] Nenhuma nova thread iniciada após EXPERIMENT_COMPLETED."
        TEST_PASSED=$((TEST_PASSED + 1))
    fi
else
    echo "  [SKIP] EXPERIMENT_COMPLETED não atingido neste teste."
fi

echo ""
echo "--- 5. Validação da Sequência Completa de 12 Eventos ---"
EVENTS_CHECK=(
    "RUN_STARTED"
    "PRELOAD_STARTED"
    "PRELOAD_COMPLETED"
    "STABLE_OPERATION_STARTED"
    "FAILURE_TIMER_STARTED"
    "FAILURE_TRIGGERED"
    "RUN_CONTINUED_AFTER_FAILURE"
    "RECOVERY_STARTED"
    "RECOVERY_COMPLETED"
    "THREADS_CLEANUP_COMPLETED"
    "EXPERIMENT_COMPLETED"
)

for evt in "${EVENTS_CHECK[@]}"; do
    if grep -q "$evt" "$LOG_FILE"; then
        echo "  [PASS] Evento '$evt' verificado."
        TEST_PASSED=$((TEST_PASSED + 1))
    else
        echo "  [FAIL] Evento '$evt' ausente no log."
        TEST_FAILED=$((TEST_FAILED + 1))
    fi
done

echo ""
echo "=== RESUMO DA VALIDAÇÃO INTEGRADA DAS CORREÇÕES DA FASE 5 ==="
echo "Testes Aprovados: $TEST_PASSED"
echo "Testes Falhos:    $TEST_FAILED"

if [ "$TEST_FAILED" -eq 0 ]; then
    echo "SUCCESS: Todas as correções estruturais foram validadas com sucesso!"
    exit 0
else
    echo "ERROR: Ocorreram falhas na validação integrada."
    exit 1
fi
