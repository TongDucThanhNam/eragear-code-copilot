import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  BroadcastEvent,
  ChatSession,
} from "@/shared/types/session.types";
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
    flush: () => null,
    hasContent: () => false,
    reset: () => undefined,
    getMessageId: () => null,
    ensureMessageId: () => "msg-1",
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
    broadcast: async (_chatId: string, event: BroadcastEvent) => {
      events.push(event);
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
    resolveServers: async () => [],
    toAcpServers: () => [],
  } as unknown as SessionMcpConfigService;
}

describe("SessionAcpBootstrapService", () => {
  test("resume load broadcasts mode and model snapshots derived from config options", async () => {
    const chatSession = createChatSession("chat-resume");
    const { runtime, events } = createRuntimeStub(chatSession);
    const historyReplayCalls: string[] = [];

    const connection = {
      initialize: async () => ({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: {
            resume: false,
            setModel: true,
          },
        },
      }),
      loadSession: async () =>
        ({
          sessionId: "sess-resume",
          modes: {
            currentModeId: "legacy-mode",
            availableModes: [{ id: "legacy-mode", name: "Legacy Mode" }],
          },
          models: {
            currentModelId: "legacy-model",
            availableModels: [{ modelId: "legacy-model", name: "Legacy Model" }],
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
        broadcastPromptEnd: async (chatId: string) => {
          historyReplayCalls.push(chatId);
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
      initialize: async () => ({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: {
            resume: false,
            setModel: true,
          },
        },
      }),
      newSession: async () =>
        ({
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
      unstable_setSessionModel: async (params: {
        sessionId: string;
        modelId: string;
      }) => {
        setModelCalls.push(params);
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
        broadcastPromptEnd: async () => undefined,
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
  });
});
