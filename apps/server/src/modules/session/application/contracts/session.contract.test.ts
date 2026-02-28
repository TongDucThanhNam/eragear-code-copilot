import { describe, expect, test } from "bun:test";
import {
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
} from "@/config/constants";
import {
  CreateSessionInputSchema,
  DiscoverAgentSessionsInputSchema,
  LoadAgentSessionInputSchema,
  ListSessionsInputSchema,
  SessionListPageInputSchema,
  SessionMessagesPageInputSchema,
} from "./session.contract";

describe("session contract page limits", () => {
  test("enforces session list hard max limit", () => {
    expect(
      ListSessionsInputSchema.parse({
        limit: HARD_MAX_SESSION_LIST_PAGE_LIMIT,
        offset: 0,
      })
    ).toEqual({
      limit: HARD_MAX_SESSION_LIST_PAGE_LIMIT,
      offset: 0,
    });
    expect(() =>
      ListSessionsInputSchema.parse({
        limit: HARD_MAX_SESSION_LIST_PAGE_LIMIT + 1,
        offset: 0,
      })
    ).toThrow();
  });

  test("enforces session messages hard max limit", () => {
    expect(
      SessionMessagesPageInputSchema.parse({
        chatId: "chat-1",
        limit: HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
      })
    ).toEqual({
      chatId: "chat-1",
      limit: HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
    });
    expect(() =>
      SessionMessagesPageInputSchema.parse({
        chatId: "chat-1",
        limit: HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT + 1,
      })
    ).toThrow();
  });

  test("accepts explicit session message pagination direction", () => {
    expect(
      SessionMessagesPageInputSchema.parse({
        chatId: "chat-1",
        direction: "backward",
      })
    ).toEqual({
      chatId: "chat-1",
      direction: "backward",
    });
    expect(() =>
      SessionMessagesPageInputSchema.parse({
        chatId: "chat-1",
        direction: "sideways",
      })
    ).toThrow();
  });

  test("enforces session list page hard max limit", () => {
    expect(
      SessionListPageInputSchema.parse({
        limit: HARD_MAX_SESSION_LIST_PAGE_LIMIT,
      })
    ).toEqual({
      limit: HARD_MAX_SESSION_LIST_PAGE_LIMIT,
    });
    expect(() =>
      SessionListPageInputSchema.parse({
        limit: HARD_MAX_SESSION_LIST_PAGE_LIMIT + 1,
      })
    ).toThrow();
  });

  test("accepts create session input with optional agentId only", () => {
    expect(
      CreateSessionInputSchema.parse({
        projectId: "project-1",
        agentId: "agent-1",
      })
    ).toEqual({
      projectId: "project-1",
      agentId: "agent-1",
    });
  });

  test("rejects legacy create session command overrides", () => {
    expect(() =>
      CreateSessionInputSchema.parse({
        projectId: "project-1",
        command: "/bin/bash",
        args: ["-lc", "echo hello"],
        env: { MODE: "unsafe" },
      })
    ).toThrow();
  });

  test("accepts discover-agent sessions input with optional cursor", () => {
    expect(
      DiscoverAgentSessionsInputSchema.parse({
        projectId: "project-1",
        agentId: "agent-1",
        cursor: "cursor-1",
      })
    ).toEqual({
      projectId: "project-1",
      agentId: "agent-1",
      cursor: "cursor-1",
    });
  });

  test("rejects discover-agent sessions input with unknown fields", () => {
    expect(() =>
      DiscoverAgentSessionsInputSchema.parse({
        projectId: "project-1",
        command: "codex-acp",
      })
    ).toThrow();
  });

  test("accepts load-agent session input", () => {
    expect(
      LoadAgentSessionInputSchema.parse({
        projectId: "project-1",
        sessionId: "sess-abc123",
        agentId: "agent-1",
      })
    ).toEqual({
      projectId: "project-1",
      sessionId: "sess-abc123",
      agentId: "agent-1",
    });
  });

  test("rejects load-agent session input with unknown fields", () => {
    expect(() =>
      LoadAgentSessionInputSchema.parse({
        projectId: "project-1",
        sessionId: "sess-abc123",
        command: "codex-acp",
      })
    ).toThrow();
  });
});
