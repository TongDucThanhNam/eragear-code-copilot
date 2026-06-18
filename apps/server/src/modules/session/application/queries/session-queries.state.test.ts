import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "@/config/constants";
import type { ChatSession } from "@/shared/types/session.types";
import { isSessionConfigSelectOption } from "@/shared/utils/session-config-options.util";
import type { SessionRepositoryPort } from "../ports/session-repository.port";
import type { SessionRuntimePort } from "../ports/session-runtime.port";
import { SessionQueries } from "./session-queries";

function createSessionRuntimeStub(
  session: ChatSession | null
): SessionRuntimePort & {
  broadcasts: Array<{ chatId: string; event: unknown }>;
} {
  const sessions = session
    ? new Map<string, ChatSession>([[session.id, session]])
    : new Map<string, ChatSession>();
  const broadcasts: Array<{ chatId: string; event: unknown }> = [];

  return {
    set(chatId, sess) {
      sessions.set(chatId, sess);
    },
    get(chatId) {
      return sessions.get(chatId);
    },
    delete(chatId) {
      sessions.delete(chatId);
    },
    deleteIfMatch(chatId, expectedSession) {
      const current = sessions.get(chatId);
      if (!current || current !== expectedSession) {
        return false;
      }
      sessions.delete(chatId);
      return true;
    },
    has(chatId) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    runExclusive<T>(_chatId: string, work: () => Promise<T>): Promise<T> {
      return work();
    },
    isLockHeld(_chatId) {
      return false;
    },
    broadcast(_chatId, event) {
      broadcasts.push({ chatId: _chatId, event });
      return Promise.resolve();
    },
    get broadcasts() {
      return broadcasts;
    },
  };
}

/**
 * Creates a minimal mock of SessionRepositoryPort that won't be called for running sessions.
 * This is only used to satisfy the SessionQueries constructor.
 */
function createSessionRepositoryStub(): SessionRepositoryPort {
  return {
    findById: async () => undefined,
    findAll: async () => [],
    findAllForMaintenance: async () => [],
    findPage: async () => ({ sessions: [], hasMore: false }),
    findPageForMaintenance: async () => ({ sessions: [], hasMore: false }),
    countAll: async () => 0,
    create: async () => undefined,
    updateStatus: async () => undefined,
    updateMetadata: async () => undefined,
    delete: async () => undefined,
    appendMessage: async () => ({ appended: true }),
    replaceMessages: async () => ({ replaced: true }),
    getMessageById: async () => undefined,
    getMessagesPage: async () => ({ messages: [], hasMore: false }),
    compactMessages: async () => ({ compacted: 0 }),
    getStorageStats: async () => ({
      dbSizeBytes: 0,
      walSizeBytes: 0,
      freePages: 0,
      sessionCount: 0,
      messageCount: 0,
      writeQueueDepth: 0,
    }),
  };
}

/**
 * Creates a session with more than DEFAULT_MAX_VISIBLE_MODEL_COUNT (100) models
 * and config options to test capping behavior.
 */
function createLargeSession(userId: string, chatId: string): ChatSession {
  // Create 150 models (> 100 cap)
  const largeModelList = Array.from({ length: 150 }, (_, i) => ({
    modelId: `model-${i}`,
    name: `Model ${i}`,
    description: null as string | null,
  }));

  // Create a large model config option with 150 options (> 100 cap)
  const largeModelOptions = Array.from({ length: 150 }, (_, i) => ({
    value: `model-${i}`,
    name: `Model ${i}`,
  }));

  return {
    id: chatId,
    userId,
    chatStatus: "ready",
    models: {
      currentModelId: "model-50", // current model is within the cap range
      availableModels: largeModelList,
    },
    configOptions: [
      {
        id: "primaryModel",
        name: "Primary Model",
        category: "model",
        type: "select",
        currentValue: "model-50",
        options: largeModelOptions,
        description: null,
      },
    ],
    modes: {
      currentModeId: "code",
      availableModes: [{ id: "code", name: "Code" }],
    },
    commands: [],
    sessionInfo: { id: chatId, title: "Test Session" },
    promptCapabilities: {},
    loadSessionSupported: true,
    supportsModelSwitching: true,
  } as unknown as ChatSession;
}

/**
 * Creates a session where the current model is BEYOND the 100-item cap.
 * This tests the scenario where the selected model is not in the capped visible list
 * but exists in the internal uncapped state.
 */
