import { describe, expect, test } from "bun:test";
import type { TerminalEvent } from "../application/contracts/terminal.contract";
import type {
  TerminalPtyDisposable,
  TerminalPtyFactory,
  TerminalPtyProcess,
} from "./child-process-terminal-runtime.adapter";

const TEST_SHELL_COMMAND = process.execPath;

process.env.CONFIG_STRICT_ALLOWLIST = "false";
process.env.ALLOW_INSECURE_DEV_DEFAULTS = "true";
process.env.ALLOWED_AGENT_COMMAND_POLICIES = JSON.stringify([
  { command: TEST_SHELL_COMMAND, allowAnyArgs: true },
]);
process.env.ALLOWED_TERMINAL_COMMAND_POLICIES = JSON.stringify([
  { command: TEST_SHELL_COMMAND, allowAnyArgs: true },
]);
process.env.ALLOWED_ENV_KEYS = "PATH,HOME,USERPROFILE,TMP,TEMP";

const { ENV } = await import("@/config/environment");
const { ChildProcessTerminalRuntimeAdapter } = await import(
  "./child-process-terminal-runtime.adapter"
);

class FakePty implements TerminalPtyProcess {
  readonly pid = 1234;
  cols: number;
  rows: number;
  killed = false;
  written: string[] = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number | string }) => void
  >();

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  onData(listener: (data: string) => void): TerminalPtyDisposable {
    this.dataListeners.add(listener);
    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      },
    };
  }

  onExit(
    listener: (event: { exitCode: number; signal?: number | string }) => void
  ): TerminalPtyDisposable {
    this.exitListeners.add(listener);
    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      },
    };
  }

  write(data: string | Buffer): void {
    const text = data.toString();
    this.written.push(text);
    this.emitData(`echo:${text}`);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  kill(): void {
    this.killed = true;
    this.emitExit({ exitCode: 0, signal: "SIGHUP" });
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: { exitCode: number; signal?: number | string }): void {
    for (const listener of [...this.exitListeners]) {
      listener(event);
    }
  }
}

describe("ChildProcessTerminalRuntimeAdapter", () => {
  test("spawns an allowlisted pty and streams stdin/stdout", async () => {
    const previousPolicies = ENV.allowedTerminalCommandPolicies;
    const previousEnvKeys = ENV.allowedEnvKeys;
    const previousOutputLimit = ENV.terminalOutputHardCapBytes;
    ENV.allowedTerminalCommandPolicies = [
      { command: TEST_SHELL_COMMAND, allowAnyArgs: true },
    ];
    ENV.allowedEnvKeys = ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP"];
    ENV.terminalOutputHardCapBytes = 1024;
    const spawned: FakePty[] = [];
    const ptyFactory: TerminalPtyFactory = (input) => {
      const pty = new FakePty(input.cols, input.rows);
      spawned.push(pty);
      return pty;
    };
    try {
      let now = 1;
      const runtime = new ChildProcessTerminalRuntimeAdapter({
        nowMs: () => now++,
        ptyFactory,
      });
      const events: TerminalEvent[] = [];
      const terminal = await runtime.create({
        userId: "user-1",
        cwd: process.cwd(),
        cols: 100,
        rows: 30,
        settings: {
          inheritSystemProfile: false,
          shellCommand: TEST_SHELL_COMMAND,
          shellArgs: ["-l"],
        },
      });
      const unsubscribe = runtime.subscribe("user-1", terminal.id, (event) =>
        events.push(event)
      );

      await runtime.write("user-1", terminal.id, "hello\n");
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "output" && event.data.includes("echo:hello")
        )
      );

      expect(spawned[0]?.written).toEqual(["hello\n"]);
      const resized = await runtime.resize("user-1", terminal.id, 120, 40);
      expect(resized.cols).toBe(120);
      expect(resized.rows).toBe(40);
      expect(spawned[0]?.cols).toBe(120);
      expect(spawned[0]?.rows).toBe(40);

      await runtime.kill("user-1", terminal.id);
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "status" && event.terminal.status === "exited"
        )
      );
      unsubscribe();
      expect((await runtime.list("user-1"))[0]?.status).toBe("exited");
      expect(spawned[0]?.killed).toBe(true);
    } finally {
      ENV.allowedTerminalCommandPolicies = previousPolicies;
      ENV.allowedEnvKeys = previousEnvKeys;
      ENV.terminalOutputHardCapBytes = previousOutputLimit;
    }
  });

  test("caps retained output while streaming full chunks", async () => {
    const previousPolicies = ENV.allowedTerminalCommandPolicies;
    const previousOutputLimit = ENV.terminalOutputHardCapBytes;
    ENV.allowedTerminalCommandPolicies = [
      { command: TEST_SHELL_COMMAND, allowAnyArgs: true },
    ];
    ENV.terminalOutputHardCapBytes = 4;
    const pty = new FakePty(80, 24);
    const runtime = new ChildProcessTerminalRuntimeAdapter({
      ptyFactory: () => pty,
    });
    try {
      const terminal = await runtime.create({
        userId: "user-1",
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        settings: {
          inheritSystemProfile: true,
          shellCommand: TEST_SHELL_COMMAND,
          shellArgs: [],
        },
      });
      pty.emitData("abcdef");
      const replayed: TerminalEvent[] = [];

      runtime.subscribe("user-1", terminal.id, (event) => replayed.push(event));

      const replayOutput = replayed.find((event) => event.type === "output");
      expect(replayOutput?.type === "output" ? replayOutput.data : "").toBe(
        "cdef"
      );
    } finally {
      ENV.allowedTerminalCommandPolicies = previousPolicies;
      ENV.terminalOutputHardCapBytes = previousOutputLimit;
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for terminal event");
}
