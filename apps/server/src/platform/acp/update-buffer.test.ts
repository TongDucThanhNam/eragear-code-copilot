import { describe, expect, test } from "bun:test";
import { SessionBuffering } from "./update-buffer";

describe("SessionBuffering", () => {
  test("aggregates chunk-heavy streams into one flushed message", () => {
    const buffer = new SessionBuffering();

    for (let i = 0; i < 1500; i += 1) {
      buffer.appendContent({ type: "text", text: "a" });
    }
    for (let i = 0; i < 750; i += 1) {
      buffer.appendReasoning({ type: "text", text: "b" });
    }

    const flushed = buffer.flush();
    expect(flushed).not.toBeNull();
    expect(flushed?.content).toBe("a".repeat(1500));
    expect(flushed?.reasoning).toBe("b".repeat(750));
    expect(flushed?.contentBlocks).toHaveLength(1500);
    expect(flushed?.reasoningBlocks).toHaveLength(750);
    expect(buffer.hasContent()).toBe(false);
    expect(buffer.flush()).toBeNull();
  });
});
