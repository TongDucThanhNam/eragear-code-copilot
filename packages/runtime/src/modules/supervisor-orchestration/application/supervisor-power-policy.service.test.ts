import { describe, expect, test } from "bun:test";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { evaluateSupervisorPowerPolicy } from "./supervisor-power-policy.service";

describe("evaluateSupervisorPowerPolicy", () => {
  test("holds only for active work or short capacity waits while on AC power", () => {
    const running = createSupervisorRunFixture({ status: "running" });
    expect(
      evaluateSupervisorPowerPolicy({ runs: [running], onAcPower: true })
    ).toEqual({ holdInhibitor: true, reason: "active_work" });
    expect(
      evaluateSupervisorPowerPolicy({ runs: [running], onAcPower: false })
    ).toEqual({ holdInhibitor: false, reason: "battery" });
  });

  test("releases a long quota wait and reports its wake time", () => {
    const retryAt = "2026-08-10T02:00:00.000Z";
    const waiting = createSupervisorRunFixture({
      status: "waiting_capacity",
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "manager",
          agentId: "agent-1",
          kind: "quota_exhausted",
          reason: "Quota resets later",
          suspendedAt: "2026-08-10T00:00:00.000Z",
          retryAt,
          backoffStep: 0,
        },
      ],
    });
    expect(
      evaluateSupervisorPowerPolicy({
        runs: [waiting],
        onAcPower: true,
        now: new Date("2026-08-10T00:00:00.000Z"),
      })
    ).toEqual({
      holdInhibitor: false,
      reason: "long_capacity_wait",
      wakeAt: retryAt,
    });
  });
});
