import { describe, expect, test } from "bun:test";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { LogEntry, LogQuery } from "@/shared/types/log.types";
import { Logger } from "./logger";
import { setRuntimeLogLevel } from "./runtime-log-level";

function createLogStoreStub() {
  const entries: LogEntry[] = [];
  const store: LogStorePort = {
    append(entry) {
      entries.push(entry);
    },
    list(_query?: LogQuery) {
      return {
        entries: [...entries],
        stats: {
          total: entries.length,
          levels: {
            debug: entries.filter((entry) => entry.level === "debug").length,
            info: entries.filter((entry) => entry.level === "info").length,
            warn: entries.filter((entry) => entry.level === "warn").length,
            error: entries.filter((entry) => entry.level === "error").length,
          },
        },
      };
    },
    subscribe() {
      return () => undefined;
    },
    query(_query?: LogQuery) {
      return Promise.resolve(store.list(_query));
    },
    flush() {
      return Promise.resolve();
    },
  };
  return { store, entries };
}

describe("Logger console normalization", () => {
  test("persists ACP structured console payload as normalized acp entry", () => {
    setRuntimeLogLevel("debug");
    const { store, entries } = createLogStoreStub();
    const logger = new Logger(store);

    logger.logArgs(
      "info",
      "log",
      [
        JSON.stringify({
          ts: "2026-02-19T22:11:00.000Z",
          level: "debug",
          tag: "Debug",
          message: "ACP session update",
          context: {
            chatId: "chat-1",
            chunkCount: 3,
          },
        }),
      ],
      { source: "console" }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("acp");
    expect(entries[0]?.message).toBe("ACP session update");
    expect(entries[0]?.chatId).toBe("chat-1");
    expect(entries[0]?.meta?.structuredTag).toBe("Debug");
    expect(entries[0]?.meta?.chunkCount).toBe(3);
  });

  test("persists non-ACP informational console payloads in the store", () => {
    setRuntimeLogLevel("debug");
    const { store, entries } = createLogStoreStub();
    const logger = new Logger(store);

    logger.logArgs(
      "info",
      "log",
      [
        JSON.stringify({
          level: "info",
          tag: "Storage",
          message: "SQLite worker started",
        }),
      ],
      { source: "console" }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("SQLite worker started");
    expect(entries[0]?.meta?.structuredTag).toBe("Storage");
  });

  test("keeps warn/error console entries for diagnostics", () => {
    setRuntimeLogLevel("debug");
    const { store, entries } = createLogStoreStub();
    const logger = new Logger(store);

    logger.logArgs("warn", "warn", ["Database queue saturated"], {
      source: "console",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.source).toBe("console");
    expect(entries[0]?.message).toContain("Database queue saturated");
  });

  test("tags ACP JSON-RPC console errors as acp source", () => {
    setRuntimeLogLevel("debug");
    const { store, entries } = createLogStoreStub();
    const logger = new Logger(store);

    logger.logArgs(
      "error",
      "error",
      [
        "Error handling request { jsonrpc: '2.0', method: 'fs/read_text_file', params: { sessionId: 'chat-1' } } { code: -32602, message: 'Invalid params: File not found' }",
      ],
      { source: "console" }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.source).toBe("acp");
    expect(entries[0]?.message).toContain("jsonrpc");
  });

  test("keeps plain ACP console text when payload is non-json", () => {
    setRuntimeLogLevel("debug");
    const { store, entries } = createLogStoreStub();
    const logger = new Logger(store);

    logger.logArgs("debug", "debug", ["[Debug] ACP session update"], {
      source: "console",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("acp");
    expect(entries[0]?.message).toContain("ACP session update");
  });
});
