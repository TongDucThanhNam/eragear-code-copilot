import { expect, test } from "bun:test";
import {
  buildLocalAdeCommandLaunchText,
  getLocalAdeAgentLaunchMatrix,
  getLocalAdeBackgroundSummary,
  getLocalAdeCheckpointConflictEditorState,
  getLocalAdeCheckpointRestorePlan,
  getLocalAdeCheckpointVisualMergeState,
  getLocalAdeCommandDeckState,
  getLocalAdeCommandLaunchOptions,
  getLocalAdeOperationSummary,
  getLocalAdeRunActions,
  getLocalAdeSessionCockpitState,
  getLocalAdeWorkbenchState,
  getLocalAdeWorkflowLanes,
  getLocalAdeWorkspaceFocus,
} from "./local-ade-operations";

test("summarizes background scheduler task visibility", () => {
  const summary = getLocalAdeBackgroundSummary({
    runtime: {
      background: {
        enabled: true,
        startedAt: 1_781_229_000_000,
        tickMs: 1000,
        tasks: [
          {
            name: "plugin-batch-schedule-dispatch",
            running: false,
            successCount: 2,
            failureCount: 0,
            lastDurationMs: 42,
            lastResult: {
              dueSchedules: 1,
              dispatchedSchedules: 1,
              failedProjects: 0,
            },
          },
          {
            name: "session-idle-cleanup",
            running: true,
            successCount: 0,
            failureCount: 0,
          },
        ],
      },
    },
  });

  expect(summary.enabled).toBe(true);
  expect(summary.started).toBe(true);
  expect(summary.taskCount).toBe(2);
  expect(summary.running).toBe(1);
  expect(summary.succeeded).toBe(1);
  expect(summary.pluginBatchDispatch).toEqual({
    status: "success",
    successCount: 2,
    failureCount: 0,
    lastDurationMs: 42,
    dueSchedules: 1,
    dispatchedSchedules: 1,
    failedProjects: 0,
  });
});

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
        {
          id: "opencode",
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
        },
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
        changedFiles: ["README.md", "apps/desktop/src/renderer/app.tsx"],
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

test("builds agent launch matrix from CLI and provider readiness", () => {
  const matrix = getLocalAdeAgentLaunchMatrix({
    diagnostics: {
      health: { state: "ready" },
      cliAvailability: [
        {
          id: "opencode",
          command: "opencode",
          available: true,
          executablePath: "C:\\Tools\\opencode.exe",
          version: "1.2.3",
        },
        {
          id: "codex",
          command: "codex",
          available: true,
          executablePath: "/usr/local/bin/codex",
        },
        {
          id: "gemini",
          command: "gemini",
          available: false,
          installHint: "Install Gemini CLI",
        },
      ],
    },
    snapshot: {
      agents: {
        activeAgentId: "agent-opencode",
        items: [
          {
            id: "agent-opencode",
            name: "OpenCode",
            type: "opencode",
            command: "C:\\Tools\\opencode.exe",
            args: ["acp"],
            isActive: true,
          },
          {
            id: "agent-codex",
            name: "Codex",
            type: "codex",
            command: "codex",
            args: ["acp"],
          },
          {
            id: "agent-gemini",
            name: "Gemini",
            type: "gemini",
            command: "gemini",
            args: ["acp"],
          },
        ],
      },
      providers: [
        {
          id: "provider.agent.agent-opencode",
          displayName: "OpenCode",
          providerKind: "opencode",
          compatibleAgents: ["agent-opencode"],
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
          authStatus: "ok",
          modelStatus: "ok",
          version: "1.2.3",
        },
        {
          id: "provider.agent.agent-codex",
          displayName: "Codex",
          providerKind: "codex",
          compatibleAgents: ["agent-codex"],
          status: "configured",
          readiness: "cli-ok",
          cliStatus: "ok",
          authStatus: "unknown",
          modelStatus: "unknown",
        },
        {
          id: "provider.agent.agent-gemini",
          displayName: "Gemini",
          providerKind: "gemini",
          compatibleAgents: ["agent-gemini"],
          status: "missing-config",
          readiness: "missing-config",
          cliStatus: "missing",
          remediation: ["Install Gemini CLI"],
        },
      ],
    },
  });

  expect(
    matrix.map((target) => [target.agentId, target.status, target.canStart])
  ).toEqual([
    ["agent-opencode", "ready", true],
    ["agent-codex", "needs-probe", true],
    ["agent-gemini", "missing-cli", false],
  ]);
  expect(matrix[0]?.isActive).toBe(true);
  expect(matrix[0]?.version).toBe("1.2.3");
  expect(matrix[2]?.detail).toContain("Install Gemini CLI");
});

