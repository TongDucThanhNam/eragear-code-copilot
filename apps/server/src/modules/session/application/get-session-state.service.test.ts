import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "@/config/constants";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { ChatSession } from "@/shared/types/session.types";
import { GetSessionStateService } from "./get-session-state.service";

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
 * This is only used to satisfy the GetSessionStateService constructor.
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

describe("GetSessionStateService", () => {
  describe("capped response behavior", () => {
    test("AC1: getSessionState returns capped availableModels (150 -> 100)", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new GetSessionStateService(
        sessionRepo,
        sessionRuntime,
        false
      );

      const result = await service.execute(userId, chatId);

      // Response should have capped models
      expect(result.models).not.toBeNull();
      expect(result.models!.availableModels.length).toBeLessThanOrEqual(
        DEFAULT_MAX_VISIBLE_MODEL_COUNT
      );
      expect(result.models!.availableModels.length).toBe(100);

      // Original internal session should remain UNCHANGED (uncapped)
      expect(session.models!.availableModels.length).toBe(150); // Still 150 internally
    });

    test("AC2: getSessionState returns capped model configOptions.options (150 -> 100)", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new GetSessionStateService(
        sessionRepo,
        sessionRuntime,
        false
      );

      const result = await service.execute(userId, chatId);

      // Response should have capped config options
      expect(result.configOptions).not.toBeNull();
      expect(result.configOptions!.length).toBe(1);

      const modelOption = result.configOptions!.find(
        (opt) => opt.category === "model" || opt.id === "primaryModel"
      );
      expect(modelOption).toBeDefined();
      expect(modelOption!.options.length).toBeLessThanOrEqual(
        DEFAULT_MAX_VISIBLE_MODEL_COUNT
      );
      expect(modelOption!.options.length).toBe(100);

      // Original internal session should remain UNCHANGED (uncapped)
      const internalModelOption = session.configOptions!.find(
        (opt) => opt.category === "model" || opt.id === "primaryModel"
      );
      expect(internalModelOption!.options.length).toBe(150); // Still 150 internally
    });

    test("AC3: getSessionState preserves currentModelId even when beyond cap", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSessionWithCurrentBeyondCap(userId, chatId);
      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new GetSessionStateService(
        sessionRepo,
        sessionRuntime,
        false
      );

      const result = await service.execute(userId, chatId);

      // Response should still include the current model (even if beyond cap)
      expect(result.models).not.toBeNull();
      expect(result.models!.currentModelId).toBe("model-120");

      // The model should be present in the capped list (repositioned to end)
      const currentInList = result.models!.availableModels.find(
        (m) => m.modelId === "model-120"
      );
      expect(currentInList).toBeDefined();
      expect(currentInList!.modelId).toBe("model-120");

      // Current value in config option should also be preserved
      const modelOption = result.configOptions!.find(
        (opt) => opt.category === "model" || opt.id === "primaryModel"
      );
      expect(modelOption!.currentValue).toBe("model-120");
    });

    test("AC4: calling getSessionState does NOT mutate internal session object", async () => {
      const userId = "user-1";
      const chatId = "chat-1";
      const session = createLargeSession(userId, chatId);

      // Capture reference to original arrays/objects
      const originalModelsRef = session.models!.availableModels;
      const originalConfigOptionsRef = session.configOptions;
      const originalModelOptionOptionsRef = (
        session.configOptions![0] as { options: unknown[] }
      ).options;

      const sessionRuntime = createSessionRuntimeStub(session);
      const sessionRepo = createSessionRepositoryStub();

      const service = new GetSessionStateService(
        sessionRepo,
        sessionRuntime,
        false
      );

      await service.execute(userId, chatId);

      // Internal session should be completely unchanged
      expect(session.models!.availableModels).toBe(originalModelsRef); // Same reference
      expect(session.models!.availableModels.length).toBe(150);
      expect(session.configOptions).toBe(originalConfigOptionsRef); // Same reference
      const currentModelOption = session.configOptions![0] as {
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

      const service = new GetSessionStateService(
        sessionRepo,
        sessionRuntime,
        false
      );

      const result = await service.execute(userId, chatId);

      // Response objects should be different references from internal state
      expect(result.models!.availableModels).not.toBe(
        session.models!.availableModels
      );
      const resultModelOption = result.configOptions![0]!;
      const sessionModelOption = session.configOptions![0]!;
      expect(resultModelOption).not.toBe(sessionModelOption);

      // But values should be equivalent (except for truncation)
      expect(result.models!.currentModelId).toBe(
        session.models!.currentModelId
      );
      expect(resultModelOption.currentValue).toBe(sessionModelOption.currentValue);
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
        findById: async () => storedSession as unknown as ReturnType<NonNullable<SessionRepositoryPort["findById"]>>,
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

      const service = new GetSessionStateService(
        repoWithStoredSession,
        sessionRuntime,
        false
      );

      const result = await service.execute(userId, chatId);

      // Stopped sessions return null for models and configOptions
      expect(result.models).toBeNull();
      expect(result.configOptions).toBeNull();
      expect(result.status).toBe("stopped");
    });
  });
});
