import { describe, expect, test } from "bun:test";
import {
  computeSupervisorPlanHash,
  isReplanInsideApprovedEnvelope,
  supervisorPlanHashMatches,
} from "./supervisor-plan-hash";
import { createSupervisorRunFixture } from "./supervisor-run.test-fixture";

const envelope = {
  goal: "Ship manager mode",
  fileScopes: ["packages/runtime/src/manager.ts"],
  verificationCommands: ["bun test manager.test.ts"],
  successCriteria: ["Manager exact-resumes"],
  permissionScopes: ["project-read", "scoped-write"],
  destructiveActions: [],
  delivery: {
    createCommit: true as const,
    targetBranch: "master",
    targetHead: "abc123",
    allowDefaultBranch: true,
  },
};

describe("supervisor plan hash and envelope", () => {
  test("is deterministic and binds tasks plus delivery authorization", () => {
    const tasks = createSupervisorRunFixture().tasks;
    const input = { version: 1, summary: "Safe plan", envelope, tasks };
    const hash = computeSupervisorPlanHash(input);
    expect(hash).toHaveLength(64);
    expect(supervisorPlanHashMatches(hash, structuredClone(input))).toBeTrue();
    expect(
      supervisorPlanHashMatches(hash, {
        ...input,
        envelope: {
          ...envelope,
          delivery: { ...envelope.delivery, targetHead: "changed" },
        },
      })
    ).toBeFalse();
  });

  test("allows only replans that narrow the approved envelope", () => {
    expect(
      isReplanInsideApprovedEnvelope({
        approved: envelope,
        proposed: { ...envelope, permissionScopes: ["project-read"] },
      })
    ).toBeTrue();
    expect(
      isReplanInsideApprovedEnvelope({
        approved: envelope,
        proposed: {
          ...envelope,
          fileScopes: [...envelope.fileScopes, "outside.ts"],
        },
      })
    ).toBeFalse();
  });
});
