import { describe, expect, test } from "bun:test";
import { LoadAgentSessionService } from "./load-agent-session.service";

describe("LoadAgentSessionService", () => {
  test("delegates to CreateSessionService with sessionIdToLoad", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const expectedSession = { id: "chat-1" } as never;
    const service = new LoadAgentSessionService({
      execute: async (input: Record<string, unknown>) => {
        calls.push(input);
        return expectedSession;
      },
    } as never);

    const result = await service.execute({
      userId: "user-1",
      projectId: "project-1",
      sessionId: "sess-abc123",
      agentId: "agent-1",
    });

    expect(result).toBe(expectedSession);
    expect(calls).toEqual([
      {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-abc123",
        agentId: "agent-1",
      },
    ]);
  });
});
