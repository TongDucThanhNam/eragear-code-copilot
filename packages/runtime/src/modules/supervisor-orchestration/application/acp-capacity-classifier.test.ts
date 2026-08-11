import { describe, expect, test } from "bun:test";
import {
  classifyAcpCapacityFailure,
  computeCapacityRetryAt,
} from "./acp-capacity-classifier";

describe("ACP capacity classification", () => {
  test("classifies quota JSON-RPC signals and redacts secrets", () => {
    const classified = classifyAcpCapacityFailure({
      jsonRpcError: { code: 429, message: "insufficient_quota" },
      metadata: { resetAt: "2026-08-10T12:00:00.000Z" },
      stderr: "Authorization: Bearer sk-secret-token-123456789",
    });
    expect(classified.kind).toBe("quota_exhausted");
    expect(classified.resetAt).toBe("2026-08-10T12:00:00.000Z");
    expect(classified.reason).not.toContain("sk-secret");
  });

  test("fails closed for auth, fatal sessions, and unknown failures", () => {
    expect(
      classifyAcpCapacityFailure({ assistantFailure: "401 token expired" }).kind
    ).toBe("auth_required");
    expect(
      classifyAcpCapacityFailure({ error: new Error("session not found") }).kind
    ).toBe("session_fatal");
    expect(
      classifyAcpCapacityFailure({ error: new Error("strange failure") })
        .retryable
    ).toBeFalse();
  });

  test("uses ETA plus jitter and caps no-ETA backoff at hourly", () => {
    const nowMs = Date.parse("2026-08-10T10:00:00.000Z");
    const withEta = Date.parse(
      computeCapacityRetryAt({
        nowMs,
        resetAt: "2026-08-10T11:00:00.000Z",
        backoffStep: 0,
        jitterSeed: "run-1",
      })
    );
    expect(withEta).toBeGreaterThanOrEqual(
      Date.parse("2026-08-10T11:00:00.000Z")
    );
    expect(withEta).toBeLessThanOrEqual(Date.parse("2026-08-10T11:00:30.000Z"));
    expect(
      computeCapacityRetryAt({
        nowMs,
        backoffStep: 99,
        jitterSeed: "run-1",
      })
    ).toBe("2026-08-10T11:00:00.000Z");
  });
});
