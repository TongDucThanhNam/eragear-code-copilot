import { describe, expect, test } from "bun:test";
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

  test("treats malformed NDJSON as fatal protocol error", async () => {
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
    await expect(reader.read()).rejects.toThrow(PARSE_ERROR_RE);
    expect(overflowErrors).toHaveLength(1);
    expect(overflowErrors[0]?.message).toMatch(PARSE_ERROR_RE);
  });
});
