import { expect, test } from "bun:test";
import {
  getLocalAdeOperationSummary,
  getLocalAdeRunActions,
  getLocalAdeWorkspaceFocus,
  getLocalAdeWorkflowLanes,
} from "./local-ade-operations";

test("summarizes actionable local ADE workflow state", () => {
  const summary = getLocalAdeOperationSummary({
    diagnostics: {
      health: {
        state: "ready",
      },
    },
    snapshot: {
      sessions: {
        active: [{ id: "chat-1" }],
      },
      providers: [
        { id: "opencode", status: "ready", readiness: "ready", cliStatus: "ok" },
        {
          id: "missing",
          status: "missing-config",
          readiness: "missing-config",
          cliStatus: "missing",
        },
      ],
      mcp: {
        servers: [
          {
            enabled: true,
            health: "available",
            protocol: { status: "initialized" },
          },
          {
            enabled: true,
            health: "unavailable",
            protocol: { status: "failed" },
          },
          {
            enabled: false,
            health: "disabled",
            protocol: { status: "not-run" },
          },
        ],
      },
      changeTrust: {
        isGitRepo: true,
        changedFiles: ["README.md", "apps/web/src/app.tsx"],
      },
      checkpoints: {
        items: [{ id: "checkpoint-1" }],
      },
      subagents: [
        { name: "feature-planner", enabled: true },
        { name: "code-reviewer", enabled: true },
      ],
    },
  });

  expect(summary.runtimeState).toBe("ready");
  expect(summary.activeSessions).toBe(1);
  expect(summary.providers.ready).toBe(1);
  expect(summary.providers.probeTargets).toEqual(["opencode"]);
  expect(summary.mcp.initialized).toBe(1);
  expect(summary.mcp.failed).toBe(1);
  expect(summary.mcp.totalEnabled).toBe(2);
  expect(summary.checkpoint.canCreate).toBe(true);
  expect(summary.checkpoint.changedFiles).toBe(2);
  expect(summary.subagentCommand).toBe("/agent-code-reviewer");
});

test("keeps operation summary conservative when snapshot is unavailable", () => {
  const summary = getLocalAdeOperationSummary({
    diagnostics: null,
    snapshot: null,
  });

  expect(summary.runtimeState).toBe("unknown");
  expect(summary.providers.total).toBe(0);
  expect(summary.providers.probeTargets).toEqual([]);
  expect(summary.mcp.totalEnabled).toBe(0);
  expect(summary.checkpoint.canCreate).toBe(false);
  expect(summary.subagentCommand).toBeNull();
});

test("builds workflow readiness lanes for the ADE first screen", () => {
  const lanes = getLocalAdeWorkflowLanes({
    diagnostics: {
      health: {
        state: "ready",
      },
    },
    snapshot: {
      sessions: {
        active: [],
      },
      providers: [
        { id: "opencode", status: "ready", readiness: "ready", cliStatus: "ok" },
      ],
      mcp: {
        servers: [
          {
            enabled: true,
            health: "available",
            protocol: { status: "initialized" },
          },
        ],
      },
      changeTrust: {
        isGitRepo: true,
        changedFiles: ["apps/web/src/app.tsx"],
      },
      checkpoints: {
        items: [{ id: "checkpoint-1" }, { id: "checkpoint-2" }],
      },
      subagents: [{ name: "code-reviewer", enabled: true }],
      projectIndex: {
        indexedAt: "2026-06-11T01:58:00.000Z",
        indexedFiles: 42,
        symbols: [{ name: "LocalAdeControlCenter" }],
        tasks: [{ marker: "TODO" }, { marker: "FIXME" }],
      },
    },
  });

  expect(lanes.map((lane) => lane.id)).toEqual([
    "session",
    "provider",
    "mcp",
    "checkpoint",
    "context",
    "subagent",
  ]);
  expect(lanes.find((lane) => lane.id === "session")?.tone).toBe("idle");
  expect(lanes.find((lane) => lane.id === "provider")?.value).toBe("1/1 ready");
  expect(lanes.find((lane) => lane.id === "mcp")?.tone).toBe("ready");
  expect(lanes.find((lane) => lane.id === "checkpoint")?.tone).toBe("warning");
  expect(lanes.find((lane) => lane.id === "context")?.detail).toBe(
    "3 indexed code/task signals"
  );
  expect(lanes.find((lane) => lane.id === "subagent")?.value).toBe(
    "/agent-code-reviewer"
  );
});

