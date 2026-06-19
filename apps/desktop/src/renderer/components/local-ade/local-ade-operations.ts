// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import { subagentSlashCommandName } from "@/components/chat-ui/subagent-command";

interface DiagnosticsLike {
  health?: {
    state?: string;
  };
  cliAvailability?: RuntimeCliLike[];
}

interface RuntimeCliLike {
  id: string;
  displayName?: string;
  command: string;
  available: boolean;
  executablePath?: string;
  version?: string;
  installHint?: string;
  message?: string;
}

interface ProviderLike {
  id: string;
  displayName?: string;
  providerKind?: string;
  compatibleAgents?: string[];
  status?: string;
  readiness?: string;
  cliStatus?: string;
  authStatus?: string;
  modelStatus?: string;
  version?: string;
  remediation?: string[];
}

interface AgentConfigLike {
  id: string;
  name: string;
  type: string;
  command: string;
  args?: string[];
  envKeys?: string[];
  isActive?: boolean;
}

interface McpServerLike {
  enabled: boolean;
  health?: string;
  trustStatus?: string;
  protocol?: {
    status?: string;
  };
  tools?: unknown[];
  resources?: unknown[];
  invocationHistory?: Array<{
    method?: string;
    target?: string;
    status?: string;
    finishedAt?: string;
  }>;
  notificationHistory?: Array<{
    source?: string;
    method?: string;
    receivedAt?: string;
  }>;
}

interface McpAgentRoutingLike {
  status?: string;
  injectableCount?: number;
  conditionalCount?: number;
  blockedCount?: number;
  skippedCount?: number;
  routes?: Array<{
    status?: string;
    reason?: string;
    serverName?: string;
    brokerMode?: string;
    agentInvocationCount?: number;
  }>;
  agentInvocationHistory?: Array<{
    status?: string;
    method?: string;
    target?: string;
  }>;
}

interface ActiveSessionLike {
  id: string;
  projectRoot?: string;
  chatStatus?: string;
  subscriberCount?: number;
  pendingPermissions?: number;
  activeToolCalls?: number;
  agentName?: string;
  sessionId?: string;
  pid?: number;
  model?: {
    currentModelId?: string | null;
    supportsSwitching?: boolean;
    source?: string;
    availableModels?: unknown[];
  };
}

interface CheckpointLike {
  id: string;
  name?: string;
  createdAt?: string;
  changedFiles?: string[];
  patchBytes?: number;
  canRestore?: boolean;
}

interface CheckpointPreviewLike {
  restoreMode?: "reverse-patch" | "apply-patch";
  diffFiles?: Array<{
    path: string;
    status?: string;
    additions?: number;
    deletions?: number;
    truncated?: boolean;
    hunks?: Array<{
      header?: string;
      truncated?: boolean;
      rows?: Array<{
        kind?: string;
        oldLine?: number;
        newLine?: number;
        oldText?: string;
        newText?: string;
      }>;
    }>;
  }>;
  restoreRisks?: Array<{
    file: string;
    level: string;
    patchAction?: string;
    currentStatus?: string;
    reason?: string;
  }>;
  restoreBlockers?: unknown[];
}

interface CheckpointVisualDiffRowLike {
  kind?: string;
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
}

interface AcpActivityLike {
  stats?: {
    total?: number;
    chatCount?: number;
  };
  correlations?: Array<{
    label?: string;
    eventCount?: number;
    latestMessage?: string;
    lastTimestamp?: number;
  }>;
}

interface BackgroundTaskLike {
  name: string;
  running?: boolean;
  successCount?: number;
  failureCount?: number;
  lastStartedAt?: number;
  lastFinishedAt?: number;
  lastDurationMs?: number;
  lastError?: string;
  lastResult?: Record<string, string | number | boolean | null | undefined>;
}

interface BackgroundRunnerLike {
  enabled?: boolean;
  startedAt?: number;
  tickMs?: number;
  tasks?: BackgroundTaskLike[];
}

interface SubagentLike {
  name: string;
  enabled: boolean;
}

interface ProjectMemorySourceLike {
  enabled: boolean;
  exists?: boolean;
}

interface SnapshotLike {
  sessions?: {
    active?: ActiveSessionLike[];
    totalStored?: number | null;
  };
  agents?: {
    activeAgentId?: string | null;
    items?: AgentConfigLike[];
  };
  providers?: ProviderLike[];
  mcp?: {
    servers?: McpServerLike[];
    agentRouting?: McpAgentRoutingLike;
  };
  changeTrust?: {
    isGitRepo?: boolean;
    changedFiles?: string[];
  };
  checkpoints?: {
    items?: CheckpointLike[];
  };
  subagents?: SubagentLike[];
  projectIndex?: {
    indexedAt?: string | null;
    indexedFiles?: number;
    symbols?: unknown[];
    tasks?: unknown[];
  };
  projectMemory?: {
    sources?: ProjectMemorySourceLike[];
  };
  acpActivity?: AcpActivityLike;
  runtime?: {
    background?: BackgroundRunnerLike | null;
  };
}

export interface LocalAdeOperationSummary {
  runtimeState: string;
  activeSessions: number;
  providers: {
    total: number;
    ready: number;
    probeTargets: string[];
  };
  mcp: {
    totalEnabled: number;
    initialized: number;
    failed: number;
    agentInjectable: number;
    agentConditional: number;
    agentBlocked: number;
    agentBrokered: number;
    agentBrokerCalls: number;
  };
  checkpoint: {
    count: number;
    changedFiles: number;
    canCreate: boolean;
  };
  subagentCommand: string | null;
}

export interface LocalAdeBackgroundSummary {
  enabled: boolean;
  started: boolean;
  taskCount: number;
  running: number;
  failed: number;
  succeeded: number;
  pluginBatchDispatch?: {
    status: "running" | "failed" | "success" | "idle";
    successCount: number;
    failureCount: number;
    lastDurationMs?: number;
    dueSchedules?: number;
    dispatchedSchedules?: number;
    failedProjects?: number;
  };
}

export type LocalAdeWorkflowLaneTone =
  | "ready"
  | "warning"
  | "blocked"
  | "idle"
  | "unknown";

export interface LocalAdeWorkflowLane {
  id: "session" | "provider" | "mcp" | "checkpoint" | "context" | "subagent";
  label: string;
  value: string;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
}

export interface LocalAdeWorkspaceFocusItem {
  id: "session" | "checkpoint" | "mcp" | "activity";
  label: string;
  value: string;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
}

export interface LocalAdeWorkspaceFocus {
  title: string;
  subtitle: string;
  items: LocalAdeWorkspaceFocusItem[];
}

export interface LocalAdeCheckpointRestorePlan {
  safeFiles: string[];
  warningFiles: string[];
  blockedFiles: string[];
  restorableSafeFiles: string[];
  shelvableBlockedFiles: string[];
  trackedConflictFiles: string[];
  patchFiles: string[];
  canRestoreAll: boolean;
  canRestoreSelectedSafeFiles: boolean;
  canShelveBlockedFiles: boolean;
  canResolveTrackedConflicts: boolean;
}

export type LocalAdeCheckpointConflictAction =
  | "restore-file"
  | "restore-hunks"
  | "resolve-hunk-choices"
  | "keep-current"
  | "use-restore-side"
  | "shelve-blocker";

export interface LocalAdeCheckpointConflictEditorRow {
  file: string;
  risk: "safe" | "warning" | "blocked" | "unknown";
  patchAction: string;
  currentStatus: string;
  reason: string;
  hasPatch: boolean;
  hunkCount: number;
  selectedFile: boolean;
  selectedHunks: number;
  availableActions: LocalAdeCheckpointConflictAction[];
  recommendedAction:
    | LocalAdeCheckpointConflictAction
    | "choose-conflict-side"
    | "skip"
    | "blocked";
}

export interface LocalAdeCheckpointConflictEditorState {
  rows: LocalAdeCheckpointConflictEditorRow[];
  selectedFileCount: number;
  selectedHunkCount: number;
  trackedConflictCount: number;
  shelvableBlockerCount: number;
  hasMixedChoices: boolean;
}

