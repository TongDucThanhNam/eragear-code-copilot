import { EventEmitter } from "node:events";
import path from "node:path";
import { ENV } from "#runtime/config/environment";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import {
  spawnTerminalPty,
  type TerminalPtyDisposable,
  type TerminalPtyFactory,
  type TerminalPtyProcess,
} from "#runtime/shared/terminal/pty-process";
import {
  compileCommandPolicies,
  filterEnvAllowlist,
  isCommandInvocationAllowed,
} from "#runtime/shared/utils/allowlist.util";
import { createId } from "#runtime/shared/utils/id.util";
import { isWindows } from "#runtime/shared/utils/runtime-platform.util";
import type {
  TerminalEvent,
  TerminalRecord,
  TerminalSettings,
} from "../application/contracts/terminal.contract";
import type {
  TerminalRuntimeCreateInput,
  TerminalRuntimePort,
} from "../application/ports/terminal-runtime.port";

const MODULE = "terminal";

export type {
  TerminalPtyDisposable,
  TerminalPtyFactory,
  TerminalPtyProcess,
} from "#runtime/shared/terminal/pty-process";

interface TerminalProcessState {
  record: TerminalRecord;
  pty: TerminalPtyProcess;
  disposables: TerminalPtyDisposable[];
  emitter: EventEmitter;
  outputBuffer: string;
}

interface TerminalProfile {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export class ChildProcessTerminalRuntimeAdapter implements TerminalRuntimePort {
  private readonly terminals = new Map<string, TerminalProcessState>();
  private readonly nowMs: () => number;
  private readonly ptyFactory: TerminalPtyFactory;

  constructor(options?: {
    nowMs?: () => number;
    ptyFactory?: TerminalPtyFactory;
  }) {
    this.nowMs = options?.nowMs ?? (() => Date.now());
    this.ptyFactory = options?.ptyFactory ?? createNodePtyProcess;
  }

  list(userId: string): Promise<TerminalRecord[]> {
    const terminals = [...this.terminals.values()]
      .filter((state) => state.record.userId === userId)
      .map((state) => state.record)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return Promise.resolve(terminals);
  }

  async create(input: TerminalRuntimeCreateInput): Promise<TerminalRecord> {
    const profile = resolveTerminalProfile(input.settings);
    assertCommandAllowed(profile.command, profile.args);
    const terminalId = createId("terminal");
    const createdAt = this.nowMs();
    const pty = await this.ptyFactory({
      command: profile.command,
      args: profile.args,
      cwd: input.cwd,
      env: profile.env,
      cols: input.cols,
      rows: input.rows,
    });
    const record: TerminalRecord = {
      id: terminalId,
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      cwd: input.cwd,
      command: profile.command,
      args: profile.args,
      cols: input.cols,
      rows: input.rows,
      status: "running",
      createdAt,
      updatedAt: createdAt,
    };
    const state: TerminalProcessState = {
      record,
      pty,
      disposables: [],
      emitter: new EventEmitter(),
      outputBuffer: "",
    };
    this.terminals.set(terminalId, state);

    state.disposables.push(
      pty.onData((data) => {
        this.appendOutput(state, data);
      }),
      pty.onExit((event) => {
        this.markExited(
          state,
          event.exitCode,
          event.signal === undefined ? null : String(event.signal)
        );
      })
    );

    return record;
  }

  write(
    userId: string,
    terminalId: string,
    data: string
  ): Promise<TerminalRecord> {
    const state = this.getOwnedTerminal(userId, terminalId);
    if (state.record.status !== "running") {
      throw new ValidationError("Terminal is not writable", {
        module: MODULE,
        op: "write",
        details: { terminalId },
      });
    }
    state.pty.write(data);
    return Promise.resolve(state.record);
  }

  resize(
    userId: string,
    terminalId: string,
    cols: number,
    rows: number
  ): Promise<TerminalRecord> {
    const state = this.getOwnedTerminal(userId, terminalId);
    if (state.record.status !== "running") {
      throw new ValidationError("Terminal is not resizable", {
        module: MODULE,
        op: "resize",
        details: { terminalId },
      });
    }
    state.pty.resize(cols, rows);
    state.record = {
      ...state.record,
      cols,
      rows,
      updatedAt: this.nowMs(),
    };
    state.emitter.emit("event", {
      type: "status",
      terminal: state.record,
    } satisfies TerminalEvent);
    return Promise.resolve(state.record);
  }