test("builds first-screen run actions from ready workflow state", () => {
  const actions = getLocalAdeRunActions({
    diagnostics: {
      health: {
        state: "ready",
      },
    },
    snapshot: {
      sessions: {
        active: [
          {
            id: "chat-active-123456",
            chatStatus: "running",
            agentName: "OpenCode",
          },
        ],
      },
      providers: [
        { id: "opencode", status: "ready", readiness: "ready", cliStatus: "ok" },
      ],
      mcp: {
        servers: [
          {
            enabled: true,
            health: "available",
            trustStatus: "trusted",
            protocol: { status: "initialized" },
            tools: [{ name: "read_repo" }],
          },
        ],
      },
      changeTrust: {
        isGitRepo: true,
        changedFiles: ["README.md"],
      },
      checkpoints: {
        items: [{ id: "checkpoint-1" }],
      },
      subagents: [{ name: "code-reviewer", enabled: true }],
      projectIndex: {
        indexedAt: "2026-06-11T01:58:00.000Z",
        indexedFiles: 42,
      },
      projectMemory: {
        sources: [{ enabled: true, exists: true }],
      },
    },
  });

  expect(actions.map((action) => action.id)).toEqual([
    "session",
    "provider",
    "mcp",
    "checkpoint",
    "index",
    "memory",
    "subagent",
  ]);
  expect(actions.find((action) => action.id === "session")?.action).toBe(
    "inspect-section"
  );
  expect(actions.find((action) => action.id === "provider")?.action).toBe(
    "inspect-section"
  );
  expect(actions.find((action) => action.id === "mcp")?.label).toBe(
    "Run MCP Tool"
  );
  expect(actions.find((action) => action.id === "checkpoint")?.action).toBe(
    "create-checkpoint"
  );
  expect(actions.find((action) => action.id === "index")?.command).toBe(
    "/index <query>"
  );
  expect(actions.find((action) => action.id === "memory")?.command).toBe(
    "/memory <request>"
  );
  expect(actions.find((action) => action.id === "subagent")?.command).toBe(
    "/agent-code-reviewer"
  );
});

test("surfaces MCP agent routing blockers in first-screen helpers", () => {
  const snapshot = {
    sessions: {
      active: [],
    },
    providers: [],
    mcp: {
      agentRouting: {
        status: "attention",
        injectableCount: 0,
        conditionalCount: 1,
        blockedCount: 1,
        skippedCount: 0,
        routes: [
          {
            status: "blocked",
            serverName: "Untrusted MCP",
            reason: "Server must be trusted before agent session injection.",
          },
        ],
      },
      servers: [
        {
          enabled: true,
          health: "available",
          trustStatus: "trusted",
          protocol: { status: "initialized" },
          tools: [{ name: "read_repo" }],
        },
        {
          enabled: true,
          health: "available",
          trustStatus: "untrusted",
          protocol: { status: "initialized" },
          tools: [{ name: "unsafe_repo" }],
        },
      ],
    },
    changeTrust: {
      isGitRepo: true,
      changedFiles: [],
    },
    checkpoints: {
      items: [],
    },
    subagents: [],
  };

  const summary = getLocalAdeOperationSummary({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });
  const focus = getLocalAdeWorkspaceFocus({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });
  const actions = getLocalAdeRunActions({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });
  const lanes = getLocalAdeWorkflowLanes({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });

  expect(summary.mcp.agentBlocked).toBe(1);
  expect(focus.items.find((item) => item.id === "mcp")?.detail).toBe(
    "1 agent route(s) blocked"
  );
  expect(actions.find((action) => action.id === "mcp")?.detail).toBe(
    "1 agent route(s) need trust or config"
  );
  expect(lanes.find((lane) => lane.id === "mcp")?.detail).toBe(
    "1 agent route(s) blocked"
  );
});

