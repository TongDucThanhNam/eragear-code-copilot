import { describe, expect, test } from "bun:test";
import type { LogEntry } from "@/shared/types/log.types";
import { isAcpRelatedLogEntry, matchesLogQuery } from "./log-query.util";

const baseEntry: LogEntry = {
  id: "log-1",
  timestamp: Date.now(),
  level: "error",
  message: "Error handling request",
};

describe("isAcpRelatedLogEntry", () => {
  test("matches source-tagged ACP logs", () => {
    expect(
      isAcpRelatedLogEntry({
        ...baseEntry,
        source: "acp",
        message: "anything",
      })
    ).toBe(true);
  });

  test("matches ACP JSON-RPC errors even when source is console", () => {
    const entry: LogEntry = {
      ...baseEntry,
      source: "console",
      message:
        "Error handling request { jsonrpc: '2.0', method: 'fs/read_text_file', params: { sessionId: 'chat-1' } } { code: -32602 }",
    };
    expect(isAcpRelatedLogEntry(entry)).toBe(true);
    expect(matchesLogQuery(entry, { acpOnly: true })).toBe(true);
  });

  test("does not match unrelated console logs", () => {
    const entry: LogEntry = {
      ...baseEntry,
      source: "console",
      message: "Database queue saturated",
    };
    expect(isAcpRelatedLogEntry(entry)).toBe(false);
    expect(matchesLogQuery(entry, { acpOnly: true })).toBe(false);
  });

  test("matches search terms inside metadata", () => {
    const entry: LogEntry = {
      ...baseEntry,
      level: "info",
      message: "Background worker ready",
      meta: { queue: "sqlite-writes" },
    };

    expect(matchesLogQuery(entry, { search: "sqlite-writes" })).toBe(true);
  });
});
