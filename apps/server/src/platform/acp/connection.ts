/**
 * ACP Connection Adapter
 *
 * Implements transport setup between server and ACP agents over stdio.
 * Adds stream safety guards and stderr observability for production runtime.
 *
 * @module platform/acp/connection
 */

import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { Client, Stream } from "@agentclientprotocol/sdk";
import { ClientSideConnection } from "@agentclientprotocol/sdk";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { toError } from "@/shared/utils/error.util";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";

const logger = createLogger("Debug");

const STDERR_LOG_INTERVAL_MS = 5000;
const STDERR_SAMPLE_CHAR_LIMIT = 2000;
const STDERR_SAMPLE_LINE_LIMIT = 12;
const PARSE_ERROR_SAMPLE_LIMIT = 256;

interface NdJsonGuardPolicy {
  maxLineBytes: number;
  maxBufferedBytes: number;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

function createBufferOverflowError(
  reason: "line_limit" | "buffer_limit",
  currentBytes: number,
  limitBytes: number
): Error {
  return new Error(
    `ACP NDJSON ${reason} exceeded (${currentBytes} > ${limitBytes} bytes)`
  );
}

function terminateAgentAfterTransportFailure(
  proc: ChildProcess,
  error: Error
): void {
  logger.error("ACP stream guard triggered, terminating process", error, {
    pid: proc.pid,
  });
  terminateProcessGracefully(proc, {
    forceWindowsTreeTermination: true,
  })
    .then((result) => {
      if (!result.exited) {
        logger.warn(
          "ACP process did not exit after guard-triggered termination",
          {
            pid: proc.pid,
            signalSent: result.signalSent,
          }
        );
      }
    })
    .catch((terminationError) => {
      logger.error(
        "Failed to terminate ACP process after stream guard trigger",
        toError(
          terminationError,
          "Failed to terminate ACP process after stream guard trigger"
        ),
        { pid: proc.pid }
      );
    });
}

function assertNdJsonLimit(
  reason: "line_limit" | "buffer_limit",
  currentBytes: number,
  limitBytes: number
): void {
  if (currentBytes > limitBytes) {
    throw createBufferOverflowError(reason, currentBytes, limitBytes);
  }
}

function decodeChunkIntoLines(
  decoder: TextDecoder,
  currentContent: string,
  chunk: Uint8Array
): { lines: string[]; remainder: string } {
  const nextContent = `${currentContent}${decoder.decode(chunk, { stream: true })}`;
  const lines = nextContent.split("\n");
  return {
    lines,
    remainder: lines.pop() || "",
  };
}

function enqueueNdJsonLines(
  lines: string[],
  policy: NdJsonGuardPolicy,
  controller: ReadableStreamDefaultController<unknown>
): void {
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    assertNdJsonLimit("line_limit", lineBytes, policy.maxLineBytes);

    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    try {
      controller.enqueue(JSON.parse(trimmedLine));
    } catch (error) {
      logger.warn("Failed to parse ACP JSON line; dropping line", {
        lineSample: truncate(trimmedLine, PARSE_ERROR_SAMPLE_LIMIT),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function appendStderrSample(input: {
  chunk: Buffer;
  sampleChars: number;
  sampleTruncated: boolean;
  samples: string[];
}): { sampleChars: number; sampleTruncated: boolean } {
  if (input.sampleChars >= STDERR_SAMPLE_CHAR_LIMIT) {
    return {
      sampleChars: input.sampleChars,
      sampleTruncated: true,
    };
  }

  let nextSampleChars = input.sampleChars;
  let nextSampleTruncated = input.sampleTruncated;
  const lines = input.chunk.toString("utf8").split(/\r?\n/g);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (input.samples.length >= STDERR_SAMPLE_LINE_LIMIT) {
      nextSampleTruncated = true;
      break;
    }

    const remainingChars = STDERR_SAMPLE_CHAR_LIMIT - nextSampleChars;
    if (remainingChars <= 0) {
      nextSampleTruncated = true;
      break;
    }

    const lineSample = trimmed.slice(0, remainingChars);
    input.samples.push(lineSample);
    nextSampleChars += lineSample.length;

    if (lineSample.length < trimmed.length) {
      nextSampleTruncated = true;
      break;
    }
  }

  return {
    sampleChars: nextSampleChars,
    sampleTruncated: nextSampleTruncated,
  };
}

function createGuardedNdJsonStream(
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
  policy: NdJsonGuardPolicy,
  onOverflow: (error: Error) => void
): Stream {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      let content = "";
      const reader = input.getReader();
      let didError = false;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (!value || value.byteLength === 0) {
            continue;
          }

          assertNdJsonLimit(
            "buffer_limit",
            value.byteLength,
            policy.maxBufferedBytes
          );
          const decoded = decodeChunkIntoLines(textDecoder, content, value);
          content = decoded.remainder;
          const bufferedBytes = Buffer.byteLength(content, "utf8");
          assertNdJsonLimit(
            "buffer_limit",
            bufferedBytes,
            policy.maxBufferedBytes
          );
          assertNdJsonLimit("line_limit", bufferedBytes, policy.maxLineBytes);
          enqueueNdJsonLines(decoded.lines, policy, controller);
        }
      } catch (error) {
        const overflowError = toError(error, "ACP NDJSON stream guard failure");
        onOverflow(overflowError);
        didError = true;
        controller.error(overflowError);
      } finally {
        reader.releaseLock();
        if (!didError) {
          try {
            controller.close();
          } catch (error) {
            logger.warn("Failed to close ACP guarded NDJSON stream", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    },
  });

  let outputWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  const getOutputWriter = (): WritableStreamDefaultWriter<Uint8Array> => {
    if (!outputWriter) {
      outputWriter = output.getWriter();
    }
    return outputWriter;
  };
  const releaseOutputWriter = () => {
    if (!outputWriter) {
      return;
    }
    outputWriter.releaseLock();
    outputWriter = null;
  };

  const writable = new WritableStream({
    start() {
      outputWriter = output.getWriter();
    },
    async write(message) {
      const content = `${JSON.stringify(message)}\n`;
      await getOutputWriter().write(textEncoder.encode(content));
    },
    async close() {
      const writer = getOutputWriter();
      try {
        await writer.close();
      } finally {
        releaseOutputWriter();
      }
    },
    async abort(reason) {
      const writer = getOutputWriter();
      try {
        await writer.abort(reason);
      } finally {
        releaseOutputWriter();
      }
    },
  });

  return { readable, writable };
}

function attachRateLimitedStderrLogger(proc: ChildProcess): void {
  if (!proc.stderr) {
    return;
  }

  const maxTotalBytes = Math.max(1, Math.trunc(ENV.acpStderrMaxTotalBytes));
  let chunkCount = 0;
  let totalBytes = 0;
  let lifetimeTotalBytes = 0;
  let sampleChars = 0;
  let sampleTruncated = false;
  const samples: string[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let cleaned = false;

  const resetWindow = () => {
    chunkCount = 0;
    totalBytes = 0;
    sampleChars = 0;
    sampleTruncated = false;
    samples.length = 0;
  };

  const flush = (
    reason: "interval" | "exit" | "error" | "stderr_close" | "stderr_cap"
  ) => {
    if (chunkCount === 0) {
      return;
    }

    logger.warn("ACP process stderr summary", {
      pid: proc.pid,
      reason,
      chunkCount,
      totalBytes,
      lifetimeTotalBytes,
      sample: samples.join("\n"),
      sampleTruncated,
    });
    resetWindow();
  };

  const ensureFlushTimer = () => {
    if (flushTimer) {
      return;
    }
    flushTimer = setInterval(() => {
      flush("interval");
    }, STDERR_LOG_INTERVAL_MS);
    flushTimer.unref?.();
  };

  const cleanup = (
    reason: "exit" | "error" | "stderr_close" | "stderr_cap"
  ) => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flush(reason);
  };

  proc.stderr.on("data", (chunk: Buffer) => {
    if (chunk.byteLength === 0) {
      return;
    }

    chunkCount += 1;
    totalBytes += chunk.byteLength;
    lifetimeTotalBytes += chunk.byteLength;

    if (lifetimeTotalBytes > maxTotalBytes) {
      sampleTruncated = true;
      cleanup("stderr_cap");
      terminateAgentAfterTransportFailure(
        proc,
        new Error(
          `ACP process stderr exceeded configured cap (${lifetimeTotalBytes} > ${maxTotalBytes} bytes)`
        )
      );
      return;
    }

    const samplingResult = appendStderrSample({
      chunk,
      sampleChars,
      sampleTruncated,
      samples,
    });
    sampleChars = samplingResult.sampleChars;
    sampleTruncated = samplingResult.sampleTruncated;

    ensureFlushTimer();
  });

  proc.on("exit", () => cleanup("exit"));
  proc.on("error", () => cleanup("error"));
  proc.stderr.on("close", () => cleanup("stderr_close"));
}

/**
 * Creates an ACP connection adapter for a child process.
 *
 * @param proc - The child process to communicate with (must have stdin and stdout)
 * @param handlers - Client handlers for incoming ACP messages and lifecycle events
 * @returns ClientSideConnection instance for ACP communication
 * @throws Error if stdin or stdout are not available
 */
export function createAcpConnectionAdapter(
  proc: ChildProcess,
  handlers: Client
) {
  if (!(proc.stdin && proc.stdout)) {
    throw new Error("Child process stdin/stdout are not available");
  }

  attachRateLimitedStderrLogger(proc);

  proc.stdout.on("error", (error) => {
    logger.error("ACP stdout error", error);
  });
  proc.on("exit", (code, signal) => {
    logger.warn("ACP process exit", {
      pid: proc.pid,
      code,
      signal: signal ?? undefined,
    });
  });
  proc.on("error", (error) => {
    logger.error("ACP process error", error, { pid: proc.pid });
  });

  const output = Writable.toWeb(
    proc.stdin
  ) as unknown as WritableStream<Uint8Array>;
  const input = Readable.toWeb(
    proc.stdout
  ) as unknown as ReadableStream<Uint8Array>;

  const stream = createGuardedNdJsonStream(
    output,
    input,
    {
      maxLineBytes: ENV.acpNdjsonMaxLineBytes,
      maxBufferedBytes: ENV.acpNdjsonMaxBufferedBytes,
    },
    (error) => terminateAgentAfterTransportFailure(proc, error)
  );

  return new ClientSideConnection(() => handlers, stream);
}