test("surfaces brokered MCP agent calls in first-screen helpers", () => {
  const snapshot = {
    sessions: {
      active: [],
    },
    providers: [],
    mcp: {
      agentRouting: {
        status: "ready",
        injectableCount: 1,
        conditionalCount: 1,
        blockedCount: 0,
        skippedCount: 0,
        routes: [
          {
            status: "injectable",
            serverName: "Brokered MCP",
            reason: "Ready for ACP session MCP broker injection.",
            brokerMode: "stdio-proxy",
            agentInvocationCount: 1,
          },
          {
            status: "conditional",
            serverName: "Remote MCP",
            reason: "Requires SSE capability.",
            brokerMode: "native-agent-transport",
            agentInvocationCount: 0,
          },
        ],
        agentInvocationHistory: [
          {
            status: "success",
            method: "tools/call",
            target: "read_repo",
          },
        ],
      },
      servers: [
        {
          enabled: true,
          health: "available",
          trustStatus: "trusted",
          protocol: { status: "initialized" },
          tools: [{ name: "read_repo" }],
        },
      ],
    },
    changeTrust: {
      isGitRepo: true,
      changedFiles: [],
    },
    checkpoints: {
      items: [],
    },
    subagents: [],
  };

  const summary = getLocalAdeOperationSummary({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });
  const focus = getLocalAdeWorkspaceFocus({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });
  const actions = getLocalAdeRunActions({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });
  const lanes = getLocalAdeWorkflowLanes({
    diagnostics: { health: { state: "ready" } },
    snapshot,
  });

  expect(summary.mcp.agentBrokered).toBe(1);
  expect(summary.mcp.agentBrokerCalls).toBe(1);
  expect(focus.items.find((item) => item.id === "mcp")?.detail).toBe(
    "1 brokered / 1 conditional agent route(s)"
  );
  expect(actions.find((action) => action.id === "mcp")?.detail).toBe(
    "1 brokered agent MCP call(s)"
  );
  expect(lanes.find((lane) => lane.id === "mcp")?.detail).toBe(
    "1 brokered / 1 conditional agent route(s)"
  );
});

test("keeps run actions real when workflow surfaces need setup", () => {
  const actions = getLocalAdeRunActions({
    diagnostics: {
      health: {
        state: "degraded",
      },
    },
    snapshot: {
      sessions: {
        active: [],
      },
      providers: [],
      mcp: {
        servers: [],
      },
      changeTrust: {
        isGitRepo: false,
        changedFiles: [],
      },
      checkpoints: {
        items: [],
      },
      subagents: [],
      projectIndex: {
        indexedAt: null,
        indexedFiles: 0,
      },
      projectMemory: {
        sources: [],
      },
    },
  });

  expect(actions.find((action) => action.id === "session")?.enabled).toBe(
    false
  );
  expect(actions.find((action) => action.id === "provider")?.tone).toBe(
    "blocked"
  );
  expect(actions.find((action) => action.id === "mcp")?.action).toBe(
    "inspect-section"
  );
  expect(actions.find((action) => action.id === "checkpoint")?.action).toBe(
    "inspect-section"
  );
  expect(actions.find((action) => action.id === "index")?.action).toBe(
    "refresh-index"
  );
  expect(actions.find((action) => action.id === "memory")?.targetSection).toBe(
    "local-ade-change-trust"
  );
  expect(actions.find((action) => action.id === "memory")?.command).toBeUndefined();
  expect(actions.find((action) => action.id === "subagent")?.targetSection).toBe(
    "local-ade-capabilities"
  );
});

test("marks workflow lanes conservatively when core surfaces are absent", () => {
  const lanes = getLocalAdeWorkflowLanes({
    diagnostics: {
      health: {
        state: "degraded",
      },
    },
    snapshot: {
      providers: [],
      mcp: {
        servers: [],
      },
      changeTrust: {
        isGitRepo: false,
        changedFiles: [],
      },
      checkpoints: {
        items: [],
      },
      subagents: [],
      projectIndex: {
        indexedAt: null,
        indexedFiles: 0,
        symbols: [],
        tasks: [],
      },
    },
  });

  expect(lanes.find((lane) => lane.id === "session")?.tone).toBe("warning");
  expect(lanes.find((lane) => lane.id === "provider")?.tone).toBe("blocked");
  expect(lanes.find((lane) => lane.id === "mcp")?.tone).toBe("idle");
  expect(lanes.find((lane) => lane.id === "checkpoint")?.value).toBe("not git");
  expect(lanes.find((lane) => lane.id === "context")?.value).toBe("stale");
  expect(lanes.find((lane) => lane.id === "subagent")?.tone).toBe("idle");
});

