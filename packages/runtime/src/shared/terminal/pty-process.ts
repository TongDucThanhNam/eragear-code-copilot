import type * as NodePty from "node-pty";

export interface TerminalPtyDisposable {
  dispose(): void;
}

export interface TerminalPtyProcess {
  readonly pid?: number;
  readonly cols?: number;
  readonly rows?: number;
  onData(listener: (data: string) => void): TerminalPtyDisposable;
  onExit(
    listener: (event: { exitCode: number; signal?: number | string }) => void
  ): TerminalPtyDisposable;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  clear?(): void;
  pause?(): void;
  resume?(): void;
}

export interface TerminalPtySpawnInput {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  name?: string;
}

export type TerminalPtyFactory = (
  input: TerminalPtySpawnInput
) => Promise<TerminalPtyProcess> | TerminalPtyProcess;

export async function spawnTerminalPty(
  input: TerminalPtySpawnInput
): Promise<TerminalPtyProcess> {
  const pty = (await import("node-pty")) as typeof NodePty;
  return pty.spawn(input.command, input.args, {
    name: input.name ?? "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env,
  });
}
