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
import type {
  BroadcastEvent,
  ChatSession,
  TerminalState,
} from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { scheduleThrottledBroadcast } from "./broadcast-throttle";
import { createToolCallHandlers } from "./tool-calls";

const OUTSIDE_PROJECT_ROOT_REGEX = /outside project root/i;
const FILE_NOT_FOUND_REGEX = /File not found/i;
const TERMINAL_COMMAND = process.execPath;
const LONG_OUTPUT_SCRIPT_4096 = "process.stdout.write('x'.repeat(4096));";
const LONG_OUTPUT_SCRIPT_1024 = "process.stdout.write('x'.repeat(1024));";
const EXIT_WITH_CODE_7_SCRIPT = "process.exit(7);";
const EXIT_WITH_CODE_0_SCRIPT = "process.exit(0);";
const KEEP_PROCESS_ALIVE_SCRIPT = "setInterval(() => undefined, 1000);";

function nodeEvalArgs(script: string): string[] {
  return ["-e", script];
}

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

function createRuntime(
  session: ChatSession,
  options?: {
    broadcastEvents?: Array<{ chatId: string; event: BroadcastEvent }>;
  }
): SessionRuntimePort {
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
    isLockHeld(chatId) {
      return lockTails.has(chatId);
    },
    broadcast(chatId: string, event: BroadcastEvent) {
      options?.broadcastEvents?.push({ chatId, event });
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
  const originalAllowedCommandPolicies = ENV.allowedTerminalCommandPolicies.map(
    (policy) => ({
      command: policy.command,
      allowAnyArgs: policy.allowAnyArgs,
      allowedArgs: [...(policy.allowedArgs ?? [])],
      allowedArgPatterns: [...(policy.allowedArgPatterns ?? [])],
    })
  );
  const originalAllowedEnvKeys = [...ENV.allowedEnvKeys];
  const originalOutputHardCap = ENV.terminalOutputHardCapBytes;
  const originalMessageContentMaxBytes = ENV.messageContentMaxBytes;
  const originalTerminalTimeoutMs = ENV.terminalTimeoutMs;
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "eragear-tool-calls-"));
    ENV.allowedTerminalCommandPolicies = [
      {
        command: TERMINAL_COMMAND,
        allowAnyArgs: true,
      },
    ];
    ENV.allowedEnvKeys = [];
    ENV.terminalOutputHardCapBytes = originalOutputHardCap;
  });

  afterEach(async () => {
    ENV.allowedTerminalCommandPolicies = originalAllowedCommandPolicies.map(
      (policy) => ({
        command: policy.command,
        allowAnyArgs: policy.allowAnyArgs,
        allowedArgs: [...(policy.allowedArgs ?? [])],
        allowedArgPatterns: [...(policy.allowedArgPatterns ?? [])],
      })
    );
    ENV.allowedEnvKeys = [...originalAllowedEnvKeys];
    ENV.terminalOutputHardCapBytes = originalOutputHardCap;
    ENV.messageContentMaxBytes = originalMessageContentMaxBytes;
    ENV.terminalTimeoutMs = originalTerminalTimeoutMs;
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
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs(LONG_OUTPUT_SCRIPT_4096),
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

  test("broadcasts terminal output with the terminal owner turnId", async () => {
    const events: Array<{ chatId: string; event: BroadcastEvent }> = [];
    const session = createSession("chat-terminal-turn", tmpDir);
    session.activeTurnId = "turn-1";
    const runtime = createRuntime(session, { broadcastEvents: events });
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs("process.stdout.write('hi');"),
    });
    await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );

    const terminalEvent = events.find(
      (entry) =>
        entry.chatId === session.id &&
        entry.event.type === "terminal_output" &&
        entry.event.terminalId === created.terminalId
    );
    expect(terminalEvent).toBeDefined();
    expect(terminalEvent?.event.type).toBe("terminal_output");
    if (terminalEvent?.event.type === "terminal_output") {
      expect(terminalEvent.event.turnId).toBe("turn-1");
    }
  });

  test("clamps requested outputByteLimit by hard cap", async () => {
    ENV.terminalOutputHardCapBytes = 64;
    const session = createSession("chat-cap-clamp", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs(LONG_OUTPUT_SCRIPT_1024),
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
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs(EXIT_WITH_CODE_7_SCRIPT),
    });
    const status = await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );

    expect(status.exitCode).toBe(7);
  });

  test("tracks process group id for POSIX terminal processes", async () => {
    if (process.platform === "win32") {
      return;
    }
    const session = createSession("chat-process-group", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs(EXIT_WITH_CODE_0_SCRIPT),
    });
    const terminal = session.terminals.get(created.terminalId) as
      | TerminalState
      | undefined;
    expect(terminal?.processGroupId).toEqual(terminal?.process.pid);
    await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );
  });

  test("waitForTerminalExit resolves when process spawn errors", async () => {
    ENV.allowedTerminalCommandPolicies = [
      { command: "/definitely-not-a-real-command", allowAnyArgs: true },
    ];
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

  test("rejects terminal invocation when args violate command policy", async () => {
    ENV.allowedTerminalCommandPolicies = [
      {
        command: TERMINAL_COMMAND,
        allowedArgs: ["--version"],
      },
    ];
    const session = createSession("chat-policy-deny", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    await expect(
      handlers.createTerminal(session.id, {
        sessionId: session.id,
        command: TERMINAL_COMMAND,
        args: nodeEvalArgs("process.stdout.write('blocked');"),
      })
    ).rejects.toThrow("Command invocation blocked by server policy");
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

  test("returns explicit error when reading a missing file", async () => {
    const session = createSession("chat-missing-file", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    await expect(
      handlers.readTextFileForChat(session.id, {
        sessionId: session.id,
        path: "does-not-exist.txt",
      })
    ).rejects.toThrow(FILE_NOT_FOUND_REGEX);
  });

  test("rejects oversized full reads to prevent memory exhaustion", async () => {
    ENV.messageContentMaxBytes = 8;
    const session = createSession("chat-large-full-read", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);
    await writeFile(path.join(tmpDir, "big.txt"), "123456789", "utf8");

    await expect(
      handlers.readTextFileForChat(session.id, {
        sessionId: session.id,
        path: "big.txt",
      })
    ).rejects.toThrow(/too large for full read/i);
  });

  test("reads requested line window without full-file split allocations", async () => {
    const session = createSession("chat-line-window", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);
    const content = Array.from({ length: 2000 }, (_, index) => `line-${index + 1}`)
      .join("\r\n");
    await writeFile(path.join(tmpDir, "window.txt"), content, "utf8");

    const result = await handlers.readTextFileForChat(session.id, {
      sessionId: session.id,
      path: "window.txt",
      line: 101,
      limit: 3,
    });

    expect(result.content).toBe("line-101\nline-102\nline-103");
  });

  test("rejects oversized line-window output", async () => {
    ENV.messageContentMaxBytes = 4;
    const session = createSession("chat-line-window-cap", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);
    await writeFile(path.join(tmpDir, "window-cap.txt"), "abc\ndef", "utf8");

    await expect(
      handlers.readTextFileForChat(session.id, {
        sessionId: session.id,
        path: "window-cap.txt",
        line: 1,
        limit: 2,
      })
    ).rejects.toThrow(/maximum response size/i);
  });

  test("prefers dirty editor buffer over disk content for reads", async () => {
    const session = createSession("chat-dirty-buffer", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);
    const filePath = path.join(tmpDir, "dirty.txt");
    await writeFile(filePath, "on-disk", "utf8");
    session.editorTextBuffers = new Map([
      [filePath, { content: "unsaved\nbuffer", updatedAt: Date.now() }],
    ]);

    const result = await handlers.readTextFileForChat(session.id, {
      sessionId: session.id,
      path: "dirty.txt",
      line: 2,
      limit: 1,
    });

    expect(result.content).toBe("buffer");
  });

  test("rejects oversized line-window output from dirty editor buffer", async () => {
    ENV.messageContentMaxBytes = 4;
    const session = createSession("chat-dirty-buffer-cap", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);
    const filePath = path.join(tmpDir, "dirty-cap.txt");
    await writeFile(filePath, "disk", "utf8");
    session.editorTextBuffers = new Map([
      [filePath, { content: "abc\ndef", updatedAt: Date.now() }],
    ]);

    await expect(
      handlers.readTextFileForChat(session.id, {
        sessionId: session.id,
        path: "dirty-cap.txt",
        line: 1,
        limit: 2,
      })
    ).rejects.toThrow(/maximum response size/i);
  });

  test("creates missing parent directories and broadcasts file_modified", async () => {
    const events: Array<{ chatId: string; event: BroadcastEvent }> = [];
    const session = createSession("chat-write-nested", tmpDir);
    const runtime = createRuntime(session, { broadcastEvents: events });
    const handlers = createToolCallHandlers(runtime);
    const nestedFilePath = path.join(tmpDir, "nested", "deeper", "new.txt");
    session.editorTextBuffers = new Map([
      [nestedFilePath, { content: "dirty-before-write", updatedAt: Date.now() }],
    ]);

    await handlers.writeTextFileForChat(session.id, {
      sessionId: session.id,
      path: "nested/deeper/new.txt",
      content: "created",
    });

    const written = await readFile(nestedFilePath, "utf8");
    expect(written).toBe("created");
    expect(session.editorTextBuffers.has(nestedFilePath)).toBe(false);
    expect(events).toContainEqual({
      chatId: session.id,
      event: { type: "file_modified", path: "nested/deeper/new.txt" },
    });
  });

  test("flushes pending ui_message_part broadcasts before file_modified", async () => {
    const events: Array<{ chatId: string; event: BroadcastEvent }> = [];
    const session = createSession("chat-write-flush-order", tmpDir);
    const runtime = createRuntime(session, { broadcastEvents: events });
    const handlers = createToolCallHandlers(runtime);

    scheduleThrottledBroadcast({
      chatId: session.id,
      messageId: "msg-1",
      partIndex: 0,
      isNew: false,
      sessionRuntime: runtime,
      event: {
        type: "ui_message_part",
        messageId: "msg-1",
        messageRole: "assistant",
        partIndex: 0,
        part: {
          type: "text",
          text: "pending chunk",
          state: "streaming",
        },
        isNew: false,
      },
      options: {},
    });

    await handlers.writeTextFileForChat(session.id, {
      sessionId: session.id,
      path: "notes.txt",
      content: "updated",
    });

    expect(events[0]?.event.type).toBe("ui_message_part");
    if (events[0]?.event.type === "ui_message_part") {
      expect(events[0].event.part).toMatchObject({
        type: "text",
        text: "pending chunk",
        state: "streaming",
      });
    }
    expect(events[1]).toEqual({
      chatId: session.id,
      event: { type: "file_modified", path: "notes.txt" },
    });
  });

  test("clears terminal timeout timer when terminal is released", async () => {
    ENV.terminalTimeoutMs = 30;
    const session = createSession("chat-release-timeout", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs(KEEP_PROCESS_ALIVE_SCRIPT),
    });
    const term = session.terminals.get(created.terminalId) as
      | TerminalState
      | undefined;
    expect(term).toBeDefined();
    if (!term) {
      return;
    }

    await handlers.releaseTerminal(session.id, {
      sessionId: session.id,
      terminalId: created.terminalId,
    });
    await withTimeout(
      new Promise((resolve) => {
        setTimeout(resolve, 80);
      })
    );
    expect(term.killTimer).toBeUndefined();
    expect(session.terminals.has(created.terminalId)).toBe(false);
  });

  test("coalesces concurrent kill requests for the same terminal", async () => {
    ENV.terminalTimeoutMs = 1000;
    const session = createSession("chat-kill-concurrent", tmpDir);
    const runtime = createRuntime(session);
    const handlers = createToolCallHandlers(runtime);

    const created = await handlers.createTerminal(session.id, {
      sessionId: session.id,
      command: TERMINAL_COMMAND,
      args: nodeEvalArgs(KEEP_PROCESS_ALIVE_SCRIPT),
    });
    const term = session.terminals.get(created.terminalId) as
      | TerminalState
      | undefined;
    expect(term).toBeDefined();
    if (!term) {
      return;
    }

    await Promise.all([
      handlers.killTerminal(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      }),
      handlers.killTerminal(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      }),
    ]);
    expect(term.killTimer).toBeUndefined();
    expect(term.terminationPromise).toBeUndefined();

    const status = await withTimeout(
      handlers.waitForTerminalExit(session.id, {
        sessionId: session.id,
        terminalId: created.terminalId,
      })
    );
    expect(status.exitCode === null || status.exitCode !== 0).toBe(true);
  });
});