test("builds active workspace focus from live session and recent signals", () => {
  const focus = getLocalAdeWorkspaceFocus({
    diagnostics: {
      health: {
        state: "ready",
      },
    },
    snapshot: {
      sessions: {
        active: [
          {
            id: "chat-123456789",
            chatStatus: "running",
            sessionId: "ses-abcdefghi",
            subscriberCount: 1,
            pendingPermissions: 2,
            activeToolCalls: 1,
            agentName: "OpenCode",
          },
        ],
      },
      providers: [],
      mcp: {
        servers: [
          {
            enabled: true,
            health: "available",
            trustStatus: "untrusted",
            protocol: { status: "initialized" },
            tools: [{ name: "read_repo" }],
            notificationHistory: [
              {
                source: "probe",
                method: "notifications/message",
                receivedAt: "2026-06-11T10:00:00.000Z",
              },
            ],
            invocationHistory: [
              {
                method: "tools/call",
                target: "read_repo",
                status: "success",
                finishedAt: "2026-06-11T09:00:00.000Z",
              },
            ],
          },
        ],
      },
      changeTrust: {
        isGitRepo: true,
        changedFiles: ["README.md"],
      },
      checkpoints: {
        items: [
          {
            id: "checkpoint-1",
            name: "Before edit",
            createdAt: "2026-06-11T08:00:00.000Z",
            changedFiles: ["README.md"],
            patchBytes: 42,
            canRestore: true,
          },
        ],
      },
      subagents: [],
      acpActivity: {
        stats: {
          total: 7,
          chatCount: 1,
        },
        correlations: [
          {
            label: "chat chat-123456789",
            eventCount: 3,
            latestMessage: "ACP raw session setup payload",
            lastTimestamp: Date.parse("2026-06-11T10:01:00.000Z"),
          },
        ],
      },
    },
  });

  expect(focus.title).toBe("Active Workspace");
  expect(focus.subtitle).toBe("OpenCode / running");
  expect(focus.items.map((item) => item.id)).toEqual([
    "session",
    "checkpoint",
    "mcp",
    "activity",
  ]);
  expect(focus.items.find((item) => item.id === "session")?.tone).toBe(
    "warning"
  );
  expect(focus.items.find((item) => item.id === "session")?.detail).toContain(
    "2 permission(s)"
  );
  expect(focus.items.find((item) => item.id === "checkpoint")?.value).toBe(
    "1 changed"
  );
  expect(focus.items.find((item) => item.id === "mcp")?.tone).toBe("warning");
  expect(focus.items.find((item) => item.id === "mcp")?.detail).toBe(
    "initialized but trust required"
  );
  expect(focus.items.find((item) => item.id === "activity")?.detail).toBe(
    "chat chat-123456789 / 3 event(s)"
  );
});

test("builds standby workspace focus when no session is active", () => {
  const focus = getLocalAdeWorkspaceFocus({
    diagnostics: {
      health: {
        state: "ready",
      },
    },
    snapshot: {
      sessions: {
        active: [],
      },
      providers: [],
      mcp: {
        servers: [],
      },
      changeTrust: {
        isGitRepo: true,
        changedFiles: [],
      },
      checkpoints: {
        items: [],
      },
      subagents: [],
      acpActivity: {
        stats: {
          total: 0,
          chatCount: 0,
        },
        correlations: [],
      },
    },
  });

  expect(focus.title).toBe("Workspace Standby");
  expect(focus.subtitle).toBe("No active agent session");
  expect(focus.items.find((item) => item.id === "session")?.value).toBe("ready");
  expect(focus.items.find((item) => item.id === "session")?.tone).toBe("idle");
  expect(focus.items.find((item) => item.id === "activity")?.tone).toBe("idle");
});
