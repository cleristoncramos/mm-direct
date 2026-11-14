/**
 * Utility functions for Phase 3 Timestamp Standardization across MM-DIRECT.
 * Reference unit: microseconds (us) from C backend ustime().
 * Relative unit: milliseconds (ms) = (timestampUs - runStartUs) / 1000.0.
 */

export interface ExperimentEvent {
  event: string;
  runId?: string;
  timestampUs: number;
  runStartUs: number;
  relativeMs: number;
  durationMs?: number;
  reason?: string;
  loadedTuples?: number;
  distinctTuples?: number;
  recordsProcessed?: number;
  inconsistencies?: number;
}

export interface EventTimestamps {
  runId: string | null;
  runStartUs: number | null;
  events: {
    preloadStart: ExperimentEvent | null;
    preloadEnd: ExperimentEvent | null;
    stableOperationStart: ExperimentEvent | null;
    failureTimerStart: ExperimentEvent | null;
    failureTriggered: ExperimentEvent | null;
    recoveryStart: ExperimentEvent | null;
    recoveryEnd: ExperimentEvent | null;
    experimentCompleted: ExperimentEvent | null;
    experimentFailed: ExperimentEvent | null;
  };
  durations: {
    preloadMs: number | null;
    stableOperationMs: number | null;
    recoveryMs: number | null;
  };
}

/**
 * Converts a microsecond timestamp or duration to milliseconds.
 */
export function usToMs(us: number | string | null | undefined): number | null {
  if (us === null || us === undefined || us === "") return null;
  const num = Number(us);
  return isNaN(num) ? null : num / 1000.0;
}

/**
 * Converts a microsecond timestamp or duration to seconds.
 */
export function usToSeconds(us: number | string | null | undefined): number | null {
  if (us === null || us === undefined || us === "") return null;
  const num = Number(us);
  return isNaN(num) ? null : num / 1000000.0;
}

/**
 * Calculates relative milliseconds from a timestamp and global runStartUs.
 */
export function computeRelativeMs(
  timestampUs: number | string,
  runStartUs: number | string
): number {
  const ts = Number(timestampUs);
  const start = Number(runStartUs);
  if (isNaN(ts) || isNaN(start)) return 0;
  return (ts - start) / 1000.0;
}

/**
 * Formats a microsecond UNIX epoch timestamp as ISO 8601 UTC string.
 */
export function formatUtcTimestamp(timestampUs: number | string): string {
  const num = Number(timestampUs);
  if (isNaN(num) || num <= 0) return "";
  const date = new Date(num / 1000.0);
  return date.toISOString();
}

/**
 * Formats relative milliseconds for display (e.g. "181.23 ms" or "1.81 s").
 */
export function formatRelativeMs(relativeMs: number): string {
  if (relativeMs < 0) return "0.00 ms";
  if (relativeMs >= 1000) {
    return `${(relativeMs / 1000.0).toFixed(3)} s`;
  }
  return `${relativeMs.toFixed(3)} ms`;
}
