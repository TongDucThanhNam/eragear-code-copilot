import { describe, expect, test } from "bun:test";
import type { ChatSession } from "@/shared/types/session.types";
import { SessionMetadataPersistenceService } from "./session-metadata-persistence.service";

function createChatSessionStub(): ChatSession {
  return {
    sessionId: "sess-loaded",
    projectId: "project-1",
    agentInfo: {
      name: "Codex",
      version: "1.0.0",
    },
    loadSessionSupported: true,
    useUnstableResume: false,
    supportsModelSwitching: true,
    agentCapabilities: { session: { load: true } },
    authMethods: [],
    modes: {
      currentModeId: "mode-1",
      availableModes: [],
    },
    models: {
      currentModelId: "model-1",
      availableModels: [],
    },
  } as unknown as ChatSession;
}

describe("SessionMetadataPersistenceService", () => {
  test("creates a new stored session when loading an agent session into a new chat", async () => {
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const sessionRepo = {
      findById: async () => undefined,
      create: async (value: unknown) => {
        createCalls.push(value);
      },
      updateMetadata: async (...args: unknown[]) => {
        updateCalls.push(args);
      },
    };

    const service = new SessionMetadataPersistenceService(sessionRepo as never);
    await service.persist({
      chatId: "chat-new",
      params: {
        userId: "user-1",
        projectId: "project-1",
        agentId: "agent-1",
        sessionIdToLoad: "sess-remote",
      },
      chatSession: createChatSessionStub(),
      agentCommand: "codex",
      agentArgs: ["acp"],
      agentEnv: { CI: "1" },
      projectRoot: "/repo",
    });

    expect(updateCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      id: "chat-new",
      userId: "user-1",
      sessionId: "sess-loaded",
      projectId: "project-1",
      status: "running",
      modeId: "mode-1",
      modelId: "model-1",
    });
  });

  test("updates existing metadata when resuming an existing local chat", async () => {
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const sessionRepo = {
      findById: async () => ({ id: "chat-existing" }),
      create: async (value: unknown) => {
        createCalls.push(value);
      },
      updateMetadata: async (...args: unknown[]) => {
        updateCalls.push(args);
      },
    };

    const service = new SessionMetadataPersistenceService(sessionRepo as never);
    await service.persist({
      chatId: "chat-existing",
      params: {
        userId: "user-1",
        projectId: "project-1",
        agentId: "agent-1",
        chatId: "chat-existing",
        sessionIdToLoad: "sess-remote",
      },
      chatSession: createChatSessionStub(),
      agentCommand: "codex",
      agentArgs: ["acp"],
      agentEnv: { CI: "1" },
      projectRoot: "/repo",
    });

    expect(createCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject([
      "chat-existing",
      "user-1",
      expect.objectContaining({
        sessionId: "sess-loaded",
        projectId: "project-1",
        status: "running",
      }),
    ]);
  });
});
