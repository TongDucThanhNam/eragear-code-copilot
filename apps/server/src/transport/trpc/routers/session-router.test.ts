import { describe, expect, test } from "bun:test";

function setRequiredAllowlistEnvForRouterImport(): void {
  const commandPolicy = JSON.stringify([
    { command: process.execPath, allowAnyArgs: true },
  ]);
  process.env.ALLOWED_AGENT_COMMAND_POLICIES = commandPolicy;
  process.env.ALLOWED_TERMINAL_COMMAND_POLICIES = commandPolicy;
  process.env.ALLOWED_ENV_KEYS = "PATH";
}

describe("sessionRouter", () => {
  test("keeps extracted lifecycle procedures on the flat session interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { sessionRouter } = await import("./session");
    const procedures = sessionRouter._def.procedures as Record<string, unknown>;

    expect(procedures.createSession).toBeDefined();
    expect(procedures.discoverAgentSessions).toBeDefined();
    expect(procedures.loadAgentSession).toBeDefined();
    expect(procedures.stopSession).toBeDefined();
    expect(procedures.resumeSession).toBeDefined();
    expect(procedures.lifecycle).toBeUndefined();
    expect(procedures.sessionLifecycle).toBeUndefined();
  });

  test("keeps extracted fork procedures on the flat session interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { sessionRouter } = await import("./session");
    const procedures = sessionRouter._def.procedures as Record<string, unknown>;

    expect(procedures.forkSession).toBeDefined();
    expect(procedures.listSessionForks).toBeDefined();
    expect(procedures.fork).toBeUndefined();
    expect(procedures.sessionFork).toBeUndefined();
  });

  test("keeps extracted record procedures on the flat session interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { sessionRouter } = await import("./session");
    const procedures = sessionRouter._def.procedures as Record<string, unknown>;

    expect(procedures.deleteSession).toBeDefined();
    expect(procedures.updateSessionMeta).toBeDefined();
    expect(procedures.record).toBeUndefined();
    expect(procedures.sessionRecord).toBeUndefined();
  });

  test("keeps extracted event procedures on the flat session interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { sessionRouter } = await import("./session");
    const procedures = sessionRouter._def.procedures as Record<string, unknown>;

    expect(procedures.onSessionEvents).toBeDefined();
    expect(procedures.events).toBeUndefined();
    expect(procedures.sessionEvents).toBeUndefined();
  });

  test("keeps extracted query procedures on the flat session interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { sessionRouter } = await import("./session");
    const procedures = sessionRouter._def.procedures as Record<string, unknown>;

    expect(procedures.getSessionState).toBeDefined();
    expect(procedures.getSessions).toBeDefined();
    expect(procedures.getSessionsPage).toBeDefined();
    expect(procedures.getSessionMessagesPage).toBeDefined();
    expect(procedures.getSessionMessageById).toBeDefined();
    expect(procedures.getStorageStats).toBeDefined();
    expect(procedures.compactSessionMessages).toBeDefined();
    expect(procedures.queries).toBeUndefined();
  });
});
