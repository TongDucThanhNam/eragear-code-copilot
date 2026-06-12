import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { ENV } from "@/config/environment";
import { NotFoundError, ValidationError } from "@/shared/errors";
import {
  compileCommandPolicies,
  filterEnvAllowlist,
  isCommandInvocationAllowed,
} from "@/shared/utils/allowlist.util";
import { createId } from "@/shared/utils/id.util";
import { isWindows } from "@/shared/utils/runtime-platform.util";
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
const OUTPUT_BUFFER_LIMIT = 1024 * 1024;

interface TerminalProcessState {
  record: TerminalRecord;
  process: ChildProcess;
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

  constructor(options?: { nowMs?: () => number }) {
    this.nowMs = options?.nowMs ?? (() => Date.now());
  }

  list(userId: string): Promise<TerminalRecord[]> {
    const terminals = [...this.terminals.values()]
      .filter((state) => state.record.userId === userId)
      .map((state) => state.record)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return Promise.resolve(terminals);
  }

  create(input: TerminalRuntimeCreateInput): Promise<TerminalRecord> {
    const profile = resolveTerminalProfile(input.settings);
    assertCommandAllowed(profile.command, profile.args);
    const terminalId = createId("terminal");
    const createdAt = this.nowMs();
    const child = spawn(profile.command, profile.args, {
      cwd: input.cwd,
      env: profile.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const record: TerminalRecord = {
      id: terminalId,
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      cwd: input.cwd,
      command: profile.command,
      args: profile.args,
      status: "running",
      createdAt,
      updatedAt: createdAt,
    };
    const state: TerminalProcessState = {
      record,
      process: child,
      emitter: new EventEmitter(),
      outputBuffer: "",
    };
    this.terminals.set(terminalId, state);

    const handleOutput = (chunk: Buffer) => {
      this.appendOutput(state, chunk.toString("utf8"));
    };
    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);
    child.on("error", (error) => {
      this.appendOutput(state, `${error.message}\n`);
      this.markExited(state, null, null);
    });
    child.on("exit", (code, signal) => {
      this.markExited(state, code, signal);
    });

    return Promise.resolve(record);
  }

  write(
    userId: string,
    terminalId: string,
    data: string
  ): Promise<TerminalRecord> {
    const state = this.getOwnedTerminal(userId, terminalId);
    if (state.record.status !== "running" || !state.process.stdin?.writable) {
      throw new ValidationError("Terminal is not writable", {
        module: MODULE,
        op: "write",
        details: { terminalId },
      });
    }
    state.process.stdin.write(data);
    return Promise.resolve(state.record);
  }

  kill(userId: string, terminalId: string): Promise<TerminalRecord> {
    const state = this.getOwnedTerminal(userId, terminalId);
    if (state.record.status === "running") {
      state.process.kill();
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
    state.outputBuffer =
      next.length > OUTPUT_BUFFER_LIMIT
        ? next.slice(-OUTPUT_BUFFER_LIMIT)
        : next;
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
    signal: NodeJS.Signals | null
  ): void {
    if (state.record.status === "exited") {
      return;
    }
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
    return process.env.ComSpec || "powershell.exe";
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
