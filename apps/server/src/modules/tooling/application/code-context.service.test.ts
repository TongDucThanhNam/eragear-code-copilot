import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SessionRuntimePort } from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { CodeContextService } from "./code-context.service";
import type { GitPort } from "./ports/git.port";

const CHAT_NOT_FOUND_RE = /chat not found/i;

function createSession(userId: string): ChatSession {
  return {
    id: "chat-1",
    userId,
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
});