export type LocalAdeCheckpointMergeTone =
  | "neutral"
  | "current"
  | "restore"
  | "changed"
  | "empty"
  | "meta";

export interface LocalAdeCheckpointVisualMergeCell {
  line?: number;
  text: string;
  tone: LocalAdeCheckpointMergeTone;
}

export interface LocalAdeCheckpointVisualMergeRow {
  rowIndex: number;
  sourceKind: string;
  current: LocalAdeCheckpointVisualMergeCell;
  restore: LocalAdeCheckpointVisualMergeCell;
}

export interface LocalAdeCheckpointVisualMergeHunk {
  file: string;
  hunkIndex: number;
  header: string;
  selected: boolean;
  selectable: boolean;
  truncated: boolean;
  currentChangeRows: number;
  restoreChangeRows: number;
  rows: LocalAdeCheckpointVisualMergeRow[];
}

export interface LocalAdeCheckpointVisualMergeFile {
  path: string;
  status: string;
  risk: "safe" | "warning" | "blocked" | "unknown";
  recommendedAction:
    | LocalAdeCheckpointConflictEditorRow["recommendedAction"]
    | "review";
  selectedFile: boolean;
  selectedHunks: number;
  additions: number;
  deletions: number;
  truncated: boolean;
  hunkCount: number;
  rowCount: number;
  currentChangeRows: number;
  restoreChangeRows: number;
  hunks: LocalAdeCheckpointVisualMergeHunk[];
}

export interface LocalAdeCheckpointVisualMergeState {
  mode: "reverse-patch" | "apply-patch";
  currentLabel: string;
  restoreLabel: string;
  files: LocalAdeCheckpointVisualMergeFile[];
  totalFiles: number;
  totalHunks: number;
  selectedHunks: number;
  currentChangeRows: number;
  restoreChangeRows: number;
}

export type LocalAdeRunActionId =
  | "session"
  | "provider"
  | "mcp"
  | "checkpoint"
  | "index"
  | "memory"
  | "subagent";

export type LocalAdeRunActionKind =
  | "start-session"
  | "probe-providers"
  | "probe-mcp"
  | "create-checkpoint"
  | "refresh-index"
  | "copy-command"
  | "inspect-section";

export interface LocalAdeRunAction {
  id: LocalAdeRunActionId;
  label: string;
  value: string;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
  action: LocalAdeRunActionKind;
  enabled: boolean;
  command?: string;
  targetSection?: string;
}

export type LocalAdeWorkbenchStatus =
  | "running"
  | "ready"
  | "attention"
  | "setup"
  | "unknown";

export interface LocalAdeWorkbenchMetric {
  id: "agent" | "tools" | "changes" | "context";
  label: string;
  value: string;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
}

export interface LocalAdeWorkbenchCommand {
  id: LocalAdeRunActionId;
  label: string;
  command: string;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
}

export interface LocalAdeWorkbenchState {
  status: LocalAdeWorkbenchStatus;
  headline: string;
  detail: string;
  score: string;
  readyCount: number;
  totalCount: number;
  primaryAction: LocalAdeRunAction | null;
  metrics: LocalAdeWorkbenchMetric[];
  commands: LocalAdeWorkbenchCommand[];
}

export interface LocalAdeCommandDeckPanel {
  id: "operation" | "guardrail" | "tooling" | "context";
  label: string;
  value: string;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
}

export interface LocalAdeCommandDeckState {
  status: LocalAdeWorkbenchStatus;
  headline: string;
  detail: string;
  primaryAction: LocalAdeRunAction | null;
  secondaryActions: LocalAdeRunAction[];
  panels: LocalAdeCommandDeckPanel[];
  commands: LocalAdeWorkbenchCommand[];
}

export interface LocalAdeSessionCockpitSession {
  id: string;
  label: string;
  status: string;
  detail: string;
  agent: string;
  model: string;
  subscriberCount: number;
  pendingPermissions: number;
  activeToolCalls: number;
  pid?: number;
  tone: LocalAdeWorkflowLaneTone;
}

export interface LocalAdeSessionCockpitState {
  mode: "active" | "standby";
  headline: string;
  detail: string;
  activeCount: number;
  totalStored: number | null;
  pendingPermissions: number;
  activeToolCalls: number;
  subscribers: number;
  primarySession: LocalAdeSessionCockpitSession | null;
  sessions: LocalAdeSessionCockpitSession[];
  commands: LocalAdeWorkbenchCommand[];
  launchOptions: LocalAdeCommandLaunchOption[];
  agentLaunchTargets: LocalAdeAgentLaunchTarget[];
}

export interface LocalAdeCommandLaunchOption {
  id: LocalAdeRunActionId;
  label: string;
  command: string;
  baseCommand: string;
  argumentHint: string;
  requiresArgument: boolean;
  detail: string;
  tone: LocalAdeWorkflowLaneTone;
}

export type LocalAdeAgentLaunchStatus =
  | "ready"
  | "needs-probe"
  | "missing-cli"
  | "unavailable";

export interface LocalAdeAgentLaunchTarget {
  agentId: string;
  label: string;
  type: string;
  command: string;
  args: string[];
  status: LocalAdeAgentLaunchStatus;
  canStart: boolean;
  isActive: boolean;
  providerId?: string;
  providerStatus?: string;
  providerReadiness?: string;
  cliId?: string;
  cliAvailable: boolean;
  version?: string;
  detail: string;
}

export type LocalAdeCommandLaunchResult =
  | {
      status: "ready";
      text: string;
    }
  | {
      status: "missing-argument";
      message: string;
    };

export function getLocalAdeCommandLaunchOptions(
  commands: LocalAdeWorkbenchCommand[]
): LocalAdeCommandLaunchOption[] {
  return commands.map((command) => {
    const match = command.command.match(/^(.*?)\s+<([^>]+)>\s*$/);
    const baseCommand = (match?.[1] ?? command.command).trim();
    const argumentHint = match?.[2] ?? "optional request";

    return {
      id: command.id,
      label: command.label,
      command: command.command,
      baseCommand,
      argumentHint,
      requiresArgument: Boolean(match),
      detail: command.detail,
      tone: command.tone,
    };
  });
}

export function buildLocalAdeCommandLaunchText(params: {
  option: LocalAdeCommandLaunchOption;
  argument?: string;
}): LocalAdeCommandLaunchResult {
  const argument = params.argument?.trim() ?? "";
  if (params.option.requiresArgument && !argument) {
    return {
      status: "missing-argument",
      message: `Add ${params.option.argumentHint} before running ${params.option.baseCommand}.`,
    };
  }

  return {
    status: "ready",
    text: argument
      ? `${params.option.baseCommand} ${argument}`
      : params.option.baseCommand,
  };
}

function commandToken(value: string | undefined): string {
  const first = (value ?? "").trim().split(/\s+/)[0] ?? "";
  const basename = first.split(/[\\/]/).pop() ?? first;
  return basename.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "");
}

function findCliForAgent(
  agent: AgentConfigLike,
  clis: RuntimeCliLike[]
): RuntimeCliLike | undefined {
  const agentType = agent.type.trim().toLowerCase();
  const agentCommand = commandToken(agent.command);
  return clis.find((cli) => {
    const cliId = cli.id.trim().toLowerCase();
    return (
      cliId === agentType ||
      commandToken(cli.command) === agentCommand ||
      commandToken(cli.executablePath) === agentCommand
    );
  });
}

function findProviderForAgent(
  agent: AgentConfigLike,
  providers: ProviderLike[]
): ProviderLike | undefined {
  const providerId = `provider.agent.${agent.id}`;
  const agentType = agent.type.trim().toLowerCase();
  return (
    providers.find((provider) => provider.id === providerId) ??
    providers.find((provider) =>
      (provider.compatibleAgents ?? []).includes(agent.id)
    ) ??
    providers.find(
      (provider) => provider.providerKind?.trim().toLowerCase() === agentType
    )
  );
}

function providerBlocksSession(provider: ProviderLike | undefined): boolean {
  if (!provider) {
    return false;
  }
  return (
    provider.status === "missing-config" ||
    provider.status === "unavailable" ||
    provider.cliStatus === "missing" ||
    provider.cliStatus === "failed" ||
    provider.readiness === "missing-config" ||
    provider.readiness === "unavailable"
  );
}

