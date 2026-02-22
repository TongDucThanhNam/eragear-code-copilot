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

  test("caps oversized text streams with truncation marker", () => {
    const buffer = new SessionBuffering();
    const chunk = "x".repeat(700_000);

    buffer.appendContent({ type: "text", text: chunk });
    buffer.appendContent({ type: "text", text: chunk });

    const flushed = buffer.flush();
    expect(flushed).not.toBeNull();
    expect(flushed?.content.length).toBeLessThanOrEqual(1024 * 1024);
    expect(flushed?.content.startsWith("[...truncated...]\n")).toBe(true);
    expect(flushed?.contentBlocks.length).toBe(2);
  });

  test("caps retained content blocks to prevent unbounded growth", () => {
    const buffer = new SessionBuffering();
    for (let i = 0; i < 3000; i += 1) {
      buffer.appendContent({ type: "text", text: "a" });
    }

    const flushed = buffer.flush();
    expect(flushed).not.toBeNull();
    expect(flushed?.contentBlocks.length).toBeLessThanOrEqual(2048);
  });
});
