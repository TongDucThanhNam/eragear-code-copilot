import { describe, expect, test } from "bun:test";
import type { SupervisorAgentProfile } from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import { SupervisorAgentProfileService } from "./supervisor-agent-profile.service";

describe("SupervisorAgentProfileService", () => {
  test("proves handshake and exact-only resume before overnight readiness", async () => {
    let profile = fixture();
    const calls: string[] = [];
    const service = new SupervisorAgentProfileService({
      agents: {
        listSupervisorProfiles: async () => [profile],
        saveSupervisorProfile: (_userId, next) => {
          profile = next;
          return Promise.resolve(next);
        },
      },
      createSession: {
        execute: async ({ chatId }) => ({
          id: chatId,
          sessionId: "session-1",
        }),
      },
      stopSession: {
        execute: (_userId, chatId) => {
          calls.push(`stop:${chatId}`);
          return Promise.resolve();
        },
      },
      resumeSession: {
        execute: (_userId, chatId, options) => {
          calls.push(`resume:${chatId}:${options.mode}`);
          return Promise.resolve();
        },
      },
      now: () => "2026-08-10T00:00:00.000Z",
      createId: () => "readiness-chat",
    });

    const tested = await service.testResume({
      userId: "user-1",
      agentId: "codex",
      projectId: "project-1",
      projectRoot: "/repo",
    });

    expect(tested.readiness).toEqual({
      handshake: "passed",
      exactResume: "passed",
      checkedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(calls).toEqual([
      "stop:readiness-chat",
      "resume:readiness-chat:exact_only",
      "stop:readiness-chat",
    ]);
  });

  test("fails closed and redacts resume diagnostics", async () => {
    let profile = fixture();
    const service = new SupervisorAgentProfileService({
      agents: {
        listSupervisorProfiles: async () => [profile],
        saveSupervisorProfile: (_userId, next) => {
          profile = next;
          return Promise.resolve(next);
        },
      },
      createSession: {
        execute: async ({ chatId }) => ({ id: chatId, sessionId: "session-1" }),
      },
      stopSession: { execute: async () => undefined },
      resumeSession: {
        execute: () =>
          Promise.reject(
            new Error("Authorization: Bearer secret-token exact resume failed")
          ),
      },
      now: () => "2026-08-10T00:00:00.000Z",
      createId: () => "readiness-chat",
    });

    const tested = await service.testResume({
      userId: "user-1",
      agentId: "codex",
      projectId: "project-1",
      projectRoot: "/repo",
    });

    expect(tested.readiness.exactResume).toBe("failed");
    expect(tested.readiness.failureReason).not.toContain("secret-token");
  });

  test("records exact resume proven by a real manager lifecycle", async () => {
    let profile = fixture();
    profile.readiness = {
      handshake: "passed",
      exactResume: "failed",
      checkedAt: "2026-08-09T00:00:00.000Z",
      failureReason: "Empty ACP session was not resumable",
    };
    const service = new SupervisorAgentProfileService({
      agents: {
        listSupervisorProfiles: async () => [profile],
        saveSupervisorProfile: (_userId, next) => {
          profile = next;
          return Promise.resolve(next);
        },
      },
      createSession: { execute: () => Promise.reject(new Error("not used")) },
      stopSession: { execute: () => Promise.reject(new Error("not used")) },
      resumeSession: { execute: () => Promise.reject(new Error("not used")) },
      now: () => "2026-08-10T00:00:00.000Z",
    });

    const updated = await service.recordExactResumeSuccess({
      userId: "user-1",
      agentId: "codex",
      projectId: "project-1",
    });

    expect(updated.readiness).toEqual({
      handshake: "passed",
      exactResume: "passed",
      checkedAt: "2026-08-10T00:00:00.000Z",
    });
  });
});

function fixture(): SupervisorAgentProfile {
  return {
    agentId: "codex",
    enabled: true,
    roles: ["manager", "implementation", "test"],
    maxConcurrentSessions: 1,
    readiness: { handshake: "untested", exactResume: "untested" },
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}