function providerNeedsProbe(provider: ProviderLike | undefined): boolean {
  if (!provider) {
    return true;
  }
  return !(
    provider.status === "ready" ||
    provider.readiness === "ready" ||
    (provider.cliStatus === "ok" &&
      provider.authStatus === "ok" &&
      provider.modelStatus === "ok")
  );
}

export function getLocalAdeAgentLaunchMatrix(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeAgentLaunchTarget[] {
  const agents = params.snapshot?.agents?.items ?? [];
  const providers = params.snapshot?.providers ?? [];
  const clis = params.diagnostics?.cliAvailability ?? [];

  const rows = agents.map((agent): LocalAdeAgentLaunchTarget => {
    const provider = findProviderForAgent(agent, providers);
    const cli = findCliForAgent(agent, clis);
    const providerCliOk = provider?.cliStatus === "ok";
    const cliAvailable = cli ? cli.available : providerCliOk;
    const blocked = providerBlocksSession(provider) || !cliAvailable;
    const status: LocalAdeAgentLaunchStatus = blocked
      ? cliAvailable
        ? "unavailable"
        : "missing-cli"
      : providerNeedsProbe(provider)
        ? "needs-probe"
        : "ready";
    const detail =
      status === "ready"
        ? `${agent.command} / provider ready`
        : status === "needs-probe"
          ? `${agent.command} installed / ${provider?.readiness ?? provider?.status ?? "probe pending"}`
          : status === "missing-cli"
            ? (cli?.installHint ??
              provider?.remediation?.[0] ??
              `${agent.command} is not available on PATH`)
            : (provider?.remediation?.[0] ??
              `${agent.command} provider is unavailable`);

    return {
      agentId: agent.id,
      label: agent.name,
      type: agent.type,
      command: agent.command,
      args: agent.args ?? [],
      status,
      canStart: status === "ready" || status === "needs-probe",
      isActive: Boolean(agent.isActive),
      ...(provider ? { providerId: provider.id } : {}),
      ...(provider?.status ? { providerStatus: provider.status } : {}),
      ...(provider?.readiness ? { providerReadiness: provider.readiness } : {}),
      ...(cli ? { cliId: cli.id } : {}),
      cliAvailable,
      ...((cli?.version ?? provider?.version)
        ? { version: cli?.version ?? provider?.version }
        : {}),
      detail,
    };
  });

  const statusRank: Record<LocalAdeAgentLaunchStatus, number> = {
    ready: 0,
    "needs-probe": 1,
    unavailable: 2,
    "missing-cli": 3,
  };
  return rows.sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }
    const statusDelta = statusRank[left.status] - statusRank[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return left.label.localeCompare(right.label);
  });
}

function isProviderReady(provider: ProviderLike): boolean {
  return provider.readiness === "ready" || provider.status === "ready";
}

function canProbeProvider(provider: ProviderLike): boolean {
  return (
    provider.status !== "missing-config" && provider.cliStatus !== "missing"
  );
}

function choosePrimarySubagent(
  subagents: SubagentLike[]
): SubagentLike | undefined {
  const enabled = subagents.filter((item) => item.enabled);
  return (
    enabled.find((item) => item.name === "code-reviewer") ??
    enabled.find((item) => item.name.toLowerCase().includes("review")) ??
    enabled[0]
  );
}

export function getLocalAdeCheckpointRestorePlan(
  preview: CheckpointPreviewLike | null | undefined
): LocalAdeCheckpointRestorePlan {
  const patchFiles = [
    ...new Set(
      (preview?.diffFiles ?? []).map((file) => file.path).filter(Boolean)
    ),
  ].sort((left, right) => left.localeCompare(right));
  const patchFileSet = new Set(patchFiles);
  const safeFiles: string[] = [];
  const warningFiles: string[] = [];
  const blockedFiles: string[] = [];
  const shelvableBlockedFiles: string[] = [];
  const trackedConflictFiles: string[] = [];

  for (const risk of preview?.restoreRisks ?? []) {
    if (!risk.file) {
      continue;
    }
    if (risk.level === "safe") {
      safeFiles.push(risk.file);
    } else if (risk.level === "warning") {
      warningFiles.push(risk.file);
    } else if (risk.level === "blocked") {
      blockedFiles.push(risk.file);
      const reason = risk.reason ?? "";
      const currentStatusLines = (risk.currentStatus ?? "")
        .split(";")
        .map((line) => line.trim())
        .filter(Boolean);
      if (
        risk.patchAction === "unexpected current change" &&
        currentStatusLines.length > 0 &&
        currentStatusLines.every((line) => line.startsWith("?? ")) &&
        reason.includes("not part of the restore precondition")
      ) {
        shelvableBlockedFiles.push(risk.file);
      }
      const trackedStatusLines = (risk.currentStatus ?? "")
        .split(";")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim());
      if (
        reason.includes("Tracked checkpoint patch no longer applies cleanly") &&
        trackedStatusLines.length > 0 &&
        trackedStatusLines.every((line) => line.startsWith(" M "))
      ) {
        trackedConflictFiles.push(risk.file);
      }
    }
  }

  const uniqueSorted = (files: string[]) =>
    [...new Set(files)].sort((left, right) => left.localeCompare(right));
  const sortedSafeFiles = uniqueSorted(safeFiles);
  const restorableSafeFiles = sortedSafeFiles.filter((file) =>
    patchFileSet.has(file)
  );
  const sortedShelvableBlockedFiles = uniqueSorted(shelvableBlockedFiles);
  const sortedTrackedConflictFiles = uniqueSorted(trackedConflictFiles);

  return {
    safeFiles: sortedSafeFiles,
    warningFiles: uniqueSorted(warningFiles),
    blockedFiles: uniqueSorted(blockedFiles),
    restorableSafeFiles,
    shelvableBlockedFiles: sortedShelvableBlockedFiles,
    trackedConflictFiles: sortedTrackedConflictFiles,
    patchFiles,
    canRestoreAll: (preview?.restoreBlockers?.length ?? 0) === 0,
    canRestoreSelectedSafeFiles: restorableSafeFiles.length > 0,
    canShelveBlockedFiles: sortedShelvableBlockedFiles.length > 0,
    canResolveTrackedConflicts: sortedTrackedConflictFiles.length > 0,
  };
}

