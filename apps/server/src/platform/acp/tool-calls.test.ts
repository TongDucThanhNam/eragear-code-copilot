import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV } from "@/config/environment";
import type { SessionRuntimePort } from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { createToolCallHandlers } from "./tool-calls";

const OUTSIDE_PROJECT_ROOT_REGEX = /outside project root/i;

function createSession(chatId: string, projectRoot: string): ChatSession {
  return {
    id: chatId,
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot,
    emitter: {} as ChatSession["emitter"],
    cwd: projectRoot,
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  } satisfies Partial<ChatSession> as ChatSession;
}

function createRuntime(session: ChatSession): SessionRuntimePort {
  const sessions = new Map<string, ChatSession>([[session.id, session]]);
  const lockTails = new Map<string, Promise<void>>();
  return {
    set(chatId, value) {
      sessions.set(chatId, value);
    },
    get(chatId) {
      return sessions.get(chatId);
    },
    delete(chatId) {
      sessions.delete(chatId);
    },
    has(chatId) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    async runExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T> {
      const previousTail = lockTails.get(chatId) ?? Promise.resolve();
      let releaseLock: () => void = () => undefined;
      const lockSignal = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const nextTail = previousTail.then(
        () => lockSignal,
        () => lockSignal
      );
      lockTails.set(chatId, nextTail);
      await previousTail.catch(() => undefined);
      try {
        return await work();
      } finally {
        releaseLock();
        if (lockTails.get(chatId) === nextTail) {
          lockTails.delete(chatId);
        }
      }
    },
    broadcast() {
      // no-op
      return Promise.resolve();
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 2500
): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    }),
  ]);
}

describe("createToolCallHandlers", () => {
  const originalAllowedCommands = [...ENV.allowedTerminalCommands];
  const originalAllowedEnvKeys = [...ENV.allowedEnvKeys];
  const originalOutputHardCap = ENV.terminalOutputHardCapBytes;
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "eragear-tool-calls-"));
    ENV.allowedTerminalCommands = ["/bin/sh"];
    ENV.allowedEnvKeys = [];
    ENV.terminalOutputHardCapBytes = originalOutputHardCap;
  });

  afterEach(async () => {
    ENV.allowedTerminalCommands = [...originalAllowedCommands];
    ENV.allowedEnvKeys = [...originalAllowedEnvKeys];
    ENV.terminalOutputHardCapBytes = originalOutputHardCap;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("applies hard cap when outputByteLimit is omitted", async () => {
    ENV.terminalOutputHardCapBytes = 128;
    const session = createSession("chat-cap-default", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: "/bin/sh",
      args: [
        "-lc",
        "i=0; while [ $i -lt 4096 ]; do printf x; i=$((i+1)); done",
      ],
    });
    await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );
    const output = await handlers.terminalOutput(session.id, {
      sessionId: session.id,
      terminalId: created.terminalId,
    });

    expect(output.output.length).toBeLessThanOrEqual(128);
    expect(output.truncated).toBe(true);
  });

  test("clamps requested outputByteLimit by hard cap", async () => {
    ENV.terminalOutputHardCapBytes = 64;
    const session = createSession("chat-cap-clamp", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: "/bin/sh",
      args: [
        "-lc",
        "i=0; while [ $i -lt 1024 ]; do printf x; i=$((i+1)); done",
      ],
      outputByteLimit: 10_000,
    });
    await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );
    const output = await handlers.terminalOutput(session.id, {
      sessionId: session.id,
      terminalId: created.terminalId,
    });

    expect(output.output.length).toBeLessThanOrEqual(64);
    expect(output.truncated).toBe(true);
  });

  test("waitForTerminalExit resolves for normal process exits", async () => {
    const session = createSession("chat-exit-normal", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: "/bin/sh",
      args: ["-lc", "exit 7"],
    });
    const status = await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );

    expect(status.exitCode).toBe(7);
  });

  test("waitForTerminalExit resolves when process spawn errors", async () => {
    ENV.allowedTerminalCommands = ["/definitely-not-a-real-command"];
    const session = createSession("chat-exit-error", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: "/definitely-not-a-real-command",
      args: [],
    });
    const status = await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );

    expect(status).toEqual({ exitCode: null, signal: null });
  });

  test("denies symlink escape on non-existing write paths", async () => {
    const projectRoot = path.join(tmpDir, "project");
    const outsideRoot = path.join(tmpDir, "outside");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, path.join(projectRoot, "link-out"));

    const session = createSession("chat-symlink-escape", projectRoot);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    await expect(
      handlers.writeTextFileForChat(session.id, {
        sessionId: session.id,
        path: "link-out/new.txt",
        content: "escape",
      })
    ).rejects.toThrow(OUTSIDE_PROJECT_ROOT_REGEX);
  });

  test("allows IO when project root itself is a symlink", async () => {
    const realRoot = path.join(tmpDir, "real-root");
    const linkedRoot = path.join(tmpDir, "linked-root");
    await mkdir(realRoot, { recursive: true });
    await writeFile(path.join(realRoot, "existing.txt"), "hello", "utf8");
    await symlink(realRoot, linkedRoot);

    const session = createSession("chat-symlink-root", linkedRoot);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const readResult = await handlers.readTextFileForChat(session.id, {
      sessionId: session.id,
      path: "existing.txt",
    });
    expect(readResult.content).toBe("hello");

    await handlers.writeTextFileForChat(session.id, {
      sessionId: session.id,
      path: "new.txt",
      content: "world",
    });
    const written = await readFile(path.join(realRoot, "new.txt"), "utf8");
    expect(written).toBe("world");
  });
});
