import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SessionRepositoryPort } from "@/modules/session";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { AiSessionRuntimeAdapter } from "./ai-session-runtime.adapter";

function createRuntimeStub(session: ChatSession): SessionRuntimePort {
  return {
    set() {
      return undefined;
    },
    get() {
      return session;
    },
    delete() {
      return undefined;
    },
    deleteIfMatch() {
      return true;
    },
    has() {
      return true;
    },
    getAll() {
      return [session];
    },
    runExclusive(_chatId, work) {
      return work();
    },
    isLockHeld() {
      return true;
    },
    broadcast() {
      return Promise.resolve();
    },
  };
}

function createRepoStub(): SessionRepositoryPort {
  return {
    updateStatus: async () => undefined,
  } as unknown as SessionRepositoryPort;
}

function createSession(params?: {
  spawnfile?: string;
  spawnargs?: string[];
  agentName?: string;
  prompt?: (input: unknown) => Promise<{ stopReason: string }>;
}): ChatSession {
  const prompt =
    params?.prompt ?? (() => Promise.resolve({ stopReason: "end_turn" }));
  return {
    id: "chat-1",
    userId: "user-1",
    proc: {
      spawnfile: params?.spawnfile ?? process.execPath,
      spawnargs: params?.spawnargs ?? [params?.spawnfile ?? process.execPath],
      kill: () => true,
      killed: false,
      exitCode: null,
      stdin: { destroyed: false, writable: true },
    } as unknown as ChatSession["proc"],
    conn: {
      prompt,
      cancel: async () => undefined,
      signal: { aborted: false },
    } as unknown as ChatSession["conn"],
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
    sessionId: "acp-session-1",
    agentInfo: params?.agentName
      ? { name: params.agentName, version: "1.0.0" }
      : undefined,
  };
}

function textPrompt() {
  return [{ type: "text", text: "hello" }] as unknown as Parameters<
    ChatSession["conn"]["prompt"]
  >[0]["prompt"];
}

describe("AiSessionRuntimeAdapter.prompt", () => {
  test("skips _meta when prompt meta policy is never", async () => {
    const calls: unknown[] = [];
    const session = createSession({
      prompt: (input) => {
        calls.push(input);
        return Promise.resolve({ stopReason: "end_turn" });
      },
    });
    const adapter = new AiSessionRuntimeAdapter(
      createRuntimeStub(session),
      createRepoStub(),
      {
        promptMetaPolicyProvider: () => ({
          acpPromptMetaPolicy: "never",
          acpPromptMetaAllowlist: [process.execPath],
        }),
      }
    );

    await adapter.prompt(session, textPrompt(), { maxTokens: 123 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatchObject({ _meta: expect.anything() });
  });

  test("attaches _meta when policy is always", async () => {
    const calls: unknown[] = [];
    const session = createSession({
      prompt: (input) => {
        calls.push(input);
        return Promise.resolve({ stopReason: "end_turn" });
      },
    });
    const adapter = new AiSessionRuntimeAdapter(
      createRuntimeStub(session),
      createRepoStub(),
      {
        promptMetaPolicyProvider: () => ({
          acpPromptMetaPolicy: "always",
          acpPromptMetaAllowlist: [],
        }),
      }
    );

    await adapter.prompt(session, textPrompt(), { maxTokens: 256 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      _meta: {
        maxTokens: 256,
        max_tokens: 256,
      },
    });
  });

  test("attaches _meta when allowlist matches process command", async () => {
    const calls: unknown[] = [];
    const session = createSession({
      prompt: (input) => {
        calls.push(input);
        return Promise.resolve({ stopReason: "end_turn" });
      },
      spawnfile: process.execPath,
    });
    const adapter = new AiSessionRuntimeAdapter(
      createRuntimeStub(session),
      createRepoStub(),
      {
        promptMetaPolicyProvider: () => ({
          acpPromptMetaPolicy: "allowlist",
          acpPromptMetaAllowlist: [process.execPath],
        }),
      }
    );

    await adapter.prompt(session, textPrompt(), { maxTokens: 64 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      _meta: {
        maxTokens: 64,
        max_tokens: 64,
      },
    });
  });

  test("retries prompt without _meta when agent rejects prompt metadata", async () => {
    const calls: unknown[] = [];
    const session = createSession({
      prompt: (input) => {
        calls.push(input);
        if (
          typeof input === "object" &&
          input &&
          "_meta" in (input as Record<string, unknown>)
        ) {
          return Promise.reject(
            new Error(
              "API Error 400: The prompt parameter was not received normally."
            )
          );
        }
        return Promise.resolve({ stopReason: "end_turn" });
      },
    });
    const adapter = new AiSessionRuntimeAdapter(
      createRuntimeStub(session),
      createRepoStub(),
      {
        promptMetaPolicyProvider: () => ({
          acpPromptMetaPolicy: "always",
          acpPromptMetaAllowlist: [],
        }),
      }
    );

    await adapter.prompt(session, textPrompt(), { maxTokens: 512 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      _meta: {
        maxTokens: 512,
        max_tokens: 512,
      },
    });
    expect(calls[1]).not.toMatchObject({ _meta: expect.anything() });

    calls.length = 0;
    await adapter.prompt(session, textPrompt(), { maxTokens: 512 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatchObject({ _meta: expect.anything() });
  });
});
