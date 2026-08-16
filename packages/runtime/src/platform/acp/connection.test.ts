import { describe, expect, test } from "bun:test";
import { type Client, ClientSideConnection } from "@agentclientprotocol/sdk";
import {
  DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES,
  DEFAULT_ACP_NDJSON_MAX_LINE_BYTES,
} from "#runtime/config/constants";
import { createGuardedNdJsonStream } from "./connection";

const PARSE_ERROR_RE = /parse error/i;

function createInputStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function createOutputStream(): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write() {
      return Promise.resolve();
    },
  });
}

describe("createGuardedNdJsonStream", () => {
  test("emits parsed JSON objects for valid NDJSON lines", async () => {
    const stream = createGuardedNdJsonStream(
      createOutputStream(),
      createInputStream(['{"seq":1}\n{"seq":2}\n']),
      {
        maxLineBytes: 1024,
        maxBufferedBytes: 4096,
      },
      () => undefined
    );
    const reader = stream.readable.getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    const firstValue = first.value as { seq?: number } | undefined;
    expect(firstValue?.seq).toBe(1);

    const second = await reader.read();
    expect(second.done).toBe(false);
    const secondValue = second.value as { seq?: number } | undefined;
    expect(secondValue?.seq).toBe(2);

    const done = await reader.read();
    expect(done.done).toBe(true);
    expect(done.value).toBeUndefined();
  });

  test("scopes malformed NDJSON to the failed transport without erroring the stream", async () => {
    const overflowErrors: Error[] = [];
    const stream = createGuardedNdJsonStream(
      createOutputStream(),
      createInputStream(['{"ok":true}\n{invalid json}\n']),
      {
        maxLineBytes: 1024,
        maxBufferedBytes: 4096,
      },
      (error) => {
        overflowErrors.push(error);
      }
    );
    const reader = stream.readable.getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    const firstValue = first.value as { ok?: boolean } | undefined;
    expect(firstValue?.ok).toBe(true);
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(overflowErrors).toHaveLength(1);
    expect(overflowErrors[0]?.message).toMatch(PARSE_ERROR_RE);
  });

  test("closes the ACP SDK receive loop without an unhandled rejection", async () => {
    const failures: Error[] = [];
    const stream = createGuardedNdJsonStream(
      createOutputStream(),
      createInputStream(["{invalid json}\n"]),
      {
        maxLineBytes: 1024,
        maxBufferedBytes: 4096,
      },
      (error) => failures.push(error)
    );
    const connection = new ClientSideConnection(() => ({}) as Client, stream);

    await connection.closed;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toMatch(PARSE_ERROR_RE);
  });

  test("accepts image-sized ACP messages above the legacy four-megabyte failure", async () => {
    const payload = "x".repeat(4 * 1024 * 1024 + 64 * 1024);
    const stream = createGuardedNdJsonStream(
      createOutputStream(),
      createInputStream([`${JSON.stringify({ payload })}\n`]),
      {
        maxLineBytes: DEFAULT_ACP_NDJSON_MAX_LINE_BYTES,
        maxBufferedBytes: DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES,
      },
      () => undefined
    );
    const reader = stream.readable.getReader();

    const message = await reader.read();
    expect(message.done).toBe(false);
    expect(
      (message.value as unknown as { payload: string }).payload
    ).toHaveLength(payload.length);
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
