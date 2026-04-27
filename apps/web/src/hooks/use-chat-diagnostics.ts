/**
 * Dev-only Client Diagnostics
 *
 * Gated instrumentation helpers for identifying client-side performance lag.
 * Disabled by default.  Enable via:
 *   - `localStorage.setItem('ERAGEAR_DIAGNOSTICS', '1')` then reload
 *   - URL query parameter `?diag=1`
 *
 * Filter browser console: search for `[DIAG`
 *
 * @module hooks/use-chat-diagnostics
 */

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

let _clientDiagEnabled: boolean | null = null;

function resolveEnabled(): boolean {
  if (_clientDiagEnabled !== null) {
    return _clientDiagEnabled;
  }
  if (typeof window === "undefined") {
    _clientDiagEnabled = false;
    return false;
  }
  // URL query parameter support: ?diag=1
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("diag") === "1") {
      localStorage.setItem("ERAGEAR_DIAGNOSTICS", "1");
    }
  } catch {
    // ignore
  }
  try {
    _clientDiagEnabled = localStorage.getItem("ERAGEAR_DIAGNOSTICS") === "1";
  } catch {
    _clientDiagEnabled = false;
  }
  return _clientDiagEnabled;
}

/** Returns `true` when client-side diagnostics are enabled. */
export function isClientDiagnosticsEnabled(): boolean {
  return resolveEnabled();
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Emit a structured diagnostic log to the browser console.
 *
 * **Never logs raw sensitive payloads** — only sizes, counts, event types,
 * durations, and identifiers already present in the logged context.
 */
export function diagLog(
  label: string,
  data: Record<string, unknown>
): void {
  if (!resolveEnabled()) {
    return;
  }
  try {
    // biome-ignore lint/suspicious/noConsole: Diagnostic output is the entire purpose of this module
    console.log(`[DIAG:${label}]`, JSON.stringify(data));
  } catch {
    // Swallow — diagnostics must never break app flow.
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Estimate byte length by JSON-serializing a value.
 * Returns `null` if serialization fails.
 */
export function estimateJsonBytes(value: unknown): number | null {
  if (!resolveEnabled()) {
    return null;
  }
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return null;
  }
}

/**
 * Measure synchronous wall-clock duration of `fn()` and log it.
 * Returns the result of `fn()`.
 */
export function diagMeasure<T>(label: string, fn: () => T): T {
  if (!resolveEnabled()) {
    return fn();
  }
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    // biome-ignore lint/suspicious/noConsole: Diagnostic output is the entire purpose of this module
    console.log(`[DIAG:${label}] ${duration.toFixed(2)}ms`);
  }
}

/**
 * Measure async wall-clock duration of `fn()` and log it.
 * Returns the result of `fn()`.
 */
export async function diagMeasureAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!resolveEnabled()) {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    // biome-ignore lint/suspicious/noConsole: Diagnostic output is the entire purpose of this module
    console.log(`[DIAG:${label}] ${duration.toFixed(2)}ms`);
  }
}

// ---------------------------------------------------------------------------
// In-memory counters & report
// ---------------------------------------------------------------------------

interface DiagCounterBucket {
  count: number;
  totalBytes: number;
  totalDurationMs: number;
  slowCount: number;
}

const counters = new Map<string, DiagCounterBucket>();

/**
 * Record an event in the diagnostic counter.
 */
export function diagRecord(
  key: string,
  bytes: number | null,
  durationMs: number,
  slowThresholdMs = 16
): void {
  if (!resolveEnabled()) {
    return;
  }
  const bucket = counters.get(key) ?? {
    count: 0,
    totalBytes: 0,
    totalDurationMs: 0,
    slowCount: 0,
  };
  bucket.count += 1;
  if (bytes !== null) {
    bucket.totalBytes += bytes;
  }
  bucket.totalDurationMs += durationMs;
  if (durationMs > slowThresholdMs) {
    bucket.slowCount += 1;
  }
  counters.set(key, bucket);
}

/**
 * Aggregate all diagnostic counters and return a printable summary.
 * Also attached to `window.__eragearDiagReport` for ad-hoc access.
 */
export function getDiagReport(): Record<
  string,
  { count: number; avgBytes: number; avgDurationMs: number; slowCount: number }
> {
  const report: Record<
    string,
    {
      count: number;
      avgBytes: number;
      avgDurationMs: number;
      slowCount: number;
    }
  > = {};
  for (const [key, bucket] of counters) {
    report[key] = {
      count: bucket.count,
      avgBytes:
        bucket.count > 0
          ? Math.round(bucket.totalBytes / bucket.count)
          : 0,
      avgDurationMs:
        bucket.count > 0
          ? Math.round((bucket.totalDurationMs / bucket.count) * 100) / 100
          : 0,
      slowCount: bucket.slowCount,
    };
  }
  return report;
}

// Attach to window for ad-hoc console access
if (typeof window !== "undefined") {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: diagnostic attachment to global window
    (window as any).__eragearDiagReport = getDiagReport;
  } catch {
    // ignore
  }
}
