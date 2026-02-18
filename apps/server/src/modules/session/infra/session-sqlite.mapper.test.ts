import { describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import type { StoredSession } from "@/modules/session/domain/stored-session.types";
import {
  type SessionListRow,
  SessionSqliteMapper,
} from "./session-sqlite.mapper";

const INVALID_STATUS_RE = /invalid status/i;

class ExposedSessionSqliteMapper extends SessionSqliteMapper {
  mapListRowForTest(row: SessionListRow): StoredSession {
    return this.mapSessionListRow(row);
  }
}

function createSessionListRow(): SessionListRow {
  return {
    id: "session-1",
    userId: "user-1",
    name: "Session 1",
    sessionId: "acp-session-1",
    projectId: "project-1",
    projectRoot: "/tmp/project",
    loadSessionSupported: 1,
    useUnstableResume: 0,
    supportsModelSwitching: 1,
    agentInfoJson: JSON.stringify({
      name: "codex",
      title: "Codex",
      version: "1.0.0",
    }),
    status: "running",
    pinned: 1,
    archived: 0,
    createdAt: 1,
    lastActiveAt: 2,
    modeId: "default",
    modelId: "model-1",
    messageCount: 2,
    planJson: JSON.stringify({
      entries: [
        {
          content: "step",
          priority: "high",
          status: "pending",
        },
      ],
    }),
    agentCapabilitiesJson: JSON.stringify({ image: true, audio: false }),
    authMethodsJson: JSON.stringify([
      { name: "api key", id: "api-key", description: "api key auth" },
    ]),
  };
}

describe("SessionSqliteMapper list-row decoding cache", () => {
  test("avoids repeated JSON.parse for identical list payloads", () => {
    const mapper = new ExposedSessionSqliteMapper();
    const row = createSessionListRow();

    const originalParse = JSON.parse;
    let parseCalls = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parseCalls += 1;
      return originalParse(...args);
    }) as typeof JSON.parse;

    try {
      const first = mapper.mapListRowForTest(row);
      const callsAfterFirstMap = parseCalls;
      expect(callsAfterFirstMap).toBeGreaterThanOrEqual(4);

      const firstCapabilities = first.agentCapabilities as
        | Record<string, unknown>
        | undefined;
      if (firstCapabilities) {
        firstCapabilities.image = false;
      }
      if (first.plan?.entries[0]) {
        first.plan.entries[0].status = "completed";
      }

      const second = mapper.mapListRowForTest(row);
      expect(parseCalls).toBe(callsAfterFirstMap);
      expect((second.agentCapabilities as Record<string, unknown>).image).toBe(
        true
      );
      expect(second.plan?.entries[0]?.status).toBe("pending");
    } finally {
      JSON.parse = originalParse;
    }
  });
});

describe("SessionSqliteMapper message payload normalization", () => {
  test("marks oversized content as compacted instead of throwing", () => {
    const mapper = new SessionSqliteMapper();
    const oversizedContent = "x".repeat(ENV.messageContentMaxBytes + 1);

    const insert = mapper.toMessageInsert("session-1", {
      id: "message-1",
      role: "assistant",
      content: oversizedContent,
      timestamp: Date.now(),
    });

    expect(insert.retainedPayload).toBe(0);
    expect(insert.content.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(insert.content, "utf8")).toBeLessThanOrEqual(
      ENV.messageContentMaxBytes
    );
  });
});

describe("SessionSqliteMapper row invariants", () => {
  test("throws when session row contains invalid status", () => {
    const mapper = new ExposedSessionSqliteMapper();
    const row = createSessionListRow();
    const invalidRow = {
      ...row,
      status: "unknown",
    } as SessionListRow;

    expect(() => mapper.mapListRowForTest(invalidRow)).toThrow(
      INVALID_STATUS_RE
    );
  });
});
