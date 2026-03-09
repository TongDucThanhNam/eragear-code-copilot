import { describe, expect, test } from "bun:test";
import type { StoredSession } from "@/shared/types/session.types";
import {
  buildRedactedSessionExport,
  SESSION_EXPORT_REDACTION_POLICY_VERSION,
  SESSION_EXPORT_SCHEMA_VERSION,
} from "./session-export.contract";

describe("buildRedactedSessionExport", () => {
  test("produces a schema-validated export without leaking runtime secrets", () => {
    const session: StoredSession = {
      id: "session-1",
      userId: "user-secret",
      name: "Incident Review",
      agentId: "agent-1",
      agentName: "Codex",
      sessionId: "acp-session-secret",
      projectId: "project-1",
      projectRoot: "/srv/customer-a",
      command: "codex",
      args: ["--dangerous"],
      env: {
        OPENAI_API_KEY: "sk-secret-value",
      },
      cwd: "/srv/customer-a",
      status: "stopped",
      createdAt: 1,
      lastActiveAt: 2,
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "my password is hunter2",
          timestamp: 3,
          toolCalls: [{ name: "bash", args: { token: "abc123" } }],
        },
      ],
      plan: {
        entries: [
          {
            content: "export raw session json",
            priority: "high",
            status: "pending",
          },
        ],
      },
      agentCapabilities: { token: "secret-capability" },
      authMethods: [{ id: "sso", name: "SSO", description: "Company SSO" }],
    };

    const exported = buildRedactedSessionExport(
      session,
      new Date("2026-03-09T00:00:00.000Z")
    );
    const serialized = JSON.stringify(exported);

    expect(exported.schemaVersion).toBe(SESSION_EXPORT_SCHEMA_VERSION);
    expect(exported.redactionPolicyVersion).toBe(
      SESSION_EXPORT_REDACTION_POLICY_VERSION
    );
    expect(exported.session.messageCount).toBe(1);
    expect(exported.redactions.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        "session.userId",
        "session.sessionId",
        "session.projectRoot",
        "session.env",
        "session.messages[0].content",
        "session.messages[0].toolCalls[0].args",
      ])
    );
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("sk-secret-value");
    expect(serialized).not.toContain("/srv/customer-a");
    expect(serialized).not.toContain("acp-session-secret");
  });
});
