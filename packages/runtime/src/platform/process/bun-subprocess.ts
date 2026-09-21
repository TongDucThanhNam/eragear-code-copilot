import { spawn } from "bun";

const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface BunSubprocessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string>;
  maxBuffer?: number;
  timeout?: number;
  windowsHide?: boolean;
}

export interface BunSubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signalCode: NodeJS.Signals | null;
}

export class BunSubprocessError extends Error {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly signalCode: NodeJS.Signals | null;

  constructor(params: {
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    signalCode: NodeJS.Signals | null;
  }) {
    super(`${params.command} failed with exit code ${String(params.exitCode)}`);
    this.name = "BunSubprocessError";
    this.code = params.exitCode;
    this.stdout = params.stdout;
    this.stderr = params.stderr;
    this.signalCode = params.signalCode;
  }
}

export class BunSubprocessOutputLimitError extends Error {
  readonly stream: "stderr" | "stdout";
  readonly maxBuffer: number;

  constructor(stream: "stderr" | "stdout", maxBuffer: number) {
    super(`Subprocess ${stream} exceeded ${maxBuffer} bytes`);
    this.name = "BunSubprocessOutputLimitError";
    this.stream = stream;
    this.maxBuffer = maxBuffer;
  }
}

/**
 * Runs a shell-free command through Bun's native subprocess API and captures
 * bounded UTF-8 output. The returned error keeps the execFile-compatible
 * `code`, `stdout`, and `stderr` fields used by existing infrastructure.
 */
export async function runBunSubprocess(
  command: string,
  args: string[],
  options: BunSubprocessOptions = {}
): Promise<BunSubprocessResult> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error("Subprocess command is empty");
  }

  const maxBuffer = Math.max(
    1,
    Math.trunc(options.maxBuffer ?? DEFAULT_MAX_BUFFER_BYTES)
  );
  const subprocess = spawn([normalizedCommand, ...args], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: options.windowsHide ?? true,
  });
  const stopForOutputLimit = () => {
    if (!subprocess.killed && subprocess.exitCode === null) {
      subprocess.kill();
    }
  };

  let stdout = "";
  let stderr = "";
  try {
    [stdout, stderr] = await Promise.all([
      readBoundedTextStream(
        subprocess.stdout,
        "stdout",
        maxBuffer,
        stopForOutputLimit
      ),
      readBoundedTextStream(
        subprocess.stderr,
        "stderr",
        maxBuffer,
        stopForOutputLimit
      ),
    ]);
  } catch (error) {
    stopForOutputLimit();
    await subprocess.exited.catch(() => undefined);
    throw error;
  }

  const exitCode = await subprocess.exited;
  const result: BunSubprocessResult = {
    stdout,
    stderr,
    exitCode,
    signalCode: subprocess.signalCode,
  };
  if (exitCode !== 0) {
    throw new BunSubprocessError({
      command: normalizedCommand,
      exitCode,
      stdout,
      stderr,
      signalCode: subprocess.signalCode,
    });
  }
  return result;
}

async function readBoundedTextStream(
  stream: ReadableStream<Uint8Array>,
  streamName: "stderr" | "stdout",
  maxBuffer: number,
  onLimit: () => void
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      byteLength += value.byteLength;
      if (byteLength > maxBuffer) {
        onLimit();
        throw new BunSubprocessOutputLimitError(streamName, maxBuffer);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}
