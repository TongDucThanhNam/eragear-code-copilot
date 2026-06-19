/**
 * Dev-only Diagnostics Utility
 *
 * Gated instrumentation helpers for identifying performance lag across the
 * ACP → server → transport → client pipeline.  All probes are **disabled by
 * default** and must be explicitly enabled via `ERAGEAR_DIAGNOSTICS=1` (or
 * the shorter `ERAGEAR_DIAG=1`).
 *
 * **Usage**
 * ```bash
 * ERAGEAR_DIAGNOSTICS=1 bun run dev
 * # or
 * ERAGEAR_DIAG=1 bun run dev
 * ```
 *
 * Filter server logs: `grep '\[DIAG'`
 *
 * @module shared/utils/diagnostics.util
 */

/** Check once at module load so repeated calls are branch-predicted. */
const _enabled =
  process.env.ERAGEAR_DIAGNOSTICS === "1" || process.env.ERAGEAR_DIAG === "1";

/** Returns `true` when diagnostics are enabled. */
export function isDiagnosticsEnabled(): boolean {
  return _enabled;
}

/**
 * Emit a structured diagnostic log.
 *
 * **Never logs raw sensitive payloads** — only sizes, counts, event types,
 * durations, and identifiers already present in the logged context.
 */
export function diagnosticsLog(
  label: string,
  data: Record<string, unknown>
): void {
  if (!_enabled) {
    return;
  }
  try {
    // biome-ignore lint/suspicious/noConsole: Diagnostic output is the entire purpose of this utility
    console.log(`[DIAG:${label}] ${JSON.stringify(data)}`);
  } catch {
    // Swallow serialization errors — diagnostics must never break app flow.
  }
}

/**
 * Estimate the byte length of a value by JSON-serializing it.
 * Returns `null` if serialization fails.
 */
export function estimateJsonBytes(value: unknown): number | null {
  if (!_enabled) {
    return null;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Measure wall-clock duration of `fn()` and log it under `[DIAG:<label>]`.
 * Returns the result of `fn()`.
 */
export function diagnosticMeasure<T>(label: string, fn: () => T): T {
  if (!_enabled) {
    return fn();
  }
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    // biome-ignore lint/suspicious/noConsole: Diagnostic output is the entire purpose of this utility
    console.log(`[DIAG:${label}] ${duration.toFixed(2)}ms`);
  }
}

/**
 * Measure wall-clock duration of an async `fn()` and log it under `[DIAG:<label>]`.
 * Returns the result of `fn()`.
 */
export async function diagnosticMeasureAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!_enabled) {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    // biome-ignore lint/suspicious/noConsole: Diagnostic output is the entire purpose of this utility
    console.log(`[DIAG:${label}] ${duration.toFixed(2)}ms`);
  }
}

/**
 * Count items in an array or return `null` when not applicable.
 */
export function diagnosticCount(value: unknown): number | null {
  if (!_enabled) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return null;
}
