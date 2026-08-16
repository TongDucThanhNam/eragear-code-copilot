import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  installProcessOutputErrorGuards,
  isProcessOutputAvailable,
  writeProcessOutputSafely,
} from "./process-output-safety.js";

class FakeProcessOutput extends EventEmitter {
  destroyed = false;
  writable = true;
}

describe("process output safety", () => {
  test("consumes a broken-pipe event and disables later writes", () => {
    const stream = new FakeProcessOutput();
    let writes = 0;

    installProcessOutputErrorGuards([stream]);
    expect(stream.listenerCount("error")).toBe(1);
    expect(() => {
      stream.emit(
        "error",
        Object.assign(new Error("broken pipe"), {
          code: "EPIPE",
        })
      );
    }).not.toThrow();

    writeProcessOutputSafely(stream, () => {
      writes += 1;
    });

    expect(isProcessOutputAvailable(stream)).toBe(false);
    expect(writes).toBe(0);
  });

  test("is idempotent and contains synchronous write failures", () => {
    const stream = new FakeProcessOutput();

    installProcessOutputErrorGuards([stream]);
    installProcessOutputErrorGuards([stream]);
    expect(stream.listenerCount("error")).toBe(1);

    expect(() => {
      writeProcessOutputSafely(stream, () => {
        throw Object.assign(new Error("stream destroyed"), {
          code: "ERR_STREAM_DESTROYED",
        });
      });
    }).not.toThrow();
    expect(isProcessOutputAvailable(stream)).toBe(false);
  });
});
