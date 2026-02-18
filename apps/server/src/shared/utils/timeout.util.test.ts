import { describe, expect, test } from "bun:test";
import {
  MAX_SET_TIMEOUT_MS,
  normalizeTimeoutMs,
  withTimeout,
} from "./timeout.util";

describe("withTimeout", () => {
  test("returns resolved value when work completes within timeout", async () => {
    await expect(
      withTimeout(Promise.resolve("ok"), 100, "should not timeout")
    ).resolves.toBe("ok");
  });

  test("rejects when work exceeds timeout", async () => {
    await expect(
      withTimeout(new Promise<never>(() => undefined), 10, "timeout exceeded", {
        unref: false,
      })
    ).rejects.toThrow("timeout exceeded");
  });

  test("clamps oversized timeout values", () => {
    expect(normalizeTimeoutMs(Number.POSITIVE_INFINITY)).toEqual({
      timeoutMs: MAX_SET_TIMEOUT_MS,
      clamped: true,
    });
    expect(normalizeTimeoutMs(MAX_SET_TIMEOUT_MS + 1)).toEqual({
      timeoutMs: MAX_SET_TIMEOUT_MS,
      clamped: true,
    });
  });
});
