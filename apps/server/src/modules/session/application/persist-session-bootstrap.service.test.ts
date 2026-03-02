import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { UIMessage } from "@repo/shared";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import { PersistSessionBootstrapService } from "./persist-session-bootstrap.service";
import type { SessionMetadataPersistenceService } from "./session-metadata-persistence.service";

function createChatSession(): ChatSession {
  return {
    id: "chat-1",
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
    chatStatus: "ready",
  } satisfies Partial<ChatSession> as ChatSession;
}

describe("PersistSessionBootstrapService", () => {
  test("imports external replayed ui messages only after metadata persists", async () => {
    const calls: string[] = [];
    const appended: Array<{ id: string; role: string; content: string }> = [];
    const metadataPersistence = {
      persist: async () => {
        calls.push("metadata");
      },
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string; role: string; content: string }>
      ) => {
        calls.push("replace");
        for (const message of messages) {
          appended.push({
            id: message.id,
            role: message.role,
            content: message.content,
          });
        }
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;
    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = true;
    const userMessage: UIMessage = {
      id: "msg-user",
      role: "user",
      createdAt: 100,
      parts: [{ type: "text", text: "hello", state: "done" }],
    };
    const assistantMessage: UIMessage = {
      id: "msg-assistant",
      role: "assistant",
      createdAt: 200,
      parts: [
        { type: "reasoning", text: "thinking", state: "done" },
        { type: "text", text: "hi", state: "done" },
      ],
    };
    chatSession.uiState.messages.set(userMessage.id, userMessage);
    chatSession.uiState.messages.set(assistantMessage.id, assistantMessage);

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: true,
      },
      chatSession,
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: {},
    });

    expect(calls).toEqual(["metadata", "replace"]);
    expect(appended).toEqual([
      { id: "msg-user", role: "user", content: "hello" },
      { id: "msg-assistant", role: "assistant", content: "hi" },
    ]);
    expect(chatSession.importExternalHistoryOnLoad).toBe(false);
  });

  test("does not import when external-import flag is disabled", async () => {
    const appendedIds: string[] = [];
    const metadataPersistence = {
      persist: async () => undefined,
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string }>
      ) => {
        appendedIds.push(...messages.map((message) => message.id));
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;
    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = false;
    chatSession.uiState.messages.set("msg-1", {
      id: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "ignored", state: "done" }],
    });

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: false,
      },
      chatSession,
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: {},
    });

    expect(appendedIds).toEqual([]);
  });

  test("keeps ACP replay as primary for non-codex agents", async () => {
    const appendedIds: string[] = [];
    const metadataPersistence = {
      persist: async () => undefined,
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string }>
      ) => {
        appendedIds.push(...messages.map((message) => message.id));
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;

    let resolverCalls = 0;
    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo,
      async () => {
        resolverCalls += 1;
        return [
          {
            id: "external-user",
            role: "user",
            createdAt: 10,
            parts: [{ type: "text", text: "external-u", state: "done" }],
          },
          {
            id: "external-assistant",
            role: "assistant",
            createdAt: 20,
            parts: [{ type: "text", text: "external-a", state: "done" }],
          },
        ];
      }
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = true;
    chatSession.uiState.messages.set("runtime-user-1", {
      id: "runtime-user-1",
      role: "user",
      createdAt: 100,
      parts: [{ type: "text", text: "runtime-u1", state: "done" }],
    });
    chatSession.uiState.messages.set("runtime-user-2", {
      id: "runtime-user-2",
      role: "user",
      createdAt: 200,
      parts: [{ type: "text", text: "runtime-u2", state: "done" }],
    });

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: true,
      },
      chatSession,
      agentCommand: "opencode",
      agentArgs: ["acp"],
      agentEnv: {},
    });

    expect(resolverCalls).toBe(0);
    expect(appendedIds).toEqual(["runtime-user-1", "runtime-user-2"]);
  });

  test("keeps ACP replay when codex replay is already healthy", async () => {
    const appendedIds: string[] = [];
    const metadataPersistence = {
      persist: async () => undefined,
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string }>
      ) => {
        appendedIds.push(...messages.map((message) => message.id));
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;

    let resolverCalls = 0;
    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo,
      async () => {
        resolverCalls += 1;
        return [
          {
            id: "external-user",
            role: "user",
            createdAt: 10,
            parts: [{ type: "text", text: "external-u", state: "done" }],
          },
          {
            id: "external-assistant",
            role: "assistant",
            createdAt: 20,
            parts: [{ type: "text", text: "external-a", state: "done" }],
          },
          {
            id: "external-user-2",
            role: "user",
            createdAt: 30,
            parts: [{ type: "text", text: "external-u2", state: "done" }],
          },
          {
            id: "external-assistant-2",
            role: "assistant",
            createdAt: 40,
            parts: [{ type: "text", text: "external-a2", state: "done" }],
          },
        ];
      }
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = true;
    chatSession.uiState.messages.set("runtime-user", {
      id: "runtime-user",
      role: "user",
      createdAt: 100,
      parts: [{ type: "text", text: "runtime-u", state: "done" }],
    });
    chatSession.uiState.messages.set("runtime-assistant", {
      id: "runtime-assistant",
      role: "assistant",
      createdAt: 200,
      parts: [{ type: "text", text: "runtime-a", state: "done" }],
    });

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: true,
      },
      chatSession,
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: {},
    });

    expect(resolverCalls).toBe(0);
    expect(appendedIds).toEqual(["runtime-user", "runtime-assistant"]);
  });

  test("checks codex external history when replay fell back to stored DB snapshot", async () => {
    const appendedIds: string[] = [];
    const metadataPersistence = {
      persist: async () => undefined,
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string }>
      ) => {
        appendedIds.push(...messages.map((message) => message.id));
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;

    let resolverCalls = 0;
    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo,
      async () => {
        resolverCalls += 1;
        return [
          {
            id: "external-user-dup",
            role: "user",
            createdAt: 100,
            parts: [{ type: "text", text: "runtime-u", state: "done" }],
          },
          {
            id: "external-assistant-dup",
            role: "assistant",
            createdAt: 200,
            parts: [{ type: "text", text: "runtime-a", state: "done" }],
          },
          {
            id: "external-user-new",
            role: "user",
            createdAt: 300,
            parts: [{ type: "text", text: "runtime-u2", state: "done" }],
          },
          {
            id: "external-assistant-new",
            role: "assistant",
            createdAt: 400,
            parts: [{ type: "text", text: "runtime-a2", state: "done" }],
          },
        ];
      }
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = true;
    chatSession.replayedStoredHistoryFallback = true;
    chatSession.uiState.messages.set("runtime-user", {
      id: "runtime-user",
      role: "user",
      createdAt: 100,
      parts: [{ type: "text", text: "runtime-u", state: "done" }],
    });
    chatSession.uiState.messages.set("runtime-assistant", {
      id: "runtime-assistant",
      role: "assistant",
      createdAt: 200,
      parts: [{ type: "text", text: "runtime-a", state: "done" }],
    });

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: true,
      },
      chatSession,
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: {},
    });

    expect(resolverCalls).toBe(1);
    expect(appendedIds).toEqual([
      "runtime-user",
      "runtime-assistant",
      "external-user-new",
      "external-assistant-new",
    ]);
  });

  test("uses richer external import history when runtime replay is assistant-sparse", async () => {
    const appended: Array<{ id: string; role: string; content: string }> = [];
    const metadataPersistence = {
      persist: async () => undefined,
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string; role: string; content: string }>
      ) => {
        for (const message of messages) {
          appended.push({
            id: message.id,
            role: message.role,
            content: message.content,
          });
        }
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;

    const externalMessages: UIMessage[] = [
      {
        id: "ext-user-1",
        role: "user",
        createdAt: 10,
        parts: [{ type: "text", text: "u1", state: "done" }],
      },
      {
        id: "ext-assistant-1",
        role: "assistant",
        createdAt: 20,
        parts: [{ type: "text", text: "a1", state: "done" }],
      },
      {
        id: "ext-user-2",
        role: "user",
        createdAt: 30,
        parts: [{ type: "text", text: "u2", state: "done" }],
      },
      {
        id: "ext-assistant-2",
        role: "assistant",
        createdAt: 40,
        parts: [{ type: "text", text: "a2", state: "done" }],
      },
    ];

    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo,
      async () => externalMessages
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = true;
    chatSession.uiState.messages.set("runtime-user-1", {
      id: "runtime-user-1",
      role: "user",
      createdAt: 100,
      parts: [{ type: "text", text: "runtime-u1", state: "done" }],
    });
    chatSession.uiState.messages.set("runtime-user-2", {
      id: "runtime-user-2",
      role: "user",
      createdAt: 200,
      parts: [{ type: "text", text: "runtime-u2", state: "done" }],
    });
    chatSession.uiState.messages.set("runtime-assistant-1", {
      id: "runtime-assistant-1",
      role: "assistant",
      createdAt: 300,
      parts: [{ type: "text", text: "runtime-a1", state: "done" }],
    });

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: true,
      },
      chatSession,
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: {},
    });

    expect(appended.map((message) => message.id)).toEqual([
      "ext-user-1",
      "ext-assistant-1",
      "ext-user-2",
      "ext-assistant-2",
    ]);
  });

  test("keeps runtime replay when external history is not richer", async () => {
    const appendedIds: string[] = [];
    const metadataPersistence = {
      persist: async () => undefined,
    } as unknown as SessionMetadataPersistenceService;
    const sessionRepo = {
      replaceMessages: async (
        _chatId: string,
        _userId: string,
        messages: Array<{ id: string }>
      ) => {
        appendedIds.push(...messages.map((message) => message.id));
        return { replaced: true as const };
      },
    } as unknown as SessionRepositoryPort;

    const service = new PersistSessionBootstrapService(
      metadataPersistence,
      sessionRepo,
      async () => [
        {
          id: "external-user",
          role: "user",
          createdAt: 10,
          parts: [{ type: "text", text: "external-u", state: "done" }],
        },
      ]
    );

    const chatSession = createChatSession();
    chatSession.importExternalHistoryOnLoad = true;
    chatSession.uiState.messages.set("runtime-user", {
      id: "runtime-user",
      role: "user",
      createdAt: 100,
      parts: [{ type: "text", text: "runtime-u", state: "done" }],
    });
    chatSession.uiState.messages.set("runtime-assistant", {
      id: "runtime-assistant",
      role: "assistant",
      createdAt: 200,
      parts: [{ type: "text", text: "runtime-a", state: "done" }],
    });

    await service.execute({
      chatId: "chat-1",
      projectRoot: "/tmp/project",
      params: {
        userId: "user-1",
        projectId: "project-1",
        sessionIdToLoad: "sess-1",
        importExternalHistoryOnLoad: true,
      },
      chatSession,
      agentCommand: "codex",
      agentArgs: [],
      agentEnv: {},
    });

    expect(appendedIds).toEqual(["runtime-user", "runtime-assistant"]);
  });
});
