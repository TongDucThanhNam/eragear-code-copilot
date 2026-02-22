import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionRuntimePort } from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { CodeContextService } from "./code-context.service";
import type { GitPort } from "./ports/git.port";

const CHAT_NOT_FOUND_RE = /chat not found/i;

function createSession(userId: string, projectRoot = "/tmp/project"): ChatSession {
  return {
    id: "chat-1",
    userId,
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot,
    emitter: new EventEmitter(),
    cwd: projectRoot,
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  };
}

describe("CodeContextService", () => {
  test("rejects cross-user access to chat context", async () => {
    const service = new CodeContextService(
      {
        getProjectContext: async () => ({
          projectRules: [],
          activeTabs: [],
          files: [],
        }),
        getDiff: async () => "",
        readFileWithinRoot: async () => "",
      } as unknown as GitPort,
      {
        get: () => createSession("user-2"),
      } as unknown as SessionRuntimePort
    );

    await expect(service.getProjectContext("user-1", "chat-1")).rejects.toThrow(
      CHAT_NOT_FOUND_RE
    );
  });

  test("reads project context and files for chat owner", async () => {
    const calls: string[] = [];
    const service = new CodeContextService(
      {
        getProjectContext: async (scanRoot: string) => {
          calls.push(`context:${scanRoot}`);
          return await {
            projectRules: [],
            activeTabs: [],
            files: [],
          };
        },
        getDiff: async (projectRoot: string) => {
          calls.push(`diff:${projectRoot}`);
          return await "diff";
        },
        readFileWithinRoot: async (projectRoot: string, filePath: string) => {
          calls.push(`file:${projectRoot}:${filePath}`);
          return await "content";
        },
      } as unknown as GitPort,
      {
        get: () => createSession("user-1"),
      } as unknown as SessionRuntimePort
    );

    await expect(
      service.getProjectContext("user-1", "chat-1")
    ).resolves.toEqual({ projectRules: [], activeTabs: [], files: [] });
    await expect(service.getGitDiff("user-1", "chat-1")).resolves.toBe("diff");
    await expect(
      service.getFileContent("user-1", "chat-1", "README.md")
    ).resolves.toEqual({ content: "content" });
    expect(calls).toEqual([
      "context:/tmp/project",
      "diff:/tmp/project",
      "file:/tmp/project:README.md",
    ]);
  });

  test("syncs and clears unsaved editor buffer state", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "eragear-tooling-"));
    const session = createSession("user-1", projectRoot);
    const service = new CodeContextService(
      {
        getProjectContext: async () => ({
          projectRules: [],
          activeTabs: [],
          files: [],
        }),
        getDiff: async () => "",
        readFileWithinRoot: async () => "",
      } as unknown as GitPort,
      {
        get: () => session,
        runExclusive: async (_chatId: string, work: () => Promise<unknown>) =>
          await work(),
      } as unknown as SessionRuntimePort
    );

    try {
      await service.syncEditorBuffer({
        userId: "user-1",
        chatId: "chat-1",
        path: "src/app.ts",
        isDirty: true,
        content: "unsaved",
      });

      const dirtyEntry = [...(session.editorTextBuffers ?? new Map()).entries()].at(
        0
      );
      expect(dirtyEntry?.[0]).toBe(path.join(projectRoot, "src/app.ts"));
      expect(dirtyEntry?.[1].content).toBe("unsaved");

      await service.syncEditorBuffer({
        userId: "user-1",
        chatId: "chat-1",
        path: "src/app.ts",
        isDirty: false,
      });
      expect(session.editorTextBuffers?.size ?? 0).toBe(0);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