test("builds a safe selected-file checkpoint restore plan", () => {
  const plan = getLocalAdeCheckpointRestorePlan({
    diffFiles: [{ path: "README.md" }, { path: "src/app.ts" }],
    restoreRisks: [
      { file: "README.md", level: "safe" },
      { file: "src/app.ts", level: "warning" },
      {
        file: "EXTRA.md",
        level: "blocked",
        patchAction: "unexpected current change",
        currentStatus: "?? EXTRA.md",
        reason:
          "This file changed after the checkpoint and is not part of the restore precondition.",
      },
      {
        file: "tracked.ts",
        level: "blocked",
        patchAction: "revert tracked changes",
        currentStatus: " M tracked.ts",
        reason:
          "Tracked checkpoint patch no longer applies cleanly for this file: patch failed.",
      },
      { file: "README.md", level: "safe" },
    ],
    restoreBlockers: [{ file: "EXTRA.md", reason: "unrelated change" }],
  });

  expect(plan.canRestoreAll).toBe(false);
  expect(plan.patchFiles).toEqual(["README.md", "src/app.ts"]);
  expect(plan.safeFiles).toEqual(["README.md"]);
  expect(plan.warningFiles).toEqual(["src/app.ts"]);
  expect(plan.blockedFiles).toEqual(["EXTRA.md", "tracked.ts"]);
  expect(plan.restorableSafeFiles).toEqual(["README.md"]);
  expect(plan.shelvableBlockedFiles).toEqual(["EXTRA.md"]);
  expect(plan.trackedConflictFiles).toEqual(["tracked.ts"]);
  expect(plan.canRestoreSelectedSafeFiles).toBe(true);
  expect(plan.canShelveBlockedFiles).toBe(true);
  expect(plan.canResolveTrackedConflicts).toBe(true);
});

test("builds checkpoint mixed conflict editor rows", () => {
  const editor = getLocalAdeCheckpointConflictEditorState({
    preview: {
      diffFiles: [
        { path: "README.md", hunks: [{}, {}] },
        { path: "src/app.ts", hunks: [{}] },
        { path: "tracked.ts", hunks: [{}, {}] },
      ],
      restoreRisks: [
        { file: "README.md", level: "safe", patchAction: "restore patch" },
        { file: "src/app.ts", level: "warning", patchAction: "manual review" },
        {
          file: "EXTRA.md",
          level: "blocked",
          patchAction: "unexpected current change",
          currentStatus: "?? EXTRA.md",
          reason:
            "This file changed after the checkpoint and is not part of the restore precondition.",
        },
        {
          file: "tracked.ts",
          level: "blocked",
          patchAction: "revert tracked changes",
          currentStatus: " M tracked.ts",
          reason:
            "Tracked checkpoint patch no longer applies cleanly for this file: patch failed.",
        },
      ],
      restoreBlockers: [
        { file: "EXTRA.md", reason: "unrelated change" },
        { file: "tracked.ts", reason: "tracked conflict" },
      ],
    },
    selectedFiles: ["README.md"],
    selectedHunks: [
      { file: "README.md", hunkIndex: 1 },
      { file: "tracked.ts", hunkIndex: 0 },
    ],
  });

  expect(editor.selectedFileCount).toBe(1);
  expect(editor.selectedHunkCount).toBe(2);
  expect(editor.trackedConflictCount).toBe(1);
  expect(editor.shelvableBlockerCount).toBe(1);
  expect(editor.hasMixedChoices).toBe(true);

  const readme = editor.rows.find((row) => row.file === "README.md");
  expect(readme?.availableActions).toEqual(["restore-file", "restore-hunks"]);
  expect(readme?.selectedFile).toBe(true);
  expect(readme?.selectedHunks).toBe(1);
  expect(readme?.recommendedAction).toBe("restore-hunks");

  const tracked = editor.rows.find((row) => row.file === "tracked.ts");
  expect(tracked?.availableActions).toEqual([
    "keep-current",
    "use-restore-side",
    "resolve-hunk-choices",
  ]);
  expect(tracked?.selectedHunks).toBe(1);
  expect(tracked?.recommendedAction).toBe("resolve-hunk-choices");

  const shelvable = editor.rows.find((row) => row.file === "EXTRA.md");
  expect(shelvable?.availableActions).toEqual(["shelve-blocker"]);
  expect(shelvable?.recommendedAction).toBe("shelve-blocker");
});