export function getLocalAdeCheckpointConflictEditorState(params: {
  preview: CheckpointPreviewLike | null | undefined;
  selectedFiles?: string[];
  selectedHunks?: Array<{ file: string; hunkIndex: number }>;
}): LocalAdeCheckpointConflictEditorState {
  const preview = params.preview;
  const plan = getLocalAdeCheckpointRestorePlan(preview);
  const selectedFileSet = new Set(params.selectedFiles ?? []);
  const selectedHunkCounts = new Map<string, number>();
  for (const hunk of params.selectedHunks ?? []) {
    selectedHunkCounts.set(
      hunk.file,
      (selectedHunkCounts.get(hunk.file) ?? 0) + 1
    );
  }
  const patchFiles = new Map(
    (preview?.diffFiles ?? []).map((file) => [
      file.path,
      {
        hasPatch: true,
        hunkCount: file.hunks?.length ?? 0,
      },
    ])
  );
  const riskByFile = new Map(
    (preview?.restoreRisks ?? []).map((risk) => [risk.file, risk])
  );
  const files = [
    ...new Set([
      ...Array.from(patchFiles.keys()),
      ...Array.from(riskByFile.keys()).filter(Boolean),
    ]),
  ].sort((left, right) => left.localeCompare(right));

  const rows = files.map((file): LocalAdeCheckpointConflictEditorRow => {
    const patch = patchFiles.get(file);
    const risk = riskByFile.get(file);
    const isTrackedConflict = plan.trackedConflictFiles.includes(file);
    const canResolveHunkChoices =
      isTrackedConflict &&
      patch?.hasPatch === true &&
      (patch.hunkCount ?? 0) > 1;
    const availableActions: LocalAdeCheckpointConflictAction[] = [];
    if (risk?.level === "safe" && patch?.hasPatch) {
      availableActions.push("restore-file");
      if ((patch.hunkCount ?? 0) > 0) {
        availableActions.push("restore-hunks");
      }
    }
    if (isTrackedConflict) {
      availableActions.push("keep-current", "use-restore-side");
      if (canResolveHunkChoices) {
        availableActions.push("resolve-hunk-choices");
      }
    }
    if (plan.shelvableBlockedFiles.includes(file)) {
      availableActions.push("shelve-blocker");
    }

    const selectedHunks = selectedHunkCounts.get(file) ?? 0;
    const hunkCount = patch?.hunkCount ?? 0;
    const recommendedAction: LocalAdeCheckpointConflictEditorRow["recommendedAction"] =
      isTrackedConflict && selectedHunks > 0 && selectedHunks < hunkCount
        ? "resolve-hunk-choices"
        : isTrackedConflict && selectedHunks > 0
          ? "use-restore-side"
          : selectedHunks > 0
            ? "restore-hunks"
            : selectedFileSet.has(file)
              ? "restore-file"
              : isTrackedConflict
                ? "choose-conflict-side"
                : plan.shelvableBlockedFiles.includes(file)
                  ? "shelve-blocker"
                  : risk?.level === "safe" && patch?.hasPatch
                    ? "restore-file"
                    : risk?.level === "blocked"
                      ? "blocked"
                      : "skip";

    return {
      file,
      risk:
        risk?.level === "safe" ||
        risk?.level === "warning" ||
        risk?.level === "blocked"
          ? risk.level
          : "unknown",
      patchAction: risk?.patchAction ?? "none",
      currentStatus: risk?.currentStatus ?? "clean",
      reason: risk?.reason ?? "",
      hasPatch: patch?.hasPatch ?? false,
      hunkCount: patch?.hunkCount ?? 0,
      selectedFile: selectedFileSet.has(file),
      selectedHunks,
      availableActions,
      recommendedAction,
    };
  });

  return {
    rows,
    selectedFileCount: selectedFileSet.size,
    selectedHunkCount: Array.from(selectedHunkCounts.values()).reduce(
      (total, count) => total + count,
      0
    ),
    trackedConflictCount: plan.trackedConflictFiles.length,
    shelvableBlockerCount: plan.shelvableBlockedFiles.length,
    hasMixedChoices:
      plan.trackedConflictFiles.length > 0 ||
      plan.shelvableBlockedFiles.length > 0 ||
      selectedFileSet.size > 0 ||
      selectedHunkCounts.size > 0,
  };
}

function checkpointMergeCell(params: {
  line?: number;
  text?: string;
  tone: LocalAdeCheckpointMergeTone;
}): LocalAdeCheckpointVisualMergeCell {
  return {
    ...(typeof params.line === "number" ? { line: params.line } : {}),
    text: params.text ?? "",
    tone: params.text ? params.tone : params.tone === "meta" ? "meta" : "empty",
  };
}

function checkpointVisualMergeRow(params: {
  rowIndex: number;
  row: CheckpointVisualDiffRowLike;
  mode: "reverse-patch" | "apply-patch";
}): LocalAdeCheckpointVisualMergeRow {
  const row = params.row ?? {};
  const kind = typeof row.kind === "string" ? row.kind : "context";
  const oldCell = {
    line: row.oldLine,
    text: row.oldText,
  };
  const newCell = {
    line: row.newLine,
    text: row.newText,
  };

  if (kind === "meta") {
    return {
      rowIndex: params.rowIndex,
      sourceKind: kind,
      current: checkpointMergeCell({
        text: oldCell.text ?? newCell.text,
        tone: "meta",
      }),
      restore: checkpointMergeCell({
        text: oldCell.text ?? newCell.text,
        tone: "meta",
      }),
    };
  }

  const currentSource = params.mode === "apply-patch" ? oldCell : newCell;
  const restoreSource = params.mode === "apply-patch" ? newCell : oldCell;
  const isChanged = kind === "change";
  const isContext = kind === "context";

  return {
    rowIndex: params.rowIndex,
    sourceKind: kind,
    current: checkpointMergeCell({
      line: currentSource.line,
      text: currentSource.text,
      tone: isContext ? "neutral" : isChanged ? "changed" : "current",
    }),
    restore: checkpointMergeCell({
      line: restoreSource.line,
      text: restoreSource.text,
      tone: isContext ? "neutral" : isChanged ? "changed" : "restore",
    }),
  };
}

export function getLocalAdeCheckpointVisualMergeState(params: {
  preview: CheckpointPreviewLike | null | undefined;
  selectedFiles?: string[];
  selectedHunks?: Array<{ file: string; hunkIndex: number }>;
}): LocalAdeCheckpointVisualMergeState {
  const mode = params.preview?.restoreMode ?? "reverse-patch";
  const selectedFileSet = new Set(params.selectedFiles ?? []);
  const selectedHunkKeys = new Set(
    (params.selectedHunks ?? []).map((hunk) => `${hunk.file}:${hunk.hunkIndex}`)
  );
  const editor = getLocalAdeCheckpointConflictEditorState(params);
  const editorByFile = new Map(editor.rows.map((row) => [row.file, row]));
  const riskByFile = new Map(
    (params.preview?.restoreRisks ?? []).map((risk) => [risk.file, risk])
  );
  const files = (params.preview?.diffFiles ?? []).map(
    (file): LocalAdeCheckpointVisualMergeFile => {
      const editorRow = editorByFile.get(file.path);
      const hunks = (file.hunks ?? []).map(
        (hunk, hunkIndex): LocalAdeCheckpointVisualMergeHunk => {
          const rows = (hunk.rows ?? []).map((row, rowIndex) =>
            checkpointVisualMergeRow({ row, rowIndex, mode })
          );
          const currentChangeRows = rows.filter(
            (row) =>
              row.current.tone === "current" || row.current.tone === "changed"
          ).length;
          const restoreChangeRows = rows.filter(
            (row) =>
              row.restore.tone === "restore" || row.restore.tone === "changed"
          ).length;
          const key = `${file.path}:${hunkIndex}`;
          return {
            file: file.path,
            hunkIndex,
            header: hunk.header ?? `Hunk ${hunkIndex + 1}`,
            selected: selectedHunkKeys.has(key),
            selectable:
              editorRow?.availableActions.includes("restore-hunks") === true ||
              editorRow?.availableActions.includes("resolve-hunk-choices") ===
                true,
            truncated: hunk.truncated === true,
            currentChangeRows,
            restoreChangeRows,
            rows,
          };
        }
      );
      const rowCount = hunks.reduce(
        (total, hunk) => total + hunk.rows.length,
        0
      );
      const currentChangeRows = hunks.reduce(
        (total, hunk) => total + hunk.currentChangeRows,
        0
      );
      const restoreChangeRows = hunks.reduce(
        (total, hunk) => total + hunk.restoreChangeRows,
        0
      );
      const risk = riskByFile.get(file.path);
      return {
        path: file.path,
        status: file.status ?? "unknown",
        risk:
          risk?.level === "safe" ||
          risk?.level === "warning" ||
          risk?.level === "blocked"
            ? risk.level
            : "unknown",
        recommendedAction: editorRow?.recommendedAction ?? "review",
        selectedFile: selectedFileSet.has(file.path),
        selectedHunks: hunks.filter((hunk) => hunk.selected).length,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        truncated: file.truncated === true,
        hunkCount: hunks.length,
        rowCount,
        currentChangeRows,
        restoreChangeRows,
        hunks,
      };
    }
  );

  return {
    mode,
    currentLabel:
      mode === "apply-patch" ? "Current baseline" : "Current workspace",
    restoreLabel: mode === "apply-patch" ? "Restore target" : "Checkpoint side",
    files,
    totalFiles: files.length,
    totalHunks: files.reduce((total, file) => total + file.hunkCount, 0),
    selectedHunks: files.reduce((total, file) => total + file.selectedHunks, 0),
    currentChangeRows: files.reduce(
      (total, file) => total + file.currentChangeRows,
      0
    ),
    restoreChangeRows: files.reduce(
      (total, file) => total + file.restoreChangeRows,
      0
    ),
  };
}