function createLargeSessionWithCurrentBeyondCap(
  userId: string,
  chatId: string
): ChatSession {
  const largeModelList = Array.from({ length: 150 }, (_, i) => ({
    modelId: `model-${i}`,
    name: `Model ${i}`,
    description: null as string | null,
  }));

  const largeModelOptions = Array.from({ length: 150 }, (_, i) => ({
    value: `model-${i}`,
    name: `Model ${i}`,
  }));

  return {
    id: chatId,
    userId,
    chatStatus: "ready",
    models: {
      currentModelId: "model-120", // current model is BEYOND the cap range (index 120)
      availableModels: largeModelList,
    },
    configOptions: [
      {
        id: "primaryModel",
        name: "Primary Model",
        category: "model",
        type: "select",
        currentValue: "model-120", // current value beyond cap
        options: largeModelOptions,
        description: null,
      },
    ],
    modes: {
      currentModeId: "code",
      availableModes: [{ id: "code", name: "Code" }],
    },
    commands: [],
    sessionInfo: { id: chatId, title: "Test Session" },
    promptCapabilities: {},
    loadSessionSupported: true,
    supportsModelSwitching: true,
  } as unknown as ChatSession;
}

describe("SessionQueries.state", () => {
  describe("capped response behavior", () => {
    test("AC1: getSessionState returns capped availableModels (150 -> 100)", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new SessionQueries(
        sessionRepo,
        sessionRuntime,
        undefined,
        false
      );

      const result = await service.state(userId, chatId);

      // Response should have capped models
      const models = result.models;
      if (!models) {
        throw new Error("Expected response models");
      }
      expect(models.availableModels.length).toBeLessThanOrEqual(
        DEFAULT_MAX_VISIBLE_MODEL_COUNT
      );
      expect(models.availableModels.length).toBe(100);

      // Original internal session should remain UNCHANGED (uncapped)
      const sessionModels = session.models;
      if (!sessionModels) {
        throw new Error("Expected internal session models");
      }
      expect(sessionModels.availableModels.length).toBe(150); // Still 150 internally
    });

    test("AC2: getSessionState returns capped model configOptions.options (150 -> 100)", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new SessionQueries(
        sessionRepo,
        sessionRuntime,
        undefined,
        false
      );

      const result = await service.state(userId, chatId);

      // Response should have capped config options
      const configOptions = result.configOptions;
      if (!configOptions) {
        throw new Error("Expected response config options");
      }
      expect(configOptions.length).toBe(1);

      const modelOption = configOptions.find(
        (opt) => opt.category === "model" || opt.id === "primaryModel"
      );
      if (!isSessionConfigSelectOption(modelOption)) {
        throw new Error("Expected model select config option");
      }
      expect(modelOption.options.length).toBeLessThanOrEqual(
        DEFAULT_MAX_VISIBLE_MODEL_COUNT
      );
      expect(modelOption.options.length).toBe(100);

      // Original internal session should remain UNCHANGED (uncapped)
      const sessionConfigOptions = session.configOptions;
      if (!sessionConfigOptions) {
        throw new Error("Expected internal session config options");
      }
      const internalModelOption = sessionConfigOptions.find(
        (opt) => opt.category === "model" || opt.id === "primaryModel"
      );
      if (!isSessionConfigSelectOption(internalModelOption)) {
        throw new Error("Expected internal model select config option");
      }
      expect(internalModelOption.options.length).toBe(150); // Still 150 internally
    });

    test("AC3: getSessionState preserves currentModelId even when beyond cap", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSessionWithCurrentBeyondCap(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new SessionQueries(
        sessionRepo,
        sessionRuntime,
        undefined,
        false
      );

      const result = await service.state(userId, chatId);

      // Response should still include the current model (even if beyond cap)
      const models = result.models;
      if (!models) {
        throw new Error("Expected response models");
      }
      expect(models.currentModelId).toBe("model-120");

      // The model should be present in the capped list (repositioned to end)
      const currentInList = models.availableModels.find(
        (m) => m.modelId === "model-120"
      );
      if (!currentInList) {
        throw new Error("Expected current model in capped list");
      }
      expect(currentInList.modelId).toBe("model-120");

      // Current value in config option should also be preserved
      const configOptions = result.configOptions;
      if (!configOptions) {
        throw new Error("Expected response config options");
      }
      const modelOption = configOptions.find(
        (opt) => opt.category === "model" || opt.id === "primaryModel"
      );
      expect(modelOption?.currentValue).toBe("model-120");
    });

    test("AC4: calling getSessionState does NOT mutate internal session object", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);

      // Capture reference to original arrays/objects
      const sessionModels = session.models;
      const sessionConfigOptions = session.configOptions;
      if (!(sessionModels && sessionConfigOptions)) {
        throw new Error("Expected internal session selection state");
      }
      const originalModelsRef = sessionModels.availableModels;
      const originalConfigOptionsRef = sessionConfigOptions;
      const originalModelOptionOptionsRef = (
        sessionConfigOptions[0] as { options: unknown[] }
      ).options;

      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new SessionQueries(
        sessionRepo,
        sessionRuntime,
        undefined,
        false
      );

      await service.state(userId, chatId);

      // Internal session should be completely unchanged
      expect(sessionModels.availableModels).toBe(originalModelsRef); // Same reference
      expect(sessionModels.availableModels.length).toBe(150);
      expect(session.configOptions).toBe(originalConfigOptionsRef); // Same reference
      const currentModelOption = sessionConfigOptions[0] as {
        options: unknown[];
      };
      expect(currentModelOption.options).toBe(originalModelOptionOptionsRef); // Same reference
      expect(currentModelOption.options.length).toBe(150);
    });

    test("AC5: models and configOptions in response are NOT the same objects as internal state", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new SessionQueries(
        sessionRepo,
        sessionRuntime,
        undefined,
        false
      );

      const result = await service.state(userId, chatId);

      // Response objects should be different references from internal state
      const models = result.models;
      const configOptions = result.configOptions;
      const sessionModels = session.models;
      const sessionConfigOptions = session.configOptions;
      if (!(models && configOptions && sessionModels && sessionConfigOptions)) {
        throw new Error("Expected response and internal selection state");
      }
      expect(models.availableModels).not.toBe(sessionModels.availableModels);
      const resultModelOption = configOptions[0];
      const sessionModelOption = sessionConfigOptions[0];
      if (!(resultModelOption && sessionModelOption)) {
        throw new Error("Expected model config options");
      }
      expect(resultModelOption).not.toBe(sessionModelOption);

      // But values should be equivalent (except for truncation)
      expect(models.currentModelId).toBe(sessionModels.currentModelId);
      expect(resultModelOption.currentValue).toBe(
        sessionModelOption.currentValue
      );
    });

    test("OpenCode sessions do not expose available models to web clients", async () => {
      const userId = "user-1";
      const chatId = "chat-opencode";
      const session = createLargeSession(userId, chatId);
      session.agentInfo = { name: "OpenCode", version: "1.14.31" };
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new SessionQueries(
        sessionRepo,
        sessionRuntime,
        undefined,
        false
      );

      const result = await service.state(userId, chatId);

      expect(result.models?.currentModelId).toBe("model-50");
      expect(result.models?.availableModels).toEqual([]);
      expect(
        result.configOptions?.some(
          (option) => option.category === "model" || option.id === "model"
        )
      ).toBe(false);
      expect(session.models?.availableModels).toHaveLength(150);
      const modelOption = session.configOptions?.[0];
      if (!isSessionConfigSelectOption(modelOption)) {
        throw new Error("Expected session model select config option");
      }
      expect(modelOption.options).toHaveLength(150);
    });
  });

  describe("stopped session handling", () => {
    test("returns null models/configOptions for stopped sessions", async () => {
      const userId = "user-1";
      const chatId = "chat-1";

      // Runtime returns undefined (session not active)
      const sessionRuntime = createSessionRuntimeStub(null);

      // Mock repo returns a stored session
      const storedSession = {
        id: chatId,
        userId,
        chatStatus: "inactive" as const,
        commands: [] as unknown[],
        loadSessionSupported: true,
        supportsModelSwitching: true,
        agentInfo: null,
        plan: null,
        supervisor: { mode: "off", status: "idle" as const },
      };

      const repoWithStoredSession: SessionRepositoryPort = {
        findById: async () =>
          storedSession as unknown as ReturnType<
            NonNullable<SessionRepositoryPort["findById"]>
          >,
        findAll: async () => [],
        findAllForMaintenance: async () => [],
        findPage: async () => ({ sessions: [], hasMore: false }),
        findPageForMaintenance: async () => ({ sessions: [], hasMore: false }),
        countAll: async () => 0,
        create: async () => undefined,
        updateStatus: async () => undefined,
        updateMetadata: async () => undefined,
        delete: async () => undefined,
        appendMessage: async () => ({ appended: true }),
        replaceMessages: async () => ({ replaced: true }),
        getMessageById: async () => undefined,
        getMessagesPage: async () => ({ messages: [], hasMore: false }),
        compactMessages: async () => ({ compacted: 0 }),
        getStorageStats: async () => ({
          dbSizeBytes: 0,
          walSizeBytes: 0,
          freePages: 0,
          sessionCount: 0,
          messageCount: 0,
          writeQueueDepth: 0,
        }),
      };

      const service = new SessionQueries(
        repoWithStoredSession,
        sessionRuntime,
        undefined,
        false
      );

      const result = await service.state(userId, chatId);

      // Stopped sessions return null for models and configOptions
      expect(result.models).toBeNull();
      expect(result.configOptions).toBeNull();
      expect(result.status).toBe("stopped");
    });
  });
});
