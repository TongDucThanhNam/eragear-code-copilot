import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ENV } from "@/config/environment";
import type { AppError } from "@/shared/errors";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { BroadcastEvent, ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import type { AgentRuntimePort } from "./ports/agent-runtime.port";
import type {
  SessionAcpPort,
  SessionBufferingPort,
} from "./ports/session-acp.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { SessionAcpBootstrapService } from "./session-acp-bootstrap.service";
import type { SessionHistoryReplayService } from "./session-history-replay.service";
import type { SessionMcpConfigService } from "./session-mcp-config.service";

function createLoggerStub(): LoggerPort {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

function createBuffer(): SessionBufferingPort {
  return {
    replayEventCount: 0,
    appendContent: () => undefined,
    appendReasoning: () => undefined,
    consumePendingReasoning: () => null,
    hasPendingReasoning: () => false,
    flush: () => null,
    hasContent: () => false,
    reset: () => undefined,
    getMessageId: () => null,
    ensureMessageId: () => "msg-1",
    getContentStats: () => ({
      contentChunkCount: 0,
      contentTextLength: 0,
      contentDurationMs: null,
    }),
    resetContentStats: () => undefined,
  };
}

function createChatSession(chatId: string): ChatSession {
  return {
    id: chatId,
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: new EventEmitter(),
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "connecting",
  } satisfies Partial<ChatSession> as ChatSession;
}

function createRuntimeStub(session: ChatSession): {
  runtime: SessionRuntimePort;
  events: BroadcastEvent[];
} {
  const events: BroadcastEvent[] = [];
  const runtime = {
    set: () => undefined,
    get: (chatId: string) => (chatId === session.id ? session : undefined),
    delete: () => undefined,
    deleteIfMatch: () => false,
    has: () => true,
    getAll: () => [session],
    runExclusive: async <T>(_chatId: string, work: () => Promise<T>) =>
      await work(),
    isLockHeld: () => false,
    broadcast: (_chatId: string, event: BroadcastEvent) => {
      events.push(event);
      return Promise.resolve();
    },
  } as unknown as SessionRuntimePort;
  return { runtime, events };
}

function createSessionAcpStub(): SessionAcpPort {
  return {
    createBuffer,
    createHandlers: () => ({}) as never,
  };
}

function createMcpConfigStub(): SessionMcpConfigService {
  return {
    resolveServers: () => Promise.resolve([]),
    toAcpServers: () => [],
  } as unknown as SessionMcpConfigService;
}

describe("SessionAcpBootstrapService", () => {
  test("advertises dangerous ACP capabilities only when explicitly enabled", async () => {
    const originalFsWriteEnabled = ENV.acpFsWriteEnabled;
    const originalTerminalEnabled = ENV.acpTerminalEnabled;
    const chatSession = createChatSession("chat-capability-gating");
    const { runtime } = createRuntimeStub(chatSession);
    let initializeParams: Record<string, unknown> | undefined;

    ENV.acpFsWriteEnabled = false;
    ENV.acpTerminalEnabled = false;

    const connection = {
      initialize: (params: Record<string, unknown>) => {
        initializeParams = params;
        return Promise.resolve({
          protocolVersion: 1,
          agentCapabilities: {},
        });
      },
      newSession: () =>
        Promise.resolve({
          sessionId: "sess-new",
          configOptions: [],
        }),
    };

    const service = new SessionAcpBootstrapService(
      runtime,
      {} as SessionRepositoryPort,
      createSessionAcpStub(),
      {
        createAcpConnection: () => connection as never,
      } as unknown as AgentRuntimePort,
      createMcpConfigStub(),
      {
        broadcastPromptEnd: () => Promise.resolve(undefined),
      } as unknown as SessionHistoryReplayService,
      createLoggerStub(),
      () => ({ defaultModel: "" })
    );

    try {
      await service.bootstrap({
        chatId: chatSession.id,
        chatSession,
        buffer: createBuffer(),
        projectRoot: "/tmp/project",
      });
    } finally {
      ENV.acpFsWriteEnabled = originalFsWriteEnabled;
      ENV.acpTerminalEnabled = originalTerminalEnabled;
    }

    expect(initializeParams).toMatchObject({
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: false },
        terminal: false,
      },
    });
  });

  test("prefers loadSession when agent exposes both load and resume capabilities", async () => {
    const chatSession = createChatSession("chat-load-primary");
    chatSession.suppressReplayBroadcast = true;
    const { runtime } = createRuntimeStub(chatSession);
    const calls = {
      load: 0,
      resume: 0,
    };

    const connection = {
      initialize: () =>
        Promise.resolve({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: {
              resume: true,
              setModel: true,
            },
          },
        }),
      loadSession: () => {
        calls.load += 1;
        return Promise.resolve({
          sessionId: "sess-load-primary",
          modes: {
            currentModeId: "mode-from-load",
            availableModes: [{ id: "mode-from-load", name: "Mode From Load" }],
          },
          models: {
            currentModelId: "model-from-load",
            availableModels: [
              { modelId: "model-from-load", name: "Model From Load" },
            ],
          },
          configOptions: [],
        });
      },
      unstable_resumeSession: () => {
        calls.resume += 1;
        return Promise.resolve({
          sessionId: "sess-resume-should-not-run",
          modes: {
            currentModeId: "mode-from-resume",
            availableModes: [
              { id: "mode-from-resume", name: "Mode From Resume" },
            ],
          },
          models: {
            currentModelId: "model-from-resume",
            availableModels: [
              { modelId: "model-from-resume", name: "Model From Resume" },
            ],
          },
          configOptions: [],
        });
      },
    };

    const service = new SessionAcpBootstrapService(
      runtime,
      {} as SessionRepositoryPort,
      createSessionAcpStub(),
      {
        createAcpConnection: () => connection as never,
      } as unknown as AgentRuntimePort,
      createMcpConfigStub(),
      {
        broadcastPromptEnd: () => Promise.resolve(undefined),
      } as unknown as SessionHistoryReplayService,
      createLoggerStub(),
      () => ({ defaultModel: "" })
    );

    await service.bootstrap({
      chatId: chatSession.id,
      chatSession,
      buffer: createBuffer(),
      projectRoot: "/tmp/project",
      sessionIdToLoad: "sess-load-primary",
    });

    expect(calls.load).toBe(1);
    expect(calls.resume).toBe(0);
    expect(chatSession.modes?.currentModeId).toBe("mode-from-load");
    expect(chatSession.models?.currentModelId).toBe("model-from-load");
    expect(chatSession.useUnstableResume).toBe(false);
    expect(chatSession.suppressReplayBroadcast).toBe(false);
  });

  test("uses unstable_resumeSession only when loadSession is unavailable", async () => {
    const chatSession = createChatSession("chat-resume-only");
    const { runtime } = createRuntimeStub(chatSession);
    const calls = {
      load: 0,
      resume: 0,
    };

    const connection = {
      initialize: () =>
        Promise.resolve({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: false,
            sessionCapabilities: {
              resume: true,
              setModel: true,
            },
          },
        }),
      loadSession: () => {
        calls.load += 1;
        return Promise.resolve({
          sessionId: "sess-load-should-not-run",
          modes: {
            currentModeId: "mode-from-load",
            availableModes: [{ id: "mode-from-load", name: "Mode From Load" }],
          },
          models: {
            currentModelId: "model-from-load",
            availableModels: [
              { modelId: "model-from-load", name: "Model From Load" },
            ],
          },
          configOptions: [],
        });
      },
      unstable_resumeSession: () => {
        calls.resume += 1;
        return Promise.resolve({
          sessionId: "sess-resume-only",
          modes: {
            currentModeId: "mode-from-resume",
            availableModes: [
              { id: "mode-from-resume", name: "Mode From Resume" },
            ],
          },
          models: {
            currentModelId: "model-from-resume",
            availableModels: [
              { modelId: "model-from-resume", name: "Model From Resume" },
            ],
          },
          configOptions: [],
        });
      },
    };

    const service = new SessionAcpBootstrapService(
      runtime,
      {} as SessionRepositoryPort,
      createSessionAcpStub(),
      {
        createAcpConnection: () => connection as never,
      } as unknown as AgentRuntimePort,
      createMcpConfigStub(),
      {
        broadcastPromptEnd: () => Promise.resolve(undefined),
      } as unknown as SessionHistoryReplayService,
      createLoggerStub(),
      () => ({ defaultModel: "" })
    );

    await service.bootstrap({
      chatId: chatSession.id,
      chatSession,
      buffer: createBuffer(),
      projectRoot: "/tmp/project",
      sessionIdToLoad: "sess-resume-only",
    });

    expect(calls.load).toBe(0);
    expect(calls.resume).toBe(1);
    expect(chatSession.modes?.currentModeId).toBe("mode-from-resume");
    expect(chatSession.models?.currentModelId).toBe("model-from-resume");
    expect(chatSession.useUnstableResume).toBe(true);
  });

  test("resume load broadcasts mode and model snapshots derived from config options", async () => {
    const chatSession = createChatSession("chat-resume");
    const { runtime, events } = createRuntimeStub(chatSession);
    const historyReplayCalls: string[] = [];

    const connection = {
      initialize: () =>
        Promise.resolve({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: {
              resume: false,
              setModel: true,
            },
          },
        }),
      loadSession: () =>
        Promise.resolve({
          sessionId: "sess-resume",
          modes: {
            currentModeId: "legacy-mode",
            availableModes: [{ id: "legacy-mode", name: "Legacy Mode" }],
          },
          models: {
            currentModelId: "legacy-model",
            availableModels: [
              { modelId: "legacy-model", name: "Legacy Model" },
            ],
          },
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              category: "mode",
              type: "select",
              currentValue: "config-mode",
              options: [{ value: "config-mode", name: "Config Mode" }],
            },
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "config-model",
              options: [{ value: "config-model", name: "Config Model" }],
            },
          ],
        }),
    };

    const service = new SessionAcpBootstrapService(
      runtime,
      {} as SessionRepositoryPort,
      createSessionAcpStub(),
      {
        createAcpConnection: () => connection as never,
      } as unknown as AgentRuntimePort,
      createMcpConfigStub(),
      {
        broadcastPromptEnd: (chatId: string) => {
          historyReplayCalls.push(chatId);
          return Promise.resolve(undefined);
        },
      } as unknown as SessionHistoryReplayService,
      createLoggerStub(),
      () => ({ defaultModel: "" })
    );

    await service.bootstrap({
      chatId: chatSession.id,
      chatSession,
      buffer: createBuffer(),
      projectRoot: "/tmp/project",
      sessionIdToLoad: "sess-resume",
    });

    expect(chatSession.modes?.currentModeId).toBe("config-mode");
    expect(chatSession.models?.currentModelId).toBe("config-model");
    expect(events).toContainEqual({
      type: "current_mode_update",
      modeId: "config-mode",
      reason: "session_bootstrap_snapshot",
      metadata: {
        source: "session_bootstrap",
      },
    });
    expect(events).toContainEqual({
      type: "current_model_update",
      modelId: "config-model",
    });
    expect(historyReplayCalls).toEqual(["chat-resume"]);
  });

  test("new session default model syncs both model state and model config option", async () => {
    const chatSession = createChatSession("chat-new");
    const { runtime, events } = createRuntimeStub(chatSession);
    const setModelCalls: Array<{ sessionId: string; modelId: string }> = [];

    const connection = {
      initialize: () =>
        Promise.resolve({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: {
              resume: false,
              setModel: true,
            },
          },
        }),
      newSession: () =>
        Promise.resolve({
          sessionId: "sess-new",
          modes: {
            currentModeId: "ask",
            availableModes: [{ id: "ask", name: "Ask" }],
          },
          models: {
            currentModelId: "model-old",
            availableModels: [
              { modelId: "model-old", name: "Model Old" },
              { modelId: "model-new", name: "Model New" },
            ],
          },
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              category: "mode",
              type: "select",
              currentValue: "ask",
              options: [{ value: "ask", name: "Ask" }],
            },
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "model-old",
              options: [
                { value: "model-old", name: "Model Old" },
                { value: "model-new", name: "Model New" },
              ],
            },
          ],
        }),
      unstable_setSessionModel: (params: {
        sessionId: string;
        modelId: string;
      }) => {
        setModelCalls.push(params);
        return Promise.resolve(undefined);
      },
    };

    const service = new SessionAcpBootstrapService(
      runtime,
      {} as SessionRepositoryPort,
      createSessionAcpStub(),
      {
        createAcpConnection: () => connection as never,
      } as unknown as AgentRuntimePort,
      createMcpConfigStub(),
      {
        broadcastPromptEnd: () => Promise.resolve(undefined),
      } as unknown as SessionHistoryReplayService,
      createLoggerStub(),
      () => ({ defaultModel: "model-new" })
    );

    await service.bootstrap({
      chatId: chatSession.id,
      chatSession,
      buffer: createBuffer(),
      projectRoot: "/tmp/project",
    });

    expect(setModelCalls).toEqual([
      {
        sessionId: "sess-new",
        modelId: "model-new",
      },
    ]);
    expect(chatSession.models?.currentModelId).toBe("model-new");
    const modelConfig = chatSession.configOptions?.find(
      (option) => option.category === "model" || option.id === "model"
    );
    expect(modelConfig?.currentValue).toBe("model-new");
    expect(events).toContainEqual({
      type: "current_model_update",
      modelId: "model-new",
    });
    expect(chatSession.chatStatus).toBe("ready");
  });

  test("wraps loadSession failure with AGENT_SESSION_LOAD_FAILED", async () => {
    const chatSession = createChatSession("chat-load-fail");
    const { runtime } = createRuntimeStub(chatSession);

    const connection = {
      initialize: () =>
        Promise.resolve({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { resume: false, setModel: true },
          },
        }),
      loadSession: () => Promise.reject(new Error("Internal error")),
    };

    const service = new SessionAcpBootstrapService(
      runtime,
      {} as SessionRepositoryPort,
      createSessionAcpStub(),
      {
        createAcpConnection: () => connection as never,
      } as unknown as AgentRuntimePort,
      createMcpConfigStub(),
      {
        broadcastPromptEnd: () => Promise.resolve(undefined),
      } as unknown as SessionHistoryReplayService,
      createLoggerStub(),
      () => ({ defaultModel: "" })
    );

    await expect(
      service.bootstrap({
        chatId: chatSession.id,
        chatSession,
        buffer: createBuffer(),
        projectRoot: "/tmp/project",
        sessionIdToLoad: "sess-load-fail",
      })
    ).rejects.toMatchObject({
      code: "AGENT_SESSION_LOAD_FAILED",
    } satisfies Partial<AppError>);
  });
});
