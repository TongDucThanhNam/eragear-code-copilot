import { subagentSlashCommandName } from "@/components/chat-ui/subagent-command";

interface DiagnosticsLike {
  health?: {
    state?: string;
  };
}

interface ProviderLike {
  id: string;
  status?: string;
  readiness?: string;
  cliStatus?: string;
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
  chatStatus?: string;
  subscriberCount?: number;
  pendingPermissions?: number;
  activeToolCalls?: number;
  agentName?: string;
  sessionId?: string;
}

interface CheckpointLike {
  id: string;
  name?: string;
  createdAt?: string;
  changedFiles?: string[];
  patchBytes?: number;
  canRestore?: boolean;
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

function isProviderReady(provider: ProviderLike): boolean {
  return provider.readiness === "ready" || provider.status === "ready";
}

function canProbeProvider(provider: ProviderLike): boolean {
  return provider.status !== "missing-config" && provider.cliStatus !== "missing";
}

function choosePrimarySubagent(subagents: SubagentLike[]): SubagentLike | undefined {
  const enabled = subagents.filter((item) => item.enabled);
  return (
    enabled.find((item) => item.name === "code-reviewer") ??
    enabled.find((item) => item.name.toLowerCase().includes("review")) ??
    enabled[0]
  );
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
  const primarySubagent = choosePrimarySubagent(params.snapshot?.subagents ?? []);
  const changedFiles = params.snapshot?.changeTrust?.changedFiles?.length ?? 0;

  return {
    runtimeState: params.diagnostics?.health?.state ?? "unknown",
    activeSessions: params.snapshot?.sessions?.active?.length ?? 0,
    providers: {
      total: providers.length,
      ready: providers.filter(isProviderReady).length,
      probeTargets: providers.filter(canProbeProvider).map((provider) => provider.id),
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
        agentRouting?.routes?.filter((route) => route.brokerMode === "stdio-proxy")
          .length ?? 0,
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
  const latestCheckpoint = latestByTimestamp(checkpoints, (item) => item.createdAt);
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
          ? activeSession.chatStatus ?? "running"
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
          (params.snapshot?.acpActivity?.stats?.total ?? 0) > 0 ? "ready" : "idle",
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
    summary.providers.total > 0 && summary.providers.ready === summary.providers.total;
  const enabledMcpServers = params.snapshot?.mcp?.servers?.filter(
    (server) => server.enabled
  ) ?? [];
  const mcpHasRunnableSurface = enabledMcpServers.some(
    (server) =>
      server.protocol?.status === "initialized" &&
      server.trustStatus === "trusted" &&
      ((server.tools?.length ?? 0) > 0 || (server.resources?.length ?? 0) > 0)
  );
  const mcpNeedsProbe =
    summary.mcp.totalEnabled > 0 &&
    (summary.mcp.failed > 0 || summary.mcp.initialized < summary.mcp.totalEnabled);
  const mcpRouteAttention = summary.mcp.agentBlocked > 0;
  const indexReady = Boolean(params.snapshot?.projectIndex?.indexedAt);
  const memorySources = params.snapshot?.projectMemory?.sources ?? [];
  const enabledMemorySources = memorySources.filter((source) => source.enabled).length;
  const runtimeReady = runtimeIsReady(summary.runtimeState);

  return [
    {
      id: "session",
      label: activeSession ? "Inspect Session" : "Start Session",
      value: activeSession?.chatStatus ?? (runtimeReady ? "ready" : summary.runtimeState),
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
      label: providersReady ? "Inspect Providers" : "Probe Providers",
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
        summary.providers.total === 0 ? "blocked" : providersReady ? "ready" : "warning",
      action: providersReady ? "inspect-section" : "probe-providers",
      enabled: providersReady || summary.providers.probeTargets.length > 0,
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
      label:
        !summary.checkpoint.canCreate
          ? "Inspect Changes"
          : summary.checkpoint.changedFiles > 0
            ? "Capture Checkpoint"
            : "Review Checkpoints",
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
      tone: enabledMemorySources > 0 ? "ready" : memorySources.length > 0 ? "warning" : "idle",
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