test("builds checkpoint visual merge side-by-side rows", () => {
  const reverse = getLocalAdeCheckpointVisualMergeState({
    preview: {
      restoreMode: "reverse-patch",
      diffFiles: [
        {
          path: "README.md",
          status: "modified",
          additions: 2,
          deletions: 1,
          hunks: [
            {
              header: "@@ -1,2 +1,2 @@",
              rows: [
                {
                  kind: "context",
                  oldLine: 1,
                  newLine: 1,
                  oldText: "same",
                  newText: "same",
                },
                {
                  kind: "change",
                  oldLine: 2,
                  newLine: 2,
                  oldText: "checkpoint",
                  newText: "current",
                },
                {
                  kind: "add",
                  newLine: 3,
                  newText: "current only",
                },
              ],
            },
          ],
        },
      ],
      restoreRisks: [
        { file: "README.md", level: "safe", patchAction: "reverse patch" },
      ],
    },
    selectedFiles: ["README.md"],
    selectedHunks: [{ file: "README.md", hunkIndex: 0 }],
  });

  expect(reverse.currentLabel).toBe("Current workspace");
  expect(reverse.restoreLabel).toBe("Checkpoint side");
  expect(reverse.totalFiles).toBe(1);
  expect(reverse.totalHunks).toBe(1);
  expect(reverse.selectedHunks).toBe(1);
  expect(reverse.files[0]?.selectedFile).toBe(true);
  expect(reverse.files[0]?.recommendedAction).toBe("restore-hunks");
  expect(reverse.files[0]?.currentChangeRows).toBe(2);
  expect(reverse.files[0]?.restoreChangeRows).toBe(1);
  const changedRow = reverse.files[0]?.hunks[0]?.rows[1];
  expect(changedRow?.current.text).toBe("current");
  expect(changedRow?.restore.text).toBe("checkpoint");
  const addRow = reverse.files[0]?.hunks[0]?.rows[2];
  expect(addRow?.current.text).toBe("current only");
  expect(addRow?.restore.text).toBe("");

  const apply = getLocalAdeCheckpointVisualMergeState({
    preview: {
      restoreMode: "apply-patch",
      diffFiles: [
        {
          path: "SAFETY.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          hunks: [
            {
              header: "@@ -1 +1 @@",
              rows: [
                {
                  kind: "change",
                  oldLine: 1,
                  newLine: 1,
                  oldText: "baseline",
                  newText: "restore target",
                },
              ],
            },
          ],
        },
      ],
      restoreRisks: [
        { file: "SAFETY.md", level: "safe", patchAction: "apply patch" },
      ],
    },
  });

  expect(apply.currentLabel).toBe("Current baseline");
  expect(apply.restoreLabel).toBe("Restore target");
  expect(apply.files[0]?.hunks[0]?.rows[0]?.current.text).toBe("baseline");
  expect(apply.files[0]?.hunks[0]?.rows[0]?.restore.text).toBe(
    "restore target"
  );
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
        {
          id: "opencode",
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
        },
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
        changedFiles: ["apps/desktop/src/renderer/app.tsx"],
      },
      checkpoints: {
        items: [{ id: "checkpoint-1" }, { id: "checkpoint-2" }],
      },
      subagents: [{ name: "code-reviewer", enabled: true }],
      projectIndex: {
        indexedAt: "2026-06-11T01:58:00.000Z",
        indexedFiles: 42,
        symbols: [{ name: "LocalAdeWorkspaceHome" }],
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
        {
          id: "opencode",
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
        },
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

test("builds an ADE workbench state with a real primary action", () => {
  const workbench = getLocalAdeWorkbenchState({
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
        {
          id: "opencode",
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
        },
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

  expect(workbench.status).toBe("running");
  expect(workbench.headline).toBe("Session running");
  expect(workbench.score).toBe("5/6 ready");
  expect(workbench.primaryAction?.id).toBe("checkpoint");
  expect(workbench.primaryAction?.action).toBe("create-checkpoint");
  expect(workbench.metrics.map((metric) => metric.id)).toEqual([
    "agent",
    "tools",
    "changes",
    "context",
  ]);
  expect(
    workbench.metrics.find((metric) => metric.id === "changes")?.tone
  ).toBe("warning");
  expect(workbench.commands.map((command) => command.command)).toEqual([
    "/index <query>",
    "/memory <request>",
    "/agent-code-reviewer",
  ]);
});

test("builds a workspace command deck from real run actions", () => {
  const deck = getLocalAdeCommandDeckState({
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
            subscriberCount: 1,
          },
        ],
      },
      providers: [
        {
          id: "opencode",
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
        },
      ],
      mcp: {
        agentRouting: {
          injectableCount: 1,
          conditionalCount: 0,
          blockedCount: 0,
          agentInvocationHistory: [],
          routes: [{ brokerMode: "stdio-proxy" }],
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
        changedFiles: ["README.md"],
      },
      checkpoints: {
        items: [{ id: "checkpoint-1", createdAt: "2026-06-12T01:00:00.000Z" }],
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

  expect(deck.status).toBe("running");
  expect(deck.primaryAction?.id).toBe("checkpoint");
  expect(deck.primaryAction?.action).toBe("create-checkpoint");
  expect(deck.secondaryActions.map((action) => action.id)).toContain("session");
  expect(deck.secondaryActions.every((action) => action.enabled)).toBe(true);
  expect(deck.panels.map((panel) => panel.id)).toEqual([
    "operation",
    "guardrail",
    "tooling",
    "context",
  ]);
  expect(deck.panels.find((panel) => panel.id === "guardrail")?.tone).toBe(
    "warning"
  );
  expect(deck.commands.map((command) => command.command)).toEqual([
    "/index <query>",
    "/memory <request>",
    "/agent-code-reviewer",
  ]);
});

test("builds an active session cockpit with attention-first ordering", () => {
  const cockpit = getLocalAdeSessionCockpitState({
    diagnostics: {
      health: {
        state: "ready",
      },
    },
    snapshot: {
      sessions: {
        totalStored: 12,
        active: [
          {
            id: "chat-tool-call-123456",
            chatStatus: "running",
            agentName: "OpenCode",
            subscriberCount: 1,
            pendingPermissions: 0,
            activeToolCalls: 2,
            pid: 42,
            model: {
              currentModelId: "opencode/big-pickle",
              supportsSwitching: true,
              source: "models",
            },
          },
          {
            id: "chat-permission-123456",
            chatStatus: "running",
            agentName: "Codex",
            subscriberCount: 2,
            pendingPermissions: 1,
            activeToolCalls: 0,
            sessionId: "agent-session-123456",
            model: {
              currentModelId: "gpt-5.5",
              supportsSwitching: true,
              source: "config-option",
            },
          },
        ],
      },
      providers: [
        {
          id: "opencode",
          status: "ready",
          readiness: "ready",
          cliStatus: "ok",
        },
      ],
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

  expect(cockpit.mode).toBe("active");
  expect(cockpit.activeCount).toBe(2);
  expect(cockpit.totalStored).toBe(12);
  expect(cockpit.pendingPermissions).toBe(1);
  expect(cockpit.activeToolCalls).toBe(2);
  expect(cockpit.subscribers).toBe(3);
  expect(cockpit.primarySession?.id).toBe("chat-permission-123456");
  expect(cockpit.primarySession?.tone).toBe("warning");
  expect(cockpit.sessions[1]?.model).toBe("opencode/big-pickle");
  expect(cockpit.commands.map((command) => command.command)).toEqual([
    "/index <query>",
    "/memory <request>",
    "/agent-code-reviewer",
  ]);
  expect(cockpit.launchOptions.map((option) => option.baseCommand)).toEqual([
    "/index",
    "/memory",
    "/agent-code-reviewer",
  ]);
  expect(
    cockpit.launchOptions.find((option) => option.id === "index")
      ?.requiresArgument
  ).toBe(true);
});

test("builds first-screen command launch text without submitting placeholders", () => {
  const options = getLocalAdeCommandLaunchOptions([
    {
      id: "index",
      label: "Index",
      command: "/index <query>",
      detail: "search project index",
      tone: "ready",
    },
    {
      id: "subagent",
      label: "Subagent",
      command: "/agent-code-reviewer",
      detail: "delegate to reviewer",
      tone: "ready",
    },
  ]);

  const index = options.find((option) => option.id === "index");
  const subagent = options.find((option) => option.id === "subagent");

  expect(index?.baseCommand).toBe("/index");
  expect(index?.argumentHint).toBe("query");
  expect(
    index
      ? buildLocalAdeCommandLaunchText({ option: index, argument: "" })
      : undefined
  ).toEqual({
    status: "missing-argument",
    message: "Add query before running /index.",
  });
  expect(
    index
      ? buildLocalAdeCommandLaunchText({
          option: index,
          argument: "rollback safety",
        })
      : undefined
  ).toEqual({
    status: "ready",
    text: "/index rollback safety",
  });
  expect(
    subagent
      ? buildLocalAdeCommandLaunchText({
          option: subagent,
          argument: "review checkpoint flow",
        })
      : undefined
  ).toEqual({
    status: "ready",
    text: "/agent-code-reviewer review checkpoint flow",
  });
});

test("routes workbench setup to provider configuration instead of a disabled probe", () => {
  const workbench = getLocalAdeWorkbenchState({
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
      projectIndex: {
        indexedAt: null,
        indexedFiles: 0,
      },
      projectMemory: {
        sources: [],
      },
    },
  });

  expect(workbench.status).toBe("setup");
  expect(workbench.primaryAction?.id).toBe("provider");
  expect(workbench.primaryAction?.label).toBe("Configure Providers");
  expect(workbench.primaryAction?.action).toBe("inspect-section");
  expect(workbench.primaryAction?.enabled).toBe(true);
  expect(workbench.primaryAction?.targetSection).toBe("local-ade-providers");
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
        injectableCount: 2,
        conditionalCount: 0,
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
            status: "injectable",
            serverName: "Remote MCP",
            reason: "Ready for ACP session MCP broker injection.",
            brokerMode: "stdio-proxy",
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

  expect(summary.mcp.agentBrokered).toBe(2);
  expect(summary.mcp.agentBrokerCalls).toBe(1);
  expect(focus.items.find((item) => item.id === "mcp")?.detail).toBe(
    "2 brokered / 0 conditional agent route(s)"
  );
  expect(actions.find((action) => action.id === "mcp")?.detail).toBe(
    "1 brokered agent MCP call(s)"
  );
  expect(lanes.find((lane) => lane.id === "mcp")?.detail).toBe(
    "2 brokered / 0 conditional agent route(s)"
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
  expect(actions.find((action) => action.id === "provider")?.label).toBe(
    "Configure Providers"
  );
  expect(actions.find((action) => action.id === "provider")?.action).toBe(
    "inspect-section"
  );
  expect(actions.find((action) => action.id === "provider")?.enabled).toBe(
    true
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
  expect(
    actions.find((action) => action.id === "memory")?.command
  ).toBeUndefined();
  expect(
    actions.find((action) => action.id === "subagent")?.targetSection
  ).toBe("local-ade-capabilities");
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
  expect(focus.items.find((item) => item.id === "session")?.value).toBe(
    "ready"
  );
  expect(focus.items.find((item) => item.id === "session")?.tone).toBe("idle");
  expect(focus.items.find((item) => item.id === "activity")?.tone).toBe("idle");
});
