"use strict";
// Mock eragearDesktop bridge for interactive Run Center verification. This is
// the ACTUAL application renderer (index.html -> main.tsx -> router) with an
// isolated mocked transport: every tRPC operation the real UI issues is
// recorded in window.__ERAGEAR_MOCK__.operations so the runner can assert
// exact mutation payloads. No runtime process, no ACP session, no provider.
const { contextBridge } = require("electron");

const NOW = "2026-09-22T11:00:00.000Z";

const state = {
  operations: [],
  config: {
    delayMs: {},
    rejections: {},
  },
  bootstrap: {
    platform: "electron",
    mode: "main-thread",
    transport: { kind: "electron-ipc", networkExposed: false },
    runtimeReady: true,
    diagnostics: [],
    localAuthToken: "interaction-mock-token",
  },
};

const approvalRun = {
  runId: "run-approve",
  revision: 4,
  projectId: "project-1",
  status: "awaiting_approval",
  priority: "normal",
  originatingChatId: "chat-main",
  tasks: [
    {
      taskId: "task-s1",
      title: "Move loader into runtime",
      role: "implementation",
      executionMode: "write",
      dependencies: [],
      criterionIds: [],
      changeKinds: [],
      status: "queued",
      attempts: [],
    },
  ],
  gates: [
    {
      gateId: "gate-1",
      taskId: "task-s1",
      attemptId: "att-s1",
      kind: "deletion",
      status: "pending",
    },
    {
      gateId: "gate-2",
      taskId: "task-s1",
      attemptId: "att-s1",
      kind: "baseline_drift",
      status: "pending",
    },
  ],
  capacityWaits: [],
  decisions: [
    {
      decisionId: "dec-1",
      kind: "goal_criteria_acceptance",
      status: "open",
      prompt:
        "Criterion “tests pass” cannot be verified while the worker is interrupted. Accept after your own review, or waive with a note?",
      createdAt: NOW,
      criterionIds: ["crit-1"],
    },
  ],
  finalVerification: [],
  manager: {
    agentId: "manager-1",
    chatId: "chat-manager",
    status: "running",
    exactResumeRequired: true,
  },
  plan: {
    version: 2,
    hash: "feedfacefeedfacefeedfacefeedface",
    summary: "Refactor the settings loader into a runtime service",
    envelope: {
      goal: "Refactor safely",
      fileScopes: [],
      verificationCommands: [],
      successCriteria: [],
      permissionScopes: [],
      destructiveActions: [],
      delivery: {
        createCommit: true,
        targetBranch: "main",
        targetHead: "abc123",
        allowDefaultBranch: false,
      },
    },
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const runningRun = {
  runId: "run-branch",
  revision: 7,
  projectId: "project-1",
  status: "running",
  priority: "normal",
  originatingChatId: "chat-main",
  tasks: [
    {
      taskId: "task-a",
      title: "Map repository structure",
      role: "implementation",
      executionMode: "write",
      dependencies: [],
      criterionIds: [],
      changeKinds: [],
      status: "completed",
      attempts: [
        {
          attemptId: "att-a1",
          chatId: "chat-scout",
          agentId: "scout-a",
          status: "terminal",
          verification: [],
        },
      ],
    },
    {
      taskId: "task-b",
      title: "Implement feature",
      role: "implementation",
      executionMode: "write",
      dependencies: ["task-a"],
      criterionIds: [],
      changeKinds: [],
      status: "running",
      attempts: [
        {
          attemptId: "att-b1",
          chatId: "",
          agentId: "worker-b1",
          status: "interrupted",
          verification: [],
        },
        {
          attemptId: "att-b2",
          chatId: "chat-worker-b2",
          agentId: "worker-b2",
          status: "running",
          verification: [],
        },
      ],
    },
    {
      taskId: "task-c",
      title: "Write regression tests",
      role: "verification",
      executionMode: "write",
      dependencies: ["task-a"],
      criterionIds: [],
      changeKinds: [],
      status: "blocked",
      attempts: [],
    },
  ],
  gates: [
    {
      gateId: "gate-b",
      taskId: "task-b",
      attemptId: "att-b2",
      kind: "deletion",
      status: "pending",
    },
  ],
  capacityWaits: [
    {
      waitId: "wait-1",
      owner: "task",
      taskId: "task-b",
      attemptId: "att-b2",
      agentId: "worker-b2",
      kind: "quota_exhausted",
      retryAt: "2026-09-22T18:30:00.000Z",
      resetAt: "2026-09-22T19:00:00.000Z",
    },
  ],
  decisions: [],
  finalVerification: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const quotaRun = {
  runId: "run-quota",
  revision: 9,
  projectId: "project-1",
  status: "waiting_capacity",
  priority: "normal",
  originatingChatId: "chat-other",
  tasks: [],
  gates: [],
  capacityWaits: [
    {
      waitId: "w-manager",
      owner: "manager",
      agentId: "manager-9",
      kind: "quota_exhausted",
      retryAt: "2026-09-22T18:30:00.000Z",
    },
  ],
  decisions: [],
  finalVerification: [],
  createdAt: NOW,
  updatedAt: NOW,
};

// Completed run with mixed evidence: one passing aggregate check, one check
// without any recorded result, and a criterion resolved by explicit user
// review instead of machine verification. The chat card must describe exactly
// this state — never an unconditional "verification complete" claim.
const completedRun = {
  runId: "run-done",
  revision: 12,
  projectId: "project-1",
  status: "completed",
  priority: "normal",
  originatingChatId: "chat-main",
  tasks: [
    {
      taskId: "task-d1",
      title: "Ship the export pipeline with honest verification evidence",
      role: "implementation",
      executionMode: "write",
      dependencies: [],
      criterionIds: ["crit-docs"],
      changeKinds: [],
      status: "completed",
      attempts: [
        {
          attemptId: "att-d1",
          chatId: "chat-worker-d1",
          agentId: "worker-d1-implementer",
          status: "terminal",
          verification: [{ command: "bun test src/export", exitCode: 0 }],
        },
      ],
    },
  ],
  gates: [],
  capacityWaits: [],
  decisions: [
    {
      decisionId: "dec-done",
      kind: "goal_criteria_acceptance",
      status: "answered",
      prompt:
        "Criterion “docs updated” could not be machine-verified. Accept after your own review, or waive with a note?",
      createdAt: NOW,
      answeredAt: NOW,
      criterionIds: ["crit-docs"],
    },
  ],
  finalVerification: [
    { command: "bun test", exitCode: 0 },
    { command: "bun run lint", exitCode: null },
  ],
  finalCommitSha: "cafebabecafebabecafebabecafebabe",
  createdAt: NOW,
  updatedAt: NOW,
};

const runs = [approvalRun, runningRun, quotaRun, completedRun];

const details = {
  "run-approve": {
    runId: "run-approve",
    revision: 4,
    projectId: "project-1",
    status: "awaiting_approval",
    phase: "planning",
    desiredState: "running",
    plannerReplanCount: 0,
    originalIntent: "Refactor the settings loader into a runtime service",
    createdAt: NOW,
    updatedAt: NOW,
    tasks: [
      {
        taskId: "task-s1",
        title: "Move loader into runtime",
        prompt: "Move the loader into the runtime service.",
        role: "implementation",
        executionMode: "write",
        dependencies: [],
        criterionIds: [],
        status: "queued",
        filesAllowed: { paths: ["src/settings.ts"], total: 1 },
        verificationCommands: ["bun test"],
        attempts: [],
      },
    ],
    gates: [],
    audit: { entries: [], total: 0, truncated: false },
    finalVerification: [],
  },
  "run-branch": {
    runId: "run-branch",
    revision: 7,
    projectId: "project-1",
    status: "running",
    phase: "executing",
    desiredState: "running",
    plannerReplanCount: 0,
    originalIntent: "Add an export pipeline behind a flag",
    createdAt: NOW,
    updatedAt: NOW,
    tasks: [
      {
        taskId: "task-a",
        title: "Map repository structure",
        prompt: "List the modules that own export behavior today.",
        role: "implementation",
        executionMode: "write",
        dependencies: [],
        criterionIds: [],
        status: "completed",
        filesAllowed: { paths: ["docs/structure.md"], total: 12 },
        verificationCommands: ["bun run check:ast"],
        attempts: [
          {
            attemptId: "att-a1",
            chatId: "chat-scout",
            agentId: "scout-a",
            status: "terminal",
            startedAt: NOW,
            files: {
              touched: { paths: [], total: 0 },
              created: { paths: [], total: 0 },
              deleted: { paths: [], total: 0 },
              renamed: [],
            },
            verification: [
              {
                command: "bun run check:ast",
                exitCode: 0,
                outputSummary: "ok",
              },
            ],
            unresolvedPermissions: [],
            toolFailureSummary: [],
          },
        ],
      },
      {
        taskId: "task-b",
        title: "Implement feature",
        prompt: "Implement the export pipeline behind ERAGEAR_EXPORT=1.",
        role: "implementation",
        executionMode: "write",
        dependencies: ["task-a"],
        criterionIds: [],
        status: "running",
        filesAllowed: {
          paths: ["src/export/pipeline.ts", "src/cli.ts"],
          total: 5,
        },
        verificationCommands: ["bun test src/export"],
        attempts: [
          {
            attemptId: "att-b2",
            chatId: "chat-worker-b2",
            agentId: "worker-b2",
            status: "running",
            startedAt: NOW,
            files: {
              touched: { paths: [], total: 0 },
              created: { paths: [], total: 0 },
              deleted: { paths: [], total: 0 },
              renamed: [],
            },
            verification: [],
            unresolvedPermissions: [],
            toolFailureSummary: [],
          },
        ],
      },
      {
        taskId: "task-c",
        title: "Write regression tests",
        prompt: "Cover the flag-off path so the default build is unchanged.",
        role: "verification",
        executionMode: "write",
        dependencies: ["task-a"],
        criterionIds: [],
        status: "blocked",
        filesAllowed: { paths: [], total: 0 },
        verificationCommands: [],
        attempts: [],
      },
    ],
    gates: [],
    audit: {
      entries: [
        {
          auditId: "a-1",
          kind: "run_started",
          createdAt: NOW,
          actor: "user",
          summary: "Run started from chat intent.",
        },
      ],
      total: 41,
      truncated: true,
    },
    finalVerification: [],
  },
};

function respond(data) {
  return { ok: true, data };
}

function updatedRun(runId, patch) {
  const base = runs.find((run) => run.runId === runId) ?? runs[0];
  return { ...base, revision: base.revision + 1, ...patch };
}

/** App-shell query shapes the real renderer expects while booting. */
const APP_SHELL_QUERIES = {
  "agents.list": { agents: [] },
  "auth.getMe": {
    id: "user-1",
    name: "Interaction Tester",
    email: "tester@fixture.local",
  },
  getSessionsPage: { items: [], nextCursor: null },
  getSessionMessagesPage: { messages: [], hasMore: false, nextCursor: null },
  "supervisorGoals.list": [],
  "supervisorRuns.profiles.list": [],
  "supervisorRuns.telegram.status": { configured: false, paired: false },
  // The Supervisos rail badge reads summary.changedFiles.length; an empty
  // fixture worktree means no changes.
  "git.summary": { changedFiles: [] },
  "settings.getLocalAdeSnapshot": {
    mcp: { servers: [] },
    sessions: { active: [] },
    projectMemory: { presets: [], sources: [] },
    commands: [],
    skills: [],
    outputStyles: [],
    subagents: [],
  },
  "contextUsage.estimate": {
    modelId: "fixture-model",
    maxTokens: 200_000,
    usedTokens: 0,
    status: "ok",
    breakdown: {
      historyTokens: 0,
      draftTokens: 0,
      attachmentTokens: 0,
      mentionTokens: 0,
    },
  },
};

function listProjectsPayload() {
  return {
    projects: [
      {
        id: "project-1",
        name: "Fixture Project",
        path: "C:/fixtures/project-1",
      },
    ],
    activeProjectId: "project-1",
  };
}

async function handleOperation(operation) {
  const { type, path, input } = operation;
  state.operations.push({ type, path, input, at: new Date().toISOString() });
  const rejection = state.config.rejections[path];
  if (rejection) {
    return { ok: false, error: { message: rejection, name: "MockReject" } };
  }
  const delay = state.config.delayMs[path] ?? 0;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (type === "query") {
    if (path === "supervisorRuns.list") {
      return respond(runs);
    }
    if (path === "supervisorRuns.detail") {
      return respond(details[input?.runId] ?? details["run-approve"]);
    }
    if (path === "listProjects") {
      return respond(listProjectsPayload());
    }
    if (path in APP_SHELL_QUERIES) {
      return respond(APP_SHELL_QUERIES[path]);
    }
    return respond({});
  }
  // Mutations return an updated run-shaped value like the real procedures.
  const runId = input?.runId ?? "run-approve";
  if (path === "supervisorRuns.approvePlan") {
    return respond(updatedRun(runId, { status: "running" }));
  }
  if (path === "supervisorRuns.requestPlanChanges") {
    return respond(updatedRun(runId, { status: "planning" }));
  }
  return respond(updatedRun(runId, {}));
}

const runtimeBridge = {
  requestRuntime: async (input) => handleOperation(input.operation),
  subscribeRuntime: async () => ({ subscriptionId: "mock-sub-1" }),
  unsubscribeRuntime: async () => undefined,
  onRuntimeSubscriptionEvent: () => () => undefined,
};

const asyncNoop = async () => null;
const listenerNoop = () => () => undefined;

const bridge = {
  ...runtimeBridge,
  getBootstrap: async () => state.bootstrap,
  getRuntimeDiagnostics: async () => [],
  getRemoteConnectStatus: async () => null,
  runtimeDaemon: {
    status: asyncNoop,
    install: asyncNoop,
    start: asyncNoop,
    stop: asyncNoop,
  },
  getDesktopSettings: async () => ({}),
  updateRemoteConnectSettings: asyncNoop,
  createRemoteConnectToken: async () => "",
  checkForUpdates: async () => null,
  openProjectFolder: asyncNoop,
  openProjectExternally: asyncNoop,
  openExternalAiConsultation: asyncNoop,
  browserControls: {
    captureContext: asyncNoop,
    close: asyncNoop,
    getState: async () => null,
    goBack: asyncNoop,
    goForward: asyncNoop,
    open: asyncNoop,
    openDevTools: asyncNoop,
    openHtmlFile: asyncNoop,
    reload: asyncNoop,
    setFullScreen: asyncNoop,
    onStateChange: listenerNoop,
  },
  windowControls: {
    close: asyncNoop,
    getState: async () => null,
    minimize: asyncNoop,
    toggleMaximize: async () => null,
    onStateChange: listenerNoop,
  },
};

contextBridge.exposeInMainWorld("eragearDesktop", bridge);
contextBridge.exposeInMainWorld(
  "__ERAGEAR_DESKTOP_BOOTSTRAP__",
  state.bootstrap
);
// Mock control must cross the contextBridge as functions: plain data exposed
// here would be cloned, so page-side config writes and operations reads would
// never reach the preload's live state.
contextBridge.exposeInMainWorld("__ERAGEAR_MOCK__", {
  getOperations: () => JSON.parse(JSON.stringify(state.operations)),
  setDelay: (operationPath, ms) => {
    state.config.delayMs[operationPath] = ms;
    return true;
  },
  setRejection: (operationPath, reason) => {
    state.config.rejections[operationPath] = reason;
    return true;
  },
});
