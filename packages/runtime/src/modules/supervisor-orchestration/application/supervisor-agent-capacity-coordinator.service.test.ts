import { describe, expect, test } from "bun:test";
import type { SupervisorAgentProfile } from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorAgentCapacityCoordinator } from "./supervisor-agent-capacity-coordinator.service";

describe("SupervisorAgentCapacityCoordinator", () => {
  test("enforces shared capacity groups and overnight exact-resume readiness", async () => {
    const firstTask = createSupervisorRunFixture().tasks[0];
    if (!firstTask) {
      throw new Error("Expected fixture task");
    }
    const run = createSupervisorRunFixture({
      tasks: [
        {
          ...firstTask,
          preferredAgentId: "codex",
          attempts: [
            {
              attemptId: "attempt-1",
              chatId: "chat-1",
              agentId: "codex",
              status: "running",
              idempotencyKey: "key-1",
              startedAt: "2026-08-10T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    const profiles: SupervisorAgentProfile[] = [
      profile("codex", "shared-plan", true),
      profile("claude", "shared-plan", false),
    ];
    const coordinator = new SupervisorAgentCapacityCoordinator({
      runs: {
        listNonTerminal: async () => [run],
      } as never,
      profiles: { list: async () => profiles },
    });

    await expect(
      coordinator.admit({ userId: "user-1", agentId: "claude" })
    ).resolves.toEqual({
      eligible: false,
      reason: "Shared capacity group is full",
    });
    await expect(
      coordinator.admit({
        userId: "user-1",
        agentId: "claude",
        overnight: true,
      })
    ).resolves.toEqual({
      eligible: false,
      reason: "Agent has not passed ACP handshake and exact-resume readiness",
    });
  });
});

function profile(
  agentId: string,
  capacityGroup: string,
  ready: boolean
): SupervisorAgentProfile {
  return {
    agentId,
    enabled: true,
    roles: ["manager", "implementation"],
    maxConcurrentSessions: 1,
    capacityGroup,
    readiness: {
      handshake: ready ? "passed" : "untested",
      exactResume: ready ? "passed" : "untested",
    },
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}