export function getLocalAdeOperationSummary(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeOperationSummary {
  const providers = params.snapshot?.providers ?? [];
  const mcpServers = params.snapshot?.mcp?.servers ?? [];
  const agentRouting = params.snapshot?.mcp?.agentRouting;
  const enabledMcpServers = mcpServers.filter((server) => server.enabled);
  const failedMcpServers = enabledMcpServers.filter(
    (server) =>
      server.protocol?.status === "failed" ||
      server.health === "unavailable" ||
      server.health === "invalid-config"
  );
  const primarySubagent = choosePrimarySubagent(
    params.snapshot?.subagents ?? []
  );
  const changedFiles = params.snapshot?.changeTrust?.changedFiles?.length ?? 0;

  return {
    runtimeState: params.diagnostics?.health?.state ?? "unknown",
    activeSessions: params.snapshot?.sessions?.active?.length ?? 0,
    providers: {
      total: providers.length,
      ready: providers.filter(isProviderReady).length,
      probeTargets: providers
        .filter(canProbeProvider)
        .map((provider) => provider.id),
    },
    mcp: {
      totalEnabled: enabledMcpServers.length,
      initialized: enabledMcpServers.filter(
        (server) => server.protocol?.status === "initialized"
      ).length,
      failed: failedMcpServers.length,
      agentInjectable: agentRouting?.injectableCount ?? 0,
      agentConditional: agentRouting?.conditionalCount ?? 0,
      agentBlocked: agentRouting?.blockedCount ?? 0,
      agentBrokered:
        agentRouting?.routes?.filter(
          (route) => route.brokerMode === "stdio-proxy"
        ).length ?? 0,
      agentBrokerCalls: agentRouting?.agentInvocationHistory?.length ?? 0,
    },
    checkpoint: {
      count: params.snapshot?.checkpoints?.items?.length ?? 0,
      changedFiles,
      canCreate: Boolean(params.snapshot?.changeTrust?.isGitRepo),
    },
    subagentCommand: primarySubagent
      ? `/${subagentSlashCommandName(primarySubagent.name)}`
      : null,
  };
}

function runtimeIsReady(state: string): boolean {
  return state === "ready" || state === "available" || state === "ok";
}

function numberResult(
  result:
    | Record<string, string | number | boolean | null | undefined>
    | undefined,
  key: string
): number | undefined {
  const value = result?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function getLocalAdeBackgroundSummary(
  snapshot?: SnapshotLike | null
): LocalAdeBackgroundSummary {
  const background = snapshot?.runtime?.background;
  const tasks = background?.tasks ?? [];
  const pluginBatchDispatch = tasks.find(
    (task) => task.name === "plugin-batch-schedule-dispatch"
  );
  const pluginBatchStatus = pluginBatchDispatch?.running
    ? "running"
    : (pluginBatchDispatch?.failureCount ?? 0) > 0
      ? "failed"
      : (pluginBatchDispatch?.successCount ?? 0) > 0
        ? "success"
        : "idle";
  const dueSchedules = numberResult(
    pluginBatchDispatch?.lastResult,
    "dueSchedules"
  );
  const dispatchedSchedules = numberResult(
    pluginBatchDispatch?.lastResult,
    "dispatchedSchedules"
  );
  const failedProjects = numberResult(
    pluginBatchDispatch?.lastResult,
    "failedProjects"
  );

  return {
    enabled: background?.enabled ?? false,
    started: typeof background?.startedAt === "number",
    taskCount: tasks.length,
    running: tasks.filter((task) => task.running).length,
    failed: tasks.filter((task) => (task.failureCount ?? 0) > 0).length,
    succeeded: tasks.filter((task) => (task.successCount ?? 0) > 0).length,
    ...(pluginBatchDispatch
      ? {
          pluginBatchDispatch: {
            status: pluginBatchStatus,
            successCount: pluginBatchDispatch.successCount ?? 0,
            failureCount: pluginBatchDispatch.failureCount ?? 0,
            ...(typeof pluginBatchDispatch.lastDurationMs === "number"
              ? { lastDurationMs: pluginBatchDispatch.lastDurationMs }
              : {}),
            ...(dueSchedules !== undefined ? { dueSchedules } : {}),
            ...(dispatchedSchedules !== undefined
              ? { dispatchedSchedules }
              : {}),
            ...(failedProjects !== undefined ? { failedProjects } : {}),
          },
        }
      : {}),
  };
}

function shortFocusId(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }
  return value.length > 10 ? `${value.slice(0, 7)}...` : value;
}

function latestByTimestamp<T>(
  items: T[],
  timestamp: (item: T) => string | number | undefined
): T | undefined {
  return [...items].sort((left, right) => {
    const leftTime = new Date(timestamp(left) ?? 0).getTime();
    const rightTime = new Date(timestamp(right) ?? 0).getTime();
    return rightTime - leftTime;
  })[0];
}

export function getLocalAdeWorkspaceFocus(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeWorkspaceFocus {
  const summary = getLocalAdeOperationSummary(params);
  const activeSession = params.snapshot?.sessions?.active?.[0];
  const changedFiles = params.snapshot?.changeTrust?.changedFiles ?? [];
  const checkpoints = params.snapshot?.checkpoints?.items ?? [];
  const latestCheckpoint = latestByTimestamp(
    checkpoints,
    (item) => item.createdAt
  );
  const mcpServers = params.snapshot?.mcp?.servers ?? [];
  const enabledMcpServers = mcpServers.filter((server) => server.enabled);
  const latestMcpNotification = latestByTimestamp(
    enabledMcpServers.flatMap((server) => server.notificationHistory ?? []),
    (item) => item.receivedAt
  );
  const latestMcpInvocation = latestByTimestamp(
    enabledMcpServers.flatMap((server) => server.invocationHistory ?? []),
    (item) => item.finishedAt
  );
  const untrustedMcpServer = enabledMcpServers.find(
    (server) =>
      server.protocol?.status === "initialized" &&
      server.trustStatus !== undefined &&
      server.trustStatus !== "trusted" &&
      ((server.tools?.length ?? 0) > 0 || (server.resources?.length ?? 0) > 0)
  );
  const latestCorrelation = latestByTimestamp(
    params.snapshot?.acpActivity?.correlations ?? [],
    (item) => item.lastTimestamp
  );

  const sessionDetail = activeSession
    ? [
        `chat ${shortFocusId(activeSession.id)}`,
        activeSession.sessionId
          ? `agent ${shortFocusId(activeSession.sessionId)}`
          : undefined,
        (activeSession.pendingPermissions ?? 0) > 0
          ? `${activeSession.pendingPermissions} permission(s)`
          : undefined,
        (activeSession.activeToolCalls ?? 0) > 0
          ? `${activeSession.activeToolCalls} tool call(s)`
          : undefined,
        `${activeSession.subscriberCount ?? 0} subscriber(s)`,
      ]
        .filter(Boolean)
        .join(" / ")
    : runtimeIsReady(summary.runtimeState)
      ? "start a desktop-service session"
      : "runtime needs attention before work";

  const routableMcpCount =
    summary.mcp.agentInjectable + summary.mcp.agentConditional;
  const mcpDetail =
    summary.mcp.totalEnabled === 0
      ? "no enabled MCP server"
      : summary.mcp.agentBlocked > 0
        ? `${summary.mcp.agentBlocked} agent route(s) blocked`
        : untrustedMcpServer
          ? `${untrustedMcpServer.protocol?.status ?? "not-run"} but trust required`
          : routableMcpCount > 0
            ? `${summary.mcp.agentBrokered} brokered / ${summary.mcp.agentConditional} conditional agent route(s)`
            : latestMcpNotification
              ? `${latestMcpNotification.source ?? "server"} ${latestMcpNotification.method ?? "notification"}`
              : latestMcpInvocation
                ? `${latestMcpInvocation.method ?? "invoke"} ${latestMcpInvocation.status ?? "unknown"}`
                : `${summary.mcp.initialized}/${summary.mcp.totalEnabled} initialized`;

  return {
    title: activeSession ? "Active Workspace" : "Workspace Standby",
    subtitle: activeSession
      ? `${activeSession.agentName ?? "agent"} / ${activeSession.chatStatus ?? "running"}`
      : "No active agent session",
    items: [
      {
        id: "session",
        label: "Session",
        value: activeSession
          ? (activeSession.chatStatus ?? "running")
          : runtimeIsReady(summary.runtimeState)
            ? "ready"
            : summary.runtimeState,
        detail: sessionDetail,
        tone: activeSession
          ? (activeSession.pendingPermissions ?? 0) > 0
            ? "warning"
            : "ready"
          : runtimeIsReady(summary.runtimeState)
            ? "idle"
            : summary.runtimeState === "unknown"
              ? "unknown"
              : "warning",
      },
      {
        id: "checkpoint",
        label: "Change Set",
        value: params.snapshot?.changeTrust?.isGitRepo
          ? `${changedFiles.length} changed`
          : "not git",
        detail:
          changedFiles.length > 0
            ? "checkpoint before risky restore or agent edits"
            : latestCheckpoint
              ? `${latestCheckpoint.name ?? latestCheckpoint.id} / ${
                  latestCheckpoint.changedFiles?.length ?? 0
                } file(s)`
              : "no pending tracked change",
        tone: params.snapshot?.changeTrust?.isGitRepo
          ? changedFiles.length > 0
            ? "warning"
            : "ready"
          : "blocked",
      },
      {
        id: "mcp",
        label: "MCP Signal",
        value:
          summary.mcp.totalEnabled === 0
            ? "disabled"
            : `${summary.mcp.initialized}/${summary.mcp.totalEnabled}`,
        detail: mcpDetail,
        tone:
          summary.mcp.totalEnabled === 0
            ? "idle"
            : untrustedMcpServer ||
                summary.mcp.failed > 0 ||
                summary.mcp.agentBlocked > 0
              ? "warning"
              : summary.mcp.initialized === summary.mcp.totalEnabled
                ? "ready"
                : "warning",
      },
      {
        id: "activity",
        label: "ACP Activity",
        value: `${params.snapshot?.acpActivity?.stats?.total ?? 0} events`,
        detail: latestCorrelation
          ? `${latestCorrelation.label ?? "correlation"} / ${
              latestCorrelation.eventCount ?? 0
            } event(s)`
          : `${params.snapshot?.acpActivity?.stats?.chatCount ?? 0} active chat(s)`,
        tone:
          (params.snapshot?.acpActivity?.stats?.total ?? 0) > 0
            ? "ready"
            : "idle",
      },
    ],
  };
}

export function getLocalAdeRunActions(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeRunAction[] {
  const summary = getLocalAdeOperationSummary(params);
  const activeSession = params.snapshot?.sessions?.active?.[0];
  const providersReady =
    summary.providers.total > 0 &&
    summary.providers.ready === summary.providers.total;
  const enabledMcpServers =
    params.snapshot?.mcp?.servers?.filter((server) => server.enabled) ?? [];
  const mcpHasRunnableSurface = enabledMcpServers.some(
    (server) =>
      server.protocol?.status === "initialized" &&
      server.trustStatus === "trusted" &&
      ((server.tools?.length ?? 0) > 0 || (server.resources?.length ?? 0) > 0)
  );
  const mcpNeedsProbe =
    summary.mcp.totalEnabled > 0 &&
    (summary.mcp.failed > 0 ||
      summary.mcp.initialized < summary.mcp.totalEnabled);
  const mcpRouteAttention = summary.mcp.agentBlocked > 0;
  const indexReady = Boolean(params.snapshot?.projectIndex?.indexedAt);
  const memorySources = params.snapshot?.projectMemory?.sources ?? [];
  const enabledMemorySources = memorySources.filter(
    (source) => source.enabled
  ).length;
  const runtimeReady = runtimeIsReady(summary.runtimeState);

  return [
    {
      id: "session",
      label: activeSession ? "Inspect Session" : "Start Session",
      value:
        activeSession?.chatStatus ??
        (runtimeReady ? "ready" : summary.runtimeState),
      detail: activeSession
        ? `${activeSession.agentName ?? "agent"} / chat ${shortFocusId(activeSession.id)}`
        : "open a local desktop-service agent loop",
      tone: activeSession ? "ready" : runtimeReady ? "idle" : "warning",
      action: activeSession ? "inspect-section" : "start-session",
      enabled: activeSession ? true : runtimeReady,
      targetSection: "local-ade-runtime",
    },
    {
      id: "provider",
      label:
        summary.providers.total === 0
          ? "Configure Providers"
          : providersReady
            ? "Inspect Providers"
            : "Probe Providers",
      value:
        summary.providers.total === 0
          ? "none"
          : `${summary.providers.ready}/${summary.providers.total}`,
      detail:
        summary.providers.total === 0
          ? "add an agent provider before probing"
          : providersReady
            ? "CLI, auth, and model are classified"
            : "run readiness probes for configured CLIs",
      tone:
        summary.providers.total === 0
          ? "blocked"
          : providersReady
            ? "ready"
            : "warning",
      action:
        summary.providers.total === 0 || providersReady
          ? "inspect-section"
          : "probe-providers",
      enabled:
        summary.providers.total === 0 ||
        providersReady ||
        summary.providers.probeTargets.length > 0,
      targetSection: "local-ade-providers",
    },
    {
      id: "mcp",
      label:
        summary.mcp.totalEnabled === 0
          ? "Configure MCP"
          : mcpNeedsProbe
            ? "Probe MCP"
            : mcpHasRunnableSurface
              ? "Run MCP Tool"
              : "Inspect MCP",
      value:
        summary.mcp.totalEnabled === 0
          ? "disabled"
          : `${summary.mcp.initialized}/${summary.mcp.totalEnabled}`,
      detail:
        summary.mcp.totalEnabled === 0
          ? "add or enable a server"
          : mcpRouteAttention
            ? `${summary.mcp.agentBlocked} agent route(s) need trust or config`
            : mcpHasRunnableSurface
              ? summary.mcp.agentBrokerCalls > 0
                ? `${summary.mcp.agentBrokerCalls} brokered agent MCP call(s)`
                : "trusted tools/resources are available"
              : mcpNeedsProbe
                ? "initialize servers and discover tools"
                : "review trust before invocation",
      tone:
        summary.mcp.totalEnabled === 0
          ? "idle"
          : mcpNeedsProbe || mcpRouteAttention
            ? "warning"
            : mcpHasRunnableSurface
              ? "ready"
              : "warning",
      action: mcpNeedsProbe ? "probe-mcp" : "inspect-section",
      enabled: true,
      targetSection: "local-ade-mcp",
    },
    {
      id: "checkpoint",
      label: summary.checkpoint.canCreate
        ? summary.checkpoint.changedFiles > 0
          ? "Capture Checkpoint"
          : "Review Checkpoints"
        : "Inspect Changes",
      value: summary.checkpoint.canCreate
        ? `${summary.checkpoint.changedFiles} changed`
        : "not git",
      detail: summary.checkpoint.canCreate
        ? `${summary.checkpoint.count} saved checkpoint(s)`
        : "restore requires a git-backed workspace",
      tone: summary.checkpoint.canCreate
        ? summary.checkpoint.changedFiles > 0
          ? "warning"
          : "ready"
        : "blocked",
      action:
        summary.checkpoint.canCreate && summary.checkpoint.changedFiles > 0
          ? "create-checkpoint"
          : "inspect-section",
      enabled: true,
      targetSection: "local-ade-change-trust",
    },
    {
      id: "index",
      label: indexReady ? "Copy /index" : "Refresh Index",
      value: indexReady
        ? `${params.snapshot?.projectIndex?.indexedFiles ?? 0} files`
        : "stale",
      detail: indexReady
        ? "send ranked repo context from chat"
        : "build metadata for chat context",
      tone: indexReady ? "ready" : "idle",
      action: indexReady ? "copy-command" : "refresh-index",
      enabled: true,
      command: indexReady ? "/index <query>" : undefined,
      targetSection: "local-ade-project-index",
    },
    {
      id: "memory",
      label:
        enabledMemorySources > 0
          ? "Copy /memory"
          : memorySources.length > 0
            ? "Enable Memory"
            : "Add Memory",
      value:
        enabledMemorySources > 0
          ? `${enabledMemorySources} source${enabledMemorySources === 1 ? "" : "s"}`
          : memorySources.length > 0
            ? "disabled"
            : "none",
      detail:
        enabledMemorySources > 0
          ? "send enabled project guidance from chat"
          : memorySources.length > 0
            ? "memory exists but is disabled"
            : "add AGENTS.md or .eragear/memory.md",
      tone:
        enabledMemorySources > 0
          ? "ready"
          : memorySources.length > 0
            ? "warning"
            : "idle",
      action: enabledMemorySources > 0 ? "copy-command" : "inspect-section",
      enabled: true,
      command: enabledMemorySources > 0 ? "/memory <request>" : undefined,
      targetSection: "local-ade-change-trust",
    },
    {
      id: "subagent",
      label: summary.subagentCommand ? "Copy Subagent" : "Configure Subagent",
      value: summary.subagentCommand ?? "none",
      detail: summary.subagentCommand
        ? "manual delegated prompt path"
        : "enable a project subagent descriptor",
      tone: summary.subagentCommand ? "ready" : "idle",
      action: summary.subagentCommand ? "copy-command" : "inspect-section",
      enabled: true,
      command: summary.subagentCommand ?? undefined,
      targetSection: summary.subagentCommand
        ? undefined
        : "local-ade-capabilities",
    },
  ];
}

function chooseWorkbenchPrimaryAction(
  actions: LocalAdeRunAction[],
  summary: LocalAdeOperationSummary,
  snapshot?: SnapshotLike | null
): LocalAdeRunAction | null {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const changedFiles = summary.checkpoint.changedFiles;
  const indexReady = Boolean(snapshot?.projectIndex?.indexedAt);
  const hasActiveSession = summary.activeSessions > 0;
  const orderedIds: LocalAdeRunActionId[] = [];

  if (
    summary.providers.total === 0 ||
    summary.providers.ready < summary.providers.total
  ) {
    orderedIds.push("provider");
  }
  if (changedFiles > 0) {
    orderedIds.push("checkpoint");
  }
  if (summary.mcp.failed > 0 || summary.mcp.agentBlocked > 0) {
    orderedIds.push("mcp");
  }
  if (!indexReady) {
    orderedIds.push("index");
  }
  orderedIds.push(hasActiveSession ? "session" : "session");
  orderedIds.push("mcp", "memory", "subagent", "checkpoint");

  for (const id of orderedIds) {
    const action = byId.get(id);
    if (action?.enabled) {
      return action;
    }
  }

  return actions.find((action) => action.enabled) ?? null;
}

export function getLocalAdeWorkbenchState(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeWorkbenchState {
  const summary = getLocalAdeOperationSummary(params);
  const lanes = getLocalAdeWorkflowLanes(params);
  const actions = getLocalAdeRunActions(params);
  const activeSession = params.snapshot?.sessions?.active?.[0];
  const readyCount = lanes.filter((lane) => lane.tone === "ready").length;
  const totalCount = lanes.length;
  const warningCount = lanes.filter((lane) => lane.tone === "warning").length;
  const blockedCount = lanes.filter((lane) => lane.tone === "blocked").length;
  const runtimeReady = runtimeIsReady(summary.runtimeState);
  const indexReady = Boolean(params.snapshot?.projectIndex?.indexedAt);
  const enabledMemorySources =
    params.snapshot?.projectMemory?.sources?.filter((source) => source.enabled)
      .length ?? 0;
  const status: LocalAdeWorkbenchStatus = activeSession
    ? "running"
    : summary.runtimeState === "unknown" && !params.snapshot
      ? "unknown"
      : !runtimeReady || summary.providers.total === 0
        ? "setup"
        : warningCount > 0 || blockedCount > 0
          ? "attention"
          : "ready";
  const headline =
    status === "running"
      ? "Session running"
      : status === "ready"
        ? "Ready for local agent work"
        : status === "attention"
          ? "Review workflow warnings"
          : status === "setup"
            ? "Setup required"
            : "Runtime state unknown";
  const detail =
    status === "running"
      ? `${activeSession?.agentName ?? "agent"} / ${activeSession?.chatStatus ?? "running"}`
      : `${readyCount}/${totalCount} lanes ready, ${warningCount} warning, ${blockedCount} blocked`;

  const sessionLane = lanes.find((lane) => lane.id === "session");
  const mcpLane = lanes.find((lane) => lane.id === "mcp");
  const checkpointLane = lanes.find((lane) => lane.id === "checkpoint");
  const contextLane = lanes.find((lane) => lane.id === "context");
  const copyCommands = actions
    .filter((action) => action.action === "copy-command" && action.command)
    .slice(0, 3)
    .map((action) => ({
      id: action.id,
      label: action.label.replace(/^Copy\s+/, ""),
      command: action.command ?? "",
      detail: action.detail,
      tone: action.tone,
    }));

  return {
    status,
    headline,
    detail,
    score: `${readyCount}/${totalCount} ready`,
    readyCount,
    totalCount,
    primaryAction: chooseWorkbenchPrimaryAction(
      actions,
      summary,
      params.snapshot
    ),
    metrics: [
      {
        id: "agent",
        label: "Agent",
        value:
          summary.activeSessions > 0
            ? `${summary.activeSessions} active`
            : runtimeReady
              ? "standby"
              : summary.runtimeState,
        detail: sessionLane?.detail ?? "runtime not reported",
        tone: sessionLane?.tone ?? "unknown",
      },
      {
        id: "tools",
        label: "Tools",
        value:
          summary.mcp.totalEnabled === 0
            ? "no MCP"
            : `${summary.mcp.initialized}/${summary.mcp.totalEnabled}`,
        detail: mcpLane?.detail ?? "no tool route",
        tone: mcpLane?.tone ?? "idle",
      },
      {
        id: "changes",
        label: "Changes",
        value: summary.checkpoint.canCreate
          ? `${summary.checkpoint.changedFiles} changed`
          : "not git",
        detail: checkpointLane?.detail ?? "checkpoint unavailable",
        tone: checkpointLane?.tone ?? "unknown",
      },
      {
        id: "context",
        label: "Context",
        value: indexReady
          ? `${params.snapshot?.projectIndex?.indexedFiles ?? 0} indexed`
          : enabledMemorySources > 0
            ? `${enabledMemorySources} memory`
            : "stale",
        detail: contextLane?.detail ?? "project context not loaded",
        tone: contextLane?.tone ?? "idle",
      },
    ],
    commands: copyCommands,
  };
}

function workbenchStatusTone(
  status: LocalAdeWorkbenchStatus
): LocalAdeWorkflowLaneTone {
  if (status === "running" || status === "ready") {
    return "ready";
  }
  if (status === "attention" || status === "setup") {
    return "warning";
  }
  return "unknown";
}

export function getLocalAdeCommandDeckState(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeCommandDeckState {
  const workbench = getLocalAdeWorkbenchState(params);
  const focus = getLocalAdeWorkspaceFocus(params);
  const actions = getLocalAdeRunActions(params);
  const summary = getLocalAdeOperationSummary(params);
  const primaryAction = workbench.primaryAction;
  const sessionPanel = focus.items.find((item) => item.id === "session");
  const checkpointPanel = focus.items.find((item) => item.id === "checkpoint");
  const mcpPanel = focus.items.find((item) => item.id === "mcp");
  const contextMetric = workbench.metrics.find(
    (metric) => metric.id === "context"
  );
  const secondaryActions = actions
    .filter((action) => action.enabled && action.id !== primaryAction?.id)
    .filter(
      (action) =>
        action.action === "copy-command" ||
        action.action === "inspect-section" ||
        action.action === "probe-mcp" ||
        action.action === "probe-providers" ||
        action.action === "refresh-index" ||
        action.action === "start-session"
    )
    .slice(0, 4);

  return {
    status: workbench.status,
    headline: workbench.headline,
    detail: `${workbench.score} / ${summary.activeSessions} active session${
      summary.activeSessions === 1 ? "" : "s"
    }`,
    primaryAction,
    secondaryActions,
    panels: [
      {
        id: "operation",
        label: "Operation",
        value: sessionPanel?.value ?? workbench.status,
        detail: sessionPanel?.detail ?? workbench.detail,
        tone: sessionPanel?.tone ?? workbenchStatusTone(workbench.status),
      },
      {
        id: "guardrail",
        label: "Guardrail",
        value: checkpointPanel?.value ?? "unknown",
        detail: checkpointPanel?.detail ?? "checkpoint state unavailable",
        tone: checkpointPanel?.tone ?? "unknown",
      },
      {
        id: "tooling",
        label: "Tooling",
        value: mcpPanel?.value ?? "unknown",
        detail: mcpPanel?.detail ?? "MCP state unavailable",
        tone: mcpPanel?.tone ?? "unknown",
      },
      {
        id: "context",
        label: "Context",
        value: contextMetric?.value ?? "unknown",
        detail: contextMetric?.detail ?? "project context not loaded",
        tone: contextMetric?.tone ?? "unknown",
      },
    ],
    commands: workbench.commands,
  };
}

function sessionCockpitTone(
  session: ActiveSessionLike | undefined
): LocalAdeWorkflowLaneTone {
  if (!session) {
    return "idle";
  }
  if ((session.pendingPermissions ?? 0) > 0) {
    return "warning";
  }
  if (
    (session.activeToolCalls ?? 0) > 0 ||
    session.chatStatus === "running" ||
    session.chatStatus === "streaming" ||
    session.chatStatus === "connected"
  ) {
    return "ready";
  }
  if (session.chatStatus === "error" || session.chatStatus === "stopped") {
    return "blocked";
  }
  return "idle";
}

function toSessionCockpitSession(
  session: ActiveSessionLike
): LocalAdeSessionCockpitSession {
  const model = session.model?.currentModelId ?? "default model";
  const agentSession = session.sessionId
    ? `agent ${shortFocusId(session.sessionId)}`
    : "agent session pending";
  const pid =
    typeof session.pid === "number" ? `pid ${session.pid}` : "pid n/a";
  const detailParts = [`chat ${shortFocusId(session.id)}`, agentSession, pid];

  return {
    id: session.id,
    label: session.agentName ?? "Agent session",
    status: session.chatStatus ?? "running",
    detail: detailParts.join(" / "),
    agent: session.agentName ?? "agent",
    model,
    subscriberCount: session.subscriberCount ?? 0,
    pendingPermissions: session.pendingPermissions ?? 0,
    activeToolCalls: session.activeToolCalls ?? 0,
    ...(typeof session.pid === "number" ? { pid: session.pid } : {}),
    tone: sessionCockpitTone(session),
  };
}

export function getLocalAdeSessionCockpitState(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeSessionCockpitState {
  const sessions = (params.snapshot?.sessions?.active ?? [])
    .map(toSessionCockpitSession)
    .sort((left, right) => {
      const leftAttention = left.pendingPermissions * 10 + left.activeToolCalls;
      const rightAttention =
        right.pendingPermissions * 10 + right.activeToolCalls;
      return rightAttention - leftAttention;
    });
  const summary = getLocalAdeOperationSummary(params);
  const commands = getLocalAdeCommandDeckState(params).commands;
  const agentLaunchTargets = getLocalAdeAgentLaunchMatrix(params);
  const pendingPermissions = sessions.reduce(
    (total, session) => total + session.pendingPermissions,
    0
  );
  const activeToolCalls = sessions.reduce(
    (total, session) => total + session.activeToolCalls,
    0
  );
  const subscribers = sessions.reduce(
    (total, session) => total + session.subscriberCount,
    0
  );
  const primarySession = sessions[0] ?? null;
  const runtimeReady = runtimeIsReady(summary.runtimeState);

  return {
    mode: sessions.length > 0 ? "active" : "standby",
    headline:
      sessions.length > 0
        ? "Active agent cockpit"
        : runtimeReady
          ? "Session cockpit standby"
          : "Session cockpit unavailable",
    detail:
      sessions.length > 0
        ? `${sessions.length} active / ${pendingPermissions} permission / ${activeToolCalls} tool call`
        : runtimeReady
          ? "Start a desktop-service agent loop from this workspace."
          : `Runtime state: ${summary.runtimeState}`,
    activeCount: sessions.length,
    totalStored: params.snapshot?.sessions?.totalStored ?? null,
    pendingPermissions,
    activeToolCalls,
    subscribers,
    primarySession,
    sessions,
    commands,
    launchOptions: getLocalAdeCommandLaunchOptions(commands),
    agentLaunchTargets,
  };
}

export function getLocalAdeWorkflowLanes(params: {
  diagnostics?: DiagnosticsLike | null;
  snapshot?: SnapshotLike | null;
}): LocalAdeWorkflowLane[] {
  const summary = getLocalAdeOperationSummary(params);
  const projectIndex = params.snapshot?.projectIndex;
  const indexReady = Boolean(projectIndex?.indexedAt);
  const indexSignals =
    (projectIndex?.symbols?.length ?? 0) + (projectIndex?.tasks?.length ?? 0);

  return [
    {
      id: "session",
      label: "Agent Loop",
      value:
        summary.activeSessions > 0
          ? `${summary.activeSessions} active`
          : runtimeIsReady(summary.runtimeState)
            ? "idle"
            : summary.runtimeState,
      detail:
        summary.activeSessions > 0
          ? "session running through desktop-service"
          : runtimeIsReady(summary.runtimeState)
            ? "ready to start a local session"
            : "runtime needs attention",
      tone:
        summary.activeSessions > 0
          ? "ready"
          : runtimeIsReady(summary.runtimeState)
            ? "idle"
            : summary.runtimeState === "unknown"
              ? "unknown"
              : "warning",
    },
    {
      id: "provider",
      label: "Provider",
      value:
        summary.providers.total === 0
          ? "none"
          : `${summary.providers.ready}/${summary.providers.total} ready`,
      detail:
        summary.providers.total === 0
          ? "no provider descriptors"
          : summary.providers.ready > 0
            ? "CLI, auth, and model probes available"
            : "provider probe needed",
      tone:
        summary.providers.total === 0
          ? "blocked"
          : summary.providers.ready > 0
            ? "ready"
            : "warning",
    },
    {
      id: "mcp",
      label: "MCP",
      value:
        summary.mcp.totalEnabled === 0
          ? "disabled"
          : `${summary.mcp.initialized}/${summary.mcp.totalEnabled}`,
      detail:
        summary.mcp.totalEnabled === 0
          ? "no enabled MCP servers"
          : summary.mcp.agentBlocked > 0
            ? `${summary.mcp.agentBlocked} agent route(s) blocked`
            : summary.mcp.failed > 0
              ? `${summary.mcp.failed} protocol failure(s)`
              : summary.mcp.agentInjectable + summary.mcp.agentConditional > 0
                ? `${summary.mcp.agentBrokered} brokered / ${summary.mcp.agentConditional} conditional agent route(s)`
                : "tool and resource discovery path",
      tone:
        summary.mcp.totalEnabled === 0
          ? "idle"
          : summary.mcp.failed > 0 || summary.mcp.agentBlocked > 0
            ? "warning"
            : summary.mcp.initialized === summary.mcp.totalEnabled
              ? "ready"
              : "warning",
    },
    {
      id: "checkpoint",
      label: "Change Trust",
      value: summary.checkpoint.canCreate
        ? `${summary.checkpoint.changedFiles} changed`
        : "not git",
      detail: summary.checkpoint.canCreate
        ? `${summary.checkpoint.count} saved checkpoint(s)`
        : "checkpoint restore unavailable",
      tone: summary.checkpoint.canCreate
        ? summary.checkpoint.changedFiles > 0
          ? "warning"
          : "ready"
        : "blocked",
    },
    {
      id: "context",
      label: "Project Context",
      value: indexReady ? `${projectIndex?.indexedFiles ?? 0} files` : "stale",
      detail: indexReady
        ? `${indexSignals} indexed code/task signals`
        : "refresh index to attach context",
      tone: indexReady ? "ready" : "idle",
    },
    {
      id: "subagent",
      label: "Subagent",
      value: summary.subagentCommand ?? "none",
      detail: summary.subagentCommand
        ? "manual delegation command ready"
        : "no enabled manual subagent",
      tone: summary.subagentCommand ? "ready" : "idle",
    },
  ];
}
