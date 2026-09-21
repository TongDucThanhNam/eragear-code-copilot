import { spawn, Terminal } from "bun";

const PAUSED_OUTPUT_HARD_CAP_BYTES = 10 * 1024 * 1024;
const PAUSED_OUTPUT_OVERFLOW_MESSAGE =
  "\r\n[Eragear terminated the PTY after paused output exceeded 10 MiB.]\r\n";

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

export function spawnTerminalPty(
  input: TerminalPtySpawnInput
): TerminalPtyProcess {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<
    (event: { exitCode: number; signal?: number | string }) => void
  >();
  const decoder = new TextDecoder();
  const pendingData: string[] = [];
  let pendingDataBytes = 0;
  let paused = false;
  let outputOverflowed = false;
  let terminateForOverflow: () => void = () => undefined;
  let exitEvent: { exitCode: number; signal?: number | string } | undefined;

  const emitData = (data: string) => {
    if (!data) {
      return;
    }
    if (paused || dataListeners.size === 0) {
      const dataBytes = Buffer.byteLength(data, "utf8");
      if (pendingDataBytes + dataBytes > PAUSED_OUTPUT_HARD_CAP_BYTES) {
        if (!outputOverflowed) {
          outputOverflowed = true;
          pendingData.push(PAUSED_OUTPUT_OVERFLOW_MESSAGE);
          pendingDataBytes += Buffer.byteLength(
            PAUSED_OUTPUT_OVERFLOW_MESSAGE,
            "utf8"
          );
          terminateForOverflow();
        }
        return;
      }
      pendingData.push(data);
      pendingDataBytes += dataBytes;
      return;
    }
    for (const listener of dataListeners) {
      listener(data);
    }
  };
  const drainPendingData = () => {
    while (!paused && pendingData.length > 0 && dataListeners.size > 0) {
      const data = pendingData.shift();
      if (!data) {
        continue;
      }
      pendingDataBytes = Math.max(
        0,
        pendingDataBytes - Buffer.byteLength(data, "utf8")
      );
      for (const listener of dataListeners) {
        listener(data);
      }
    }
  };

  const terminal = new Terminal({
    name: input.name ?? "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    data(_terminal, data) {
      emitData(decoder.decode(data, { stream: true }));
    },
  });
  terminateForOverflow = () => terminal.close();
  const subprocess = spawn([input.command, ...input.args], {
    cwd: input.cwd,
    env: input.env,
    terminal,
    onExit(_subprocess, exitCode, signalCode) {
      emitData(decoder.decode());
      paused = false;
      drainPendingData();
      exitEvent = {
        exitCode: exitCode ?? 1,
        ...(signalCode ? { signal: signalCode } : {}),
      };
      for (const listener of exitListeners) {
        listener(exitEvent);
      }
      terminal.close();
    },
  });
  terminateForOverflow = () => {
    subprocess.kill();
    terminal.close();
  };
  let cols = input.cols;
  let rows = input.rows;

  return {
    pid: subprocess.pid,
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    onData(listener) {
      dataListeners.add(listener);
      drainPendingData();
      return {
        dispose() {
          dataListeners.delete(listener);
        },
      };
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (exitEvent) {
        queueMicrotask(() => {
          if (exitEvent && exitListeners.has(listener)) {
            listener(exitEvent);
          }
        });
      }
      return {
        dispose() {
          exitListeners.delete(listener);
        },
      };
    },
    write(data) {
      terminal.write(data);
    },
    resize(nextCols, nextRows) {
      cols = nextCols;
      rows = nextRows;
      terminal.resize(nextCols, nextRows);
    },
    kill(signal) {
      subprocess.kill(signal as NodeJS.Signals | undefined);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      drainPendingData();
    },
  };
}