  kill(userId: string, terminalId: string): Promise<TerminalRecord> {
    const state = this.getOwnedTerminal(userId, terminalId);
    if (state.record.status === "running") {
      state.pty.kill();
    }
    return Promise.resolve(state.record);
  }

  subscribe(
    userId: string,
    terminalId: string,
    listener: (event: TerminalEvent) => void
  ): () => void {
    const state = this.getOwnedTerminal(userId, terminalId);
    const handler = (event: unknown) => listener(event as TerminalEvent);
    state.emitter.on("event", handler);
    listener({ type: "status", terminal: state.record });
    if (state.outputBuffer) {
      listener({
        type: "output",
        terminalId,
        data: state.outputBuffer,
      });
    }
    return () => {
      state.emitter.off("event", handler);
    };
  }

  private getOwnedTerminal(
    userId: string,
    terminalId: string
  ): TerminalProcessState {
    const state = this.terminals.get(terminalId);
    if (!state || state.record.userId !== userId) {
      throw new NotFoundError("Terminal not found", {
        module: MODULE,
        op: "lookup",
        details: { terminalId },
      });
    }
    return state;
  }

  private appendOutput(state: TerminalProcessState, data: string): void {
    const next = `${state.outputBuffer}${data}`;
    const outputBufferLimit = Math.max(1, ENV.terminalOutputHardCapBytes);
    state.outputBuffer =
      next.length > outputBufferLimit ? next.slice(-outputBufferLimit) : next;
    state.record = {
      ...state.record,
      updatedAt: this.nowMs(),
    };
    state.emitter.emit("event", {
      type: "output",
      terminalId: state.record.id,
      data,
    } satisfies TerminalEvent);
  }

  private markExited(
    state: TerminalProcessState,
    exitCode: number | null,
    signal: string | null
  ): void {
    if (state.record.status === "exited") {
      return;
    }
    for (const disposable of state.disposables) {
      disposable.dispose();
    }
    state.disposables = [];
    state.record = {
      ...state.record,
      status: "exited",
      updatedAt: this.nowMs(),
      exitCode,
      signal,
    };
    state.emitter.emit("event", {
      type: "status",
      terminal: state.record,
    } satisfies TerminalEvent);
  }
}

async function createNodePtyProcess(
  input: Parameters<TerminalPtyFactory>[0]
): Promise<TerminalPtyProcess> {
  return await spawnTerminalPty(input);
}

function resolveTerminalProfile(settings: TerminalSettings): TerminalProfile {
  const command = settings.shellCommand.trim() || defaultShellCommand();
  const args =
    settings.shellArgs.length > 0
      ? settings.shellArgs
      : defaultShellArgs(command);
  return {
    command,
    args,
    env: settings.inheritSystemProfile
      ? toProcessEnvRecord(process.env)
      : filterEnvAllowlist(toProcessEnvRecord(process.env), ENV.allowedEnvKeys),
  };
}

function defaultShellCommand(): string {
  if (isWindows()) {
    return (
      process.env.ComSpec ||
      process.env.COMSPEC ||
      "C:\\Windows\\System32\\cmd.exe"
    );
  }
  return process.env.SHELL || "/bin/sh";
}

function defaultShellArgs(command: string): string[] {
  const name = path.basename(command).toLowerCase();
  if (isWindows() && name.includes("powershell")) {
    return ["-NoLogo"];
  }
  if (!isWindows()) {
    return ["-l"];
  }
  return [];
}

function toProcessEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}

function assertCommandAllowed(command: string, args: string[]): void {
  const policies = compileCommandPolicies(ENV.allowedTerminalCommandPolicies);
  if (!isCommandInvocationAllowed(command, args, policies)) {
    throw new ValidationError("Terminal shell command is blocked by policy", {
      module: MODULE,
      op: "create",
      details: { command, args },
    });
  }
}
