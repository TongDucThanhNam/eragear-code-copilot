/**
 * Clock abstraction for code that needs deterministic time in tests.
 *
 * Caller contract: values are milliseconds and should be monotonic enough for
 * elapsed-time comparisons, but adapters are not required to provide wall-clock
 * persistence guarantees.
 */
export interface ClockPort {
  nowMs(): number;
}
