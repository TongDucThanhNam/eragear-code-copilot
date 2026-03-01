import { describe, expect, test } from "bun:test";
import { AppError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import type { CreateSessionService } from "./create-session.service";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { ResumeSessionService } from "./resume-session.service";

function createStoredSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "chat-1",
    userId: "user-1",
    status: "stopped",
    projectRoot: "/tmp/project",
    projectId: "project-1",
    sessionId: "sess-1",
    command: "agent-cli",
    args: ["serve"],
    env: { FOO: "bar" },
    messages: [],
    ...overrides,
  };
}

function createRunningSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "chat-1",
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: {} as ChatSession["emitter"],
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: {
      messages: new Map(),
      toolPartIndex: new Map(),
    },
    chatStatus: "ready",
    ...overrides,
  };
}

describe("ResumeSessionService", () => {
  test("returns alreadyRunning when runtime session exists", async () => {
    const storedPlan: NonNullable<ChatSession["plan"]> = {
      entries: [{ content: "stored", priority: "medium", status: "pending" }],
    };
    const stored = createStoredSession({
      plan: storedPlan,
    });
    let createCalls = 0;
    const existing = createRunningSession({
      modes: {
        currentModeId: "code",
        availableModes: [{ id: "code", name: "Code" }],
      },
      models: {
        currentModelId: "gpt-x",
        availableModels: [{ modelId: "gpt-x", name: "GPT X" }],
      },
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "code",
          options: [{ value: "code", name: "Code" }],
        },
      ],
      promptCapabilities: { image: true },
      loadSessionSupported: true,
      supportsModelSwitching: true,
    });
    const repo = {
      findById: async () => stored,
    } as unknown as SessionRepositoryPort;
    const runtime = {
      get: () => existing,
    } as unknown as SessionRuntimePort;
    const createSession = {
      execute: async () => {
        createCalls += 1;
        return createRunningSession();
      },
    } as unknown as CreateSessionService;

    const service = new ResumeSessionService(repo, runtime, createSession);
    const result = await service.execute("user-1", "chat-1");

    expect(result).toEqual({
      ok: true,
      alreadyRunning: true,
      sessionLoadMethod: null,
      modes: existing.modes,
      models: existing.models,
      configOptions: existing.configOptions ?? null,
      sessionInfo: null,
      promptCapabilities: existing.promptCapabilities,
      loadSessionSupported: true,
      supportsModelSwitching: true,
      plan: storedPlan,
    });
    expect(createCalls).toBe(0);
  });

  test("bootstraps stored session when runtime session is missing", async () => {
    const storedPlan: NonNullable<ChatSession["plan"]> = {
      entries: [{ content: "stored", priority: "medium", status: "pending" }],
    };
    const stored = createStoredSession({
      plan: storedPlan,
      sessionId: "sess-resume",
      command: "codex",
      args: ["--fast"],
      env: { HOME: "/tmp" },
    });
    let receivedInput: unknown = undefined;
    const resumed = createRunningSession({
      id: "chat-1",
      modes: {
        currentModeId: "ask",
        availableModes: [{ id: "ask", name: "Ask" }],
      },
      models: {
        currentModelId: "model-1",
        availableModels: [{ modelId: "model-1", name: "Model 1" }],
      },
      configOptions: [],
      promptCapabilities: { image: false },
      loadSessionSupported: true,
      supportsModelSwitching: false,
    });
    const repo = {
      findById: async () => stored,
    } as unknown as SessionRepositoryPort;
    const runtime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;
    const createSession = {
      execute: async (input: Record<string, unknown>) => {
        receivedInput = input;
        return resumed;
      },
    } as unknown as CreateSessionService;

    const service = new ResumeSessionService(repo, runtime, createSession);
    const result = await service.execute("user-1", "chat-1");

    if (!receivedInput || typeof receivedInput !== "object") {
      throw new Error("Expected create session input");
    }
    expect(receivedInput).toMatchObject({
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/tmp/project",
      command: "codex",
      args: ["--fast"],
      env: { HOME: "/tmp" },
      chatId: "chat-1",
      sessionIdToLoad: "sess-resume",
      importExternalHistoryOnLoad: true,
    });
    expect(result).toEqual({
      ok: true,
      chatId: "chat-1",
      sessionLoadMethod: null,
      modes: resumed.modes,
      models: resumed.models,
      configOptions: resumed.configOptions ?? null,
      sessionInfo: null,
      promptCapabilities: resumed.promptCapabilities,
      loadSessionSupported: true,
      supportsModelSwitching: false,
      plan: storedPlan,
    });
  });

  test("throws when stored session is missing", async () => {
    const repo = {
      findById: async () => undefined,
    } as unknown as SessionRepositoryPort;
    const runtime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;
    const createSession = {
      execute: async () => createRunningSession(),
    } as unknown as CreateSessionService;

    const service = new ResumeSessionService(repo, runtime, createSession);
    await expect(service.execute("user-1", "chat-1")).rejects.toThrow(
      /session not found in store/i
    );
  });

  test("throws when stored session has no ACP sessionId", async () => {
    const repo = {
      findById: async () => createStoredSession({ sessionId: undefined }),
    } as unknown as SessionRepositoryPort;
    const runtime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;
    const createSession = {
      execute: async () => createRunningSession(),
    } as unknown as CreateSessionService;

    const service = new ResumeSessionService(repo, runtime, createSession);
    await expect(service.execute("user-1", "chat-1")).rejects.toThrow(
      /missing acp sessionid/i
    );
  });

  test("falls back to a fresh session when agent session load fails", async () => {
    const stored = createStoredSession({
      sessionId: "sess-stale",
      command: "codex",
      args: ["acp"],
      env: { HOME: "/tmp" },
    });
    const resumed = createRunningSession({
      id: "chat-1",
      promptCapabilities: { image: false },
      loadSessionSupported: true,
      supportsModelSwitching: false,
    });
    const receivedInputs: Array<Record<string, unknown>> = [];
    let executeCalls = 0;

    const repo = {
      findById: async () => stored,
    } as unknown as SessionRepositoryPort;
    const runtime = {
      get: () => undefined,
    } as unknown as SessionRuntimePort;
    const createSession = {
      execute: async (input: Record<string, unknown>) => {
        executeCalls += 1;
        receivedInputs.push(input);
        if (executeCalls === 1) {
          throw new AppError({
            message: "Failed to resume agent session via loadSession: Internal error",
            code: "AGENT_SESSION_LOAD_FAILED",
            statusCode: 502,
            module: "session",
            op: "session.lifecycle.create",
          });
        }
        return resumed;
      },
    } as unknown as CreateSessionService;

    const service = new ResumeSessionService(repo, runtime, createSession);
    const result = await service.execute("user-1", "chat-1");

    expect(executeCalls).toBe(2);
    expect(receivedInputs[0]).toMatchObject({
      chatId: "chat-1",
      sessionIdToLoad: "sess-stale",
      importExternalHistoryOnLoad: true,
    });
    expect(receivedInputs[1]).toMatchObject({
      chatId: "chat-1",
      importExternalHistoryOnLoad: false,
    });
    expect(receivedInputs[1]?.sessionIdToLoad).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      chatId: "chat-1",
      sessionLoadMethod: null,
      modes: resumed.modes,
      models: resumed.models,
      configOptions: resumed.configOptions ?? null,
      sessionInfo: null,
      promptCapabilities: resumed.promptCapabilities,
      loadSessionSupported: true,
      supportsModelSwitching: false,
      plan: null,
    });
  });
});
