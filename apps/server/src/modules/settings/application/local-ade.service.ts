import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TextDecoder, promisify } from "node:util";
import {
  type CapabilityDescriptor,
  type CapabilityKind,
  type CapabilityScope,
  createCapabilityRegistrySnapshot,
} from "@repo/shared";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { ProjectRepositoryPort } from "@/modules/project";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
  StoredMessage,
  StoredSession,
} from "@/modules/session";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import type { LogEntry, LogLevel } from "@/shared/types/log.types";
import type { ChatSession, SessionModelState } from "@/shared/types/session.types";
import {
  findSessionConfigOption,
  getSessionConfigOptionCurrentValue,
  getSessionConfigOptionValues,
} from "@/shared/utils/session-config-options.util";
import { isRecord } from "@/shared/utils/type-guards.util";
import type { AppConfigService } from "../app-config.service";
import type { SettingsRepositoryPort } from "./ports/settings-repository.port";

const execFileAsync = promisify(execFile);
const STATE_FILE = "capabilities-state.json";
const MCP_FILE = "mcp-servers.json";
const MCP_AGENT_AUDIT_FILE = "mcp-agent-audit.jsonl";
const PROVIDER_HEALTH_FILE = "provider-health.json";
const CHECKPOINTS_FILE = "checkpoints.json";
const CHECKPOINT_PATCH_DIR = "checkpoints";
const CHECKPOINT_SHELF_DIR = "checkpoint-shelves";
const REPO_INDEX_FILE = "repo-index.json";
const ACP_REPLAY_PRESETS_FILE = "acp-replay-presets.json";
const PROJECT_MEMORY_PRESETS_FILE = "project-memory-presets.json";
const HOOKS_FILE = "hooks.json";
const PLUGINS_FILE = "plugins.json";
const PLUGIN_REGISTRIES_FILE = "plugin-registries.json";
const PLUGIN_PACKAGE_CATALOG_DIR = "plugin-packages";
const MAX_DISCOVERY_FILES = 160;
const MAX_MARKDOWN_BYTES = 96_000;
const MAX_MEMORY_PREVIEW_BYTES = 16_000;
const MAX_PROJECT_MEMORY_CONTEXT_BYTES = 24_000;
const MAX_PROJECT_MEMORY_CHUNK_BYTES = 2_400;
const DEFAULT_PROJECT_MEMORY_SEMANTIC_CHUNKS = 4;
const MAX_PROJECT_MEMORY_SEMANTIC_CHUNKS = 8;
const PROJECT_MEMORY_VECTOR_DIMENSIONS = 128;
const MAX_MODEL_EMBEDDING_DIMENSIONS = 4096;
const MODEL_EMBEDDING_BATCH_SIZE = 16;
const MODEL_EMBEDDING_TIMEOUT_MS = 10_000;
const MAX_REPO_INDEX_EMBEDDING_FILES = 160;
const MAX_PROJECT_MEMORY_PRESETS = 24;
const MAX_PROJECT_MEMORY_PRESET_NAME_CHARS = 80;
const MAX_REPO_INDEX_FILES = 2_000;
const MAX_REPO_INDEX_VISIBLE_FILES = 160;
const MAX_REPO_INDEX_SYMBOLS = 400;
const MAX_REPO_INDEX_TASKS = 240;
const MAX_REPO_INDEX_FILE_SCAN_BYTES = 128_000;
const MAX_REPO_INDEX_SEARCH_RESULTS = 32;
const DEFAULT_REPO_INDEX_SEARCH_RESULTS = 12;
const MAX_REPO_INDEX_QUERY_TOKENS = 12;
const MAX_REPO_INDEX_FILE_SEMANTIC_TOKENS = 40;
const MAX_REPO_INDEX_SEMANTIC_TEXT_BYTES = 32_000;
const MAX_HOOK_RUNS = 40;
const MAX_HOOK_RUN_APPROVALS = 80;
const MAX_HOOK_BATCH_RUN_ITEMS = 8;
const MAX_HOOK_BATCHES = 20;
const MAX_PLUGIN_RUNS = 40;
const MAX_PLUGIN_RUN_APPROVALS = 80;
const MAX_PLUGIN_BATCH_RUN_ITEMS = 8;
const MAX_PLUGIN_BATCHES = 20;
const MAX_PLUGIN_BATCH_PRESETS = 20;
const MAX_PLUGIN_BATCH_SCHEDULES = 20;
const MAX_PLUGIN_DEPENDENCIES = 8;
const MAX_HOOK_OUTPUT_BYTES = 16_000;
const DEFAULT_HOOK_TIMEOUT_MS = 10_000;
const MAX_HOOK_TIMEOUT_MS = 30_000;
const DEFAULT_PLUGIN_TIMEOUT_MS = 10_000;
const MAX_PLUGIN_TIMEOUT_MS = 30_000;
const PLUGIN_SANDBOX_DIR_PREFIX = "eragear-plugin-";
const MAX_PLUGIN_WORKSPACE_STATUS_LINES = 80;
const MAX_PLUGIN_WORKSPACE_CHANGED_FILES = 80;
const MAX_PLUGIN_PACKAGE_BYTES = 64_000;
const MAX_PLUGIN_REGISTRY_BYTES = 128_000;
const PLUGIN_REGISTRY_FETCH_TIMEOUT_MS = 4000;
const PLUGIN_PACKAGE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const HOOK_RUN_APPROVAL_TTL_MS = 5 * 60 * 1000;
const PLUGIN_RUN_APPROVAL_TTL_MS = 5 * 60 * 1000;
const HOOK_BATCH_CONFIRMATION_TOKEN = "RUN HOOK BATCH";
const PLUGIN_BATCH_CONFIRMATION_TOKEN = "RUN PLUGIN BATCH";
const DEFAULT_AUTOMATION_MAX_CONCURRENT_RUNS = 1;
const MAX_AUTOMATION_MAX_CONCURRENT_RUNS = 4;
const MAX_AUTOMATION_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_PLUGIN_BATCH_SCHEDULE_INTERVAL_MS = 1_000;
const MAX_PLUGIN_BATCH_SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RUN_STATUS_VALUES = ["success", "failed", "timeout", "disabled"] as const;
const GIT_TIMEOUT_MS = 4000;
const PROBE_TIMEOUT_MS = 2500;
const PROVIDER_VERSION_PROBE_TIMEOUT_MS = 10_000;
const MCP_PROTOCOL_TIMEOUT_MS = 3500;
const MCP_SSE_RECONNECT_ATTEMPTS = 1;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MIN_MCP_REMOTE_REQUEST_TIMEOUT_MS = 1_000;
const MAX_MCP_REMOTE_REQUEST_TIMEOUT_MS = 15_000;
const MIN_MCP_REMOTE_RECONNECT_ATTEMPTS = 0;
const MAX_MCP_REMOTE_RECONNECT_ATTEMPTS = 3;
const MAX_MCP_PROBE_HISTORY = 8;
const MAX_MCP_INVOCATION_HISTORY = 12;
const MAX_MCP_AGENT_INVOCATION_HISTORY = 24;
const MAX_MCP_NOTIFICATION_HISTORY = 24;
const MAX_MCP_NOTIFICATION_MONITOR_HISTORY = 8;
const MAX_MCP_INVOCATION_OUTPUT_BYTES = 16_000;
const MAX_MCP_NOTIFICATION_PAYLOAD_BYTES = 4_000;
const DEFAULT_MCP_NOTIFICATION_WATCH_MS = 1_000;
const MIN_MCP_NOTIFICATION_WATCH_MS = 250;
const MAX_MCP_NOTIFICATION_WATCH_MS = 5_000;
const MAX_CHECKPOINTS = 80;
const MAX_CHECKPOINT_PREVIEW_BYTES = 32_000;
const MAX_CHECKPOINT_SESSION_ATTRIBUTIONS = 16;
const MAX_CHECKPOINT_MESSAGE_PREVIEW_CHARS = 180;
const MAX_ACP_ACTIVITY_ENTRIES = 50;
const MAX_ACP_ACTIVITY_CORRELATIONS = 12;
const MAX_ACP_ACTIVITY_TIMELINE_LANES = 12;
const MAX_ACP_ACTIVITY_TIMELINE_FRAMES = 80;
const MAX_ACP_ACTIVITY_TIMELINE_TRANSITIONS = 40;
const MAX_ACP_TRACE_EXPORT_ENTRIES = 500;
const MAX_ACP_REPLAY_PRESETS = 24;
const MAX_ACP_REPLAY_PRESET_NAME_CHARS = 80;
const MAX_ACP_ACTIVITY_CAUSALITY_CHAINS = 8;
const MAX_ACP_ACTIVITY_STREAM_GAPS = 8;
const ACP_ACTIVITY_STREAM_STALE_AFTER_MS = 60_000;
const ACP_ACTIVITY_STREAM_HEARTBEAT_WINDOW_MS = 30_000;
const ACP_ACTIVITY_STREAM_RETRY_DELAY_MS = 1_000;
const ACP_ACTIVITY_STREAM_RETRY_MAX_ATTEMPTS = 5;
const ACP_ACTIVITY_STREAM_GAP_THRESHOLD_MS = 2_000;
const MAX_CHECKPOINT_DIFF_FILES = 24;
const MAX_CHECKPOINT_DIFF_ROWS_PER_FILE = 180;
const MAX_CHECKPOINT_RESTORE_FILES = 24;
const MAX_CHECKPOINT_RESTORE_HUNKS = 24;
const MAX_DIAGNOSTIC_CHARS = 900;
const MAX_MCP_DISCOVERY_ITEMS = 80;
const SECRET_HINT_PATTERN =
  /(api[_-]?key|secret|token|password|private[_-]?key|authorization|cookie)/i;
const EXECUTION_POLICY_PRESET_VALUES = ["standard", "restricted", "blocked"] as const;
const PLUGIN_SCOPE_VALUES = ["process", "project-root", "env"] as const;
const DEFAULT_PLUGIN_SCOPES = ["process", "project-root"] as const;
const PLUGIN_BASE_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "WINDIR",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
] as const;

const automationActiveRuns = new Map<string, number>();

interface CapabilityStateDocument {
  version: 1;
  capabilities: Record<string, { enabled: boolean; updatedAt: string }>;
  memory?: Record<string, { enabled: boolean; updatedAt: string }>;
}

interface AcpReplayPresetDocument {
  version: 1;
  presets: LocalAdeAcpReplayPreset[];
}

interface ProjectMemoryPresetDocument {
  version: 1;
  presets: LocalAdeProjectMemoryPreset[];
}

type ProjectMemoryRetrievalMode = "full" | "semantic";
type ProjectSemanticRanker = "model-embedding" | "local-token-vector";

export interface LocalAdeProjectSummary {
  id: string;
  name: string;
  path: string;
  favorite?: boolean;
  lastOpenedAt?: number | null;
}

export interface LocalAdeProviderDescriptor {
  id: string;
  displayName: string;
  providerKind: string;
  authMode: "env" | "none";
  endpoint?: string;
  modelList: string[];
  aliases: string[];
  compatibleAgents: string[];
  redactedEnvKeys: string[];
  status:
    | "configured"
    | "missing-config"
    | "not-probed"
    | "cli-ok"
    | "auth-unknown"
    | "model-unknown"
    | "ready"
    | "unavailable";
  cliStatus: "missing" | "ok" | "failed" | "unknown";
  authStatus: "ok" | "unknown" | "failed" | "unsupported";
  modelStatus: "ok" | "unknown" | "failed" | "unsupported";
  readiness: "missing-config" | "cli-ok" | "auth-unknown" | "model-unknown" | "ready" | "unavailable";
  version?: string;
  lastProbedAt?: string;
  latencyMs?: number;
  modelListSource: "readiness-probe" | "fallback";
  selectedModel?: string;
  diagnostics: string[];
  remediation: string[];
}

export interface LocalAdeMemorySource {
  id: string;
  label: string;
  sourcePath: string;
  relativePath: string;
  exists: boolean;
  enabled: boolean;
  byteLength: number;
  preview: string;
  warnings: string[];
}

export interface LocalAdeProjectMemoryContextSource {
  id: string;
  label: string;
  relativePath: string;
  byteLength: number;
  includedBytes: number;
  truncated: boolean;
  warnings: string[];
}

export interface LocalAdeProjectMemoryContextChunk {
  sourceId: string;
  label: string;
  relativePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  score: number;
  ranker?: ProjectSemanticRanker;
  embeddingModel?: string;
  includedBytes: number;
  truncated: boolean;
}

export interface LocalAdeProjectMemoryContextResult {
  status: "ready" | "no-enabled-sources";
  query: string;
  retrievalMode: ProjectMemoryRetrievalMode;
  presetId?: string;
  presetName?: string;
  sources: LocalAdeProjectMemoryContextSource[];
  chunks: LocalAdeProjectMemoryContextChunk[];
  semantic?: {
    ranker: ProjectSemanticRanker;
    model?: string;
    dimensions?: number;
    diagnostics: string[];
  };
  prompt: string;
  diagnostics: string[];
}

export interface LocalAdeProjectMemoryPreset {
  id: string;
  name: string;
  sourcePaths: string[];
  defaultQuery?: string;
  retrievalMode: ProjectMemoryRetrievalMode;
  maxBytes: number;
  maxChunks: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  diagnostics: string[];
}

export type McpTransport = "stdio" | "sse" | "streamable-http";

export type LocalAdeMcpProbeStepName =
  | "header-policy"
  | "resolve"
  | "spawn"
  | "stream-open"
  | "stream-reconnect"
  | "endpoint"
  | "initialize"
  | "initialized"
  | "tools/list"
  | "resources/list";

export interface LocalAdeMcpProbeStep {
  step: LocalAdeMcpProbeStepName;
  transport: McpTransport;
  status: "success" | "failed" | "skipped";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  detail?: string;
  error?: string;
}

export interface LocalAdeMcpProbeRun {
  id: string;
  serverId: string;
  serverName: string;
  transport: McpTransport;
  status: LocalAdeMcpServer["probe"]["status"];
  health: LocalAdeMcpServer["health"];
  protocolStatus: LocalAdeMcpServer["protocol"]["status"];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stepCount: number;
  failedStepCount: number;
  toolsDiscovered: number;
  resourcesDiscovered: number;
  steps: LocalAdeMcpProbeStep[];
  diagnostics: string[];
}

export interface LocalAdeMcpTool {
  name: string;
  description?: string;
}

export interface LocalAdeMcpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface LocalAdeMcpInvocationContent {
  type: string;
  text?: string;
  uri?: string;
  mimeType?: string;
  byteLength?: number;
}

export interface LocalAdeMcpInvocationResult {
  serverId: string;
  serverName: string;
  transport: McpTransport;
  method: "tools/call" | "resources/read";
  target: string;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  isError: boolean;
  resultText: string;
  resultJson: string;
  truncated: boolean;
  content: LocalAdeMcpInvocationContent[];
  notifications: LocalAdeMcpNotification[];
  diagnostics: string[];
}

export interface LocalAdeMcpNotification {
  id: string;
  serverId: string;
  serverName: string;
  transport: McpTransport;
  source: "probe" | "invocation" | "monitor";
  method: string;
  receivedAt: string;
  payloadText: string;
  truncated: boolean;
}

export interface LocalAdeMcpNotificationMonitorRun {
  id: string;
  serverId: string;
  serverName: string;
  transport: McpTransport;
  status: "success" | "failed" | "unsupported";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestedDurationMs: number;
  reconnectCount: number;
  streamOpenCount: number;
  notificationCount: number;
  notifications: LocalAdeMcpNotification[];
  diagnostics: string[];
}

export interface LocalAdeMcpRemoteControls {
  requestTimeoutMs: number;
  reconnectAttempts: number;
  notificationWatchMs: number;
  mode: "default" | "custom";
  diagnostics: string[];
}

export interface LocalAdeMcpServer {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  messageEndpoint?: string;
  envKeys: string[];
  headerKeys: string[];
  headerEnv: Array<{
    header: string;
    envKey: string;
    present: boolean;
  }>;
  health: "not-probed" | "invalid-config" | "available" | "unavailable" | "disabled";
  protocol: {
    status: "not-run" | "initialized" | "failed" | "unsupported";
    protocolVersion?: string;
    serverName?: string;
    serverVersion?: string;
    toolsDiscovered: number;
    resourcesDiscovered: number;
    error?: string;
  };
  tools: LocalAdeMcpTool[];
  resources: LocalAdeMcpResource[];
  lastProbedAt?: string;
  latencyMs?: number;
  probe: {
    status: "not-run" | "success" | "failed" | "skipped";
    retryable: boolean;
    stepCount: number;
    failedStepCount: number;
    steps: LocalAdeMcpProbeStep[];
  };
  probeHistory: LocalAdeMcpProbeRun[];
  fingerprint: string;
  trustStatus: "trusted" | "untrusted" | "changed";
  trustedFingerprint?: string;
  trustedAt?: string;
  invocationHistory: LocalAdeMcpInvocationResult[];
  notificationHistory: LocalAdeMcpNotification[];
  notificationMonitorHistory: LocalAdeMcpNotificationMonitorRun[];
  remoteControls: LocalAdeMcpRemoteControls;
  diagnostics: string[];
  updatedAt: string;
}

export interface LocalAdeMcpAgentRoute {
  serverId: string;
  serverName: string;
  transport: McpTransport;
  enabled: boolean;
  trustStatus: LocalAdeMcpServer["trustStatus"];
  protocolStatus: LocalAdeMcpServer["protocol"]["status"];
  status: "injectable" | "conditional" | "blocked" | "skipped";
  reason: string;
  target: string;
  brokerMode: "stdio-proxy" | "native-agent-transport" | "none";
  requiresAgentCapability?: "http" | "sse";
  agentSupport: "not-required" | "required-at-session-start";
  headerEnv: LocalAdeMcpServer["headerEnv"];
  agentInvocationCount: number;
  lastAgentInvocation?: LocalAdeMcpAgentInvocation;
  diagnostics: string[];
}

export interface LocalAdeMcpAgentRouting {
  status: "ready" | "attention" | "empty";
  injectableCount: number;
  conditionalCount: number;
  blockedCount: number;
  skippedCount: number;
  routes: LocalAdeMcpAgentRoute[];
  agentInvocationHistory: LocalAdeMcpAgentInvocation[];
  diagnostics: string[];
}

export interface LocalAdeMcpAgentInvocation {
  id: string;
  serverId: string;
  serverName: string;
  method: "tools/call" | "resources/read";
  target: string;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  resultText?: string;
  error?: string;
  source: "agent-broker";
}

export interface LocalAdeSubagentDescriptor {
  id: string;
  name: string;
  description?: string;
  scope: CapabilityScope;
  enabled: boolean;
  sourcePath: string;
  prompt: string;
  model?: string;
  tools: string[];
  tags: string[];
  diagnostics: string[];
}

export interface LocalAdeCommandDescriptor {
  id: string;
  name: string;
  description?: string;
  scope: CapabilityScope;
  enabled: boolean;
  sourcePath: string;
  prompt: string;
  argumentHint?: string;
  tags: string[];
  diagnostics: string[];
}

export interface LocalAdeSkillDescriptor {
  id: string;
  name: string;
  description?: string;
  scope: CapabilityScope;
  enabled: boolean;
  sourcePath: string;
  prompt: string;
  tags: string[];
  diagnostics: string[];
}

export interface LocalAdeOutputStyleDescriptor {
  id: string;
  name: string;
  description?: string;
  scope: CapabilityScope;
  enabled: boolean;
  sourcePath: string;
  prompt: string;
  tags: string[];
  diagnostics: string[];
}

export interface LocalAdeRepoIndexFile {
  path: string;
  sizeBytes: number;
  extension: string;
  modifiedAt?: string;
  language?: string;
  semanticTags?: string[];
  semanticHash?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingHash?: string;
}

export interface LocalAdeRepoIndexSymbol {
  path: string;
  name: string;
  kind: "class" | "function" | "interface" | "type" | "component" | "export";
  line: number;
  language?: string;
}

export interface LocalAdeRepoIndexTask {
  path: string;
  marker: "TODO" | "FIXME" | "HACK" | "BUG" | "XXX";
  line: number;
  text: string;
}

export interface LocalAdeRepoIndexSnapshot {
  storagePath: string;
  indexedAt?: string;
  indexedFiles: number;
  totalBytes: number;
  semantic: {
    status: "ready" | "empty";
    profiledFiles: number;
    tokenCount: number;
    source: "local-token-profile" | "model-embedding";
    embeddedFiles?: number;
    model?: string;
    dimensions?: number;
    provider?: "openai-compatible";
  };
  extensions: Array<{
    extension: string;
    count: number;
  }>;
  files: LocalAdeRepoIndexFile[];
  symbols: LocalAdeRepoIndexSymbol[];
  tasks: LocalAdeRepoIndexTask[];
  diagnostics: string[];
}

export interface LocalAdeRepoIndexSearchItem {
  type: "file" | "symbol" | "task";
  path: string;
  title: string;
  detail: string;
  score: number;
  matchKind?: "direct" | "semantic" | "embedding";
  line?: number;
  language?: string;
  marker?: LocalAdeRepoIndexTask["marker"];
}

export interface LocalAdeRepoIndexSearchResult {
  status: "ready" | "not-indexed" | "no-results";
  query: string;
  indexedAt?: string;
  results: LocalAdeRepoIndexSearchItem[];
  prompt: string;
  diagnostics: string[];
}

export interface LocalAdeHookRun {
  id: string;
  hookId: string;
  hookName: string;
  event: string;
  batchId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "failed" | "timeout" | "disabled";
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  isolation?: LocalAdeProcessIsolation;
  diagnostics: string[];
  reviewedAt?: string;
}

export interface LocalAdeProcessIsolation {
  mode: "job-process-tree";
  shell: false;
  windowsHide: true;
  detachedProcessGroup: boolean;
  processTreeKill: "available" | "best-effort";
  processTreeTerminated?: boolean;
  cwdScope: "project-root" | "temporary-sandbox";
  envMode: "base-plus-allowlist";
  projectRootExposed: boolean;
  secretEnvRedaction: true;
  timeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  diagnostics: string[];
}

export interface LocalAdeExecutionPolicy {
  status: "allowed" | "blocked";
  sandbox: "direct-spawn";
  isolation: LocalAdeProcessIsolation;
  blockers: string[];
  warnings: string[];
}

export type LocalAdeExecutionPolicyPreset =
  (typeof EXECUTION_POLICY_PRESET_VALUES)[number];

export type LocalAdeHookLifecycleFailureMode = "continue" | "stop-on-failure";
export type LocalAdePluginBatchFailureMode = "continue" | "stop-on-failure";

export interface LocalAdeHookLifecyclePolicy {
  enabled: boolean;
  disabledEvents: string[];
  failureMode: LocalAdeHookLifecycleFailureMode;
  updatedAt?: string;
  diagnostics: string[];
}

export interface LocalAdeHookBatch {
  id: string;
  hookIds: string[];
  hookNames: string[];
  runIds: string[];
  failureMode: LocalAdeHookLifecycleFailureMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "partial" | "failed" | "blocked";
  counts: Record<LocalAdeHookRun["status"], number>;
  diagnostics: string[];
}

export type LocalAdeAutomationSchedulingStatus =
  | "ready"
  | "paused"
  | "cooldown"
  | "parallel-limit";

export interface LocalAdeAutomationSchedulingPolicy {
  enabled: boolean;
  maxConcurrentRuns: number;
  cooldownMs: number;
  updatedAt?: string;
  diagnostics: string[];
}

export interface LocalAdeAutomationSchedulingState {
  status: LocalAdeAutomationSchedulingStatus;
  activeRuns: number;
  maxConcurrentRuns: number;
  cooldownMs: number;
  nextAllowedAt?: string;
  diagnostics: string[];
}

export interface LocalAdeHookRunOperation {
  operation: "manual-run";
  fingerprint: string;
  approvalStatus: "missing" | "approved" | "expired" | "consumed" | "changed";
  approvalId?: string;
  approvedAt?: string;
  expiresAt?: string;
  consumedAt?: string;
  cwd: string;
  command: string;
  args: string[];
  event: string;
  envKeys: string[];
  executionFingerprint: string;
  isolation: LocalAdeProcessIsolation;
  diagnostics: string[];
}

export interface LocalAdeHookDescriptor {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  policyPreset: LocalAdeExecutionPolicyPreset;
  envKeys: string[];
  fingerprint: string;
  trustStatus: "trusted" | "untrusted" | "changed";
  trustedFingerprint?: string;
  trustedAt?: string;
  command: string;
  args: string[];
  timeoutMs: number;
  workingDirectory?: string;
  sourcePath: string;
  updatedAt: string;
  runConfirmationToken: string;
  runOperation: LocalAdeHookRunOperation;
  executionPolicy: LocalAdeExecutionPolicy;
  scheduling: LocalAdeAutomationSchedulingState;
  lastRun?: LocalAdeHookRun;
  diagnostics: string[];
}

export interface LocalAdePluginRun {
  id: string;
  pluginId: string;
  pluginName: string;
  batchId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: LocalAdeHookRun["status"];
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  isolation?: LocalAdeProcessIsolation;
  diagnostics: string[];
  preRunCheckpointId?: string;
  postRunCheckpointId?: string;
  workspaceStatusBefore?: string[];
  workspaceStatusAfter?: string[];
  workspaceChangedFiles?: string[];
  reviewedAt?: string;
}

export interface LocalAdePluginBatch {
  id: string;
  pluginIds: string[];
  pluginNames: string[];
  runIds: string[];
  failureMode: LocalAdePluginBatchFailureMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "partial" | "failed" | "blocked";
  counts: Record<LocalAdeHookRun["status"], number>;
  diagnostics: string[];
}

export interface LocalAdePluginBatchPreset {
  id: string;
  name: string;
  pluginIds: string[];
  pluginNames: string[];
  failureMode: LocalAdePluginBatchFailureMode;
  createdAt: string;
  updatedAt: string;
  lastRunBatchId?: string;
  diagnostics: string[];
}

export type LocalAdePluginBatchScheduleStatus =
  | "due"
  | "scheduled"
  | "paused"
  | "missing-preset"
  | "stale-fingerprint";

export interface LocalAdePluginBatchSchedule {
  id: string;
  name: string;
  presetId: string;
  presetName?: string;
  enabled: boolean;
  intervalMs: number;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunBatchId?: string;
  lastRunStatus?: LocalAdePluginBatch["status"] | "blocked";
  pluginIds: string[];
  pluginNames: string[];
  operationFingerprints: Record<string, string>;
  status: LocalAdePluginBatchScheduleStatus;
  diagnostics: string[];
}

export interface LocalAdePluginDependencyGraphNode {
  pluginId: string;
  pluginName: string;
  dependencyIds: string[];
  dependencyNames: string[];
  dependentIds: string[];
  dependentNames: string[];
  status: "ready" | "missing-dependency" | "cycle";
  diagnostics: string[];
}

export interface LocalAdePluginDependencyGraphEdge {
  pluginId: string;
  pluginName: string;
  dependencyId: string;
  dependencyName?: string;
  status: "ready" | "missing" | "cycle";
}

export interface LocalAdePluginDependencyGraph {
  nodes: LocalAdePluginDependencyGraphNode[];
  edges: LocalAdePluginDependencyGraphEdge[];
  diagnostics: string[];
}

export interface LocalAdePluginRunOperation {
  operation: "manual-run";
  fingerprint: string;
  approvalStatus: "missing" | "approved" | "expired" | "consumed" | "changed";
  approvalId?: string;
  approvedAt?: string;
  expiresAt?: string;
  consumedAt?: string;
  workspaceAccess: "project-root" | "sandbox";
  cwd: string;
  command: string;
  args: string[];
  scopes: LocalAdePluginScope[];
  envKeys: string[];
  executionFingerprint: string;
  permissionFingerprint: string;
  isolation: LocalAdeProcessIsolation;
  diagnostics: string[];
}

export type LocalAdePluginScope = (typeof PLUGIN_SCOPE_VALUES)[number];
export type LocalAdePluginPackageExpiryStatus =
  | "valid"
  | "expired"
  | "not-declared";
export type LocalAdePluginPackageGovernanceStatus =
  | "verified"
  | "verification-failed";

export interface LocalAdePluginDescriptor {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  policyPreset: LocalAdeExecutionPolicyPreset;
  installSource?: "manual" | "signed-package";
  publisher?: string;
  packagePublisherId?: string;
  packageManifestPath?: string;
  packageRegistryUrl?: string;
  packageRegistryName?: string;
  packageRegistryPackageId?: string;
  packageSignatureHash?: string;
  packagePublicKeyFingerprint?: string;
  packageIssuedAt?: string;
  packageExpiresAt?: string;
  packageExpiryStatus?: LocalAdePluginPackageExpiryStatus;
  packageVerifiedAt?: string;
  packageGovernanceStatus?: LocalAdePluginPackageGovernanceStatus;
  packageGovernanceDiagnostics?: string[];
  scopes: LocalAdePluginScope[];
  dependencyIds: string[];
  envKeys: string[];
  fingerprint: string;
  trustStatus: "trusted" | "untrusted" | "changed";
  trustedFingerprint?: string;
  trustedAt?: string;
  permissionFingerprint: string;
  permissionStatus: "granted" | "missing" | "changed";
  grantedPermissionFingerprint?: string;
  permissionGrantedAt?: string;
  command: string;
  args: string[];
  timeoutMs: number;
  workingDirectory?: string;
  sourcePath: string;
  updatedAt: string;
  runConfirmationToken: string;
  runOperation: LocalAdePluginRunOperation;
  executionPolicy: LocalAdeExecutionPolicy;
  scheduling: LocalAdeAutomationSchedulingState;
  lastRun?: LocalAdePluginRun;
  diagnostics: string[];
}

export interface LocalAdePluginCatalogItem {
  manifestPath: string;
  status: "installable" | "installed" | "update-available" | "invalid";
  id?: string;
  name?: string;
  description?: string;
  publisher?: string;
  publisherId?: string;
  issuedAt?: string;
  expiresAt?: string;
  expiryStatus: LocalAdePluginPackageExpiryStatus;
  scopes: LocalAdePluginScope[];
  envKeys: string[];
  command?: string;
  args: string[];
  timeoutMs?: number;
  workspaceAccess: "project-root" | "sandbox";
  signatureHash?: string;
  publicKeyFingerprint?: string;
  installedPluginId?: string;
  diagnostics: string[];
}

export interface LocalAdePluginRegistryPackage {
  id: string;
  name?: string;
  description?: string;
  publisher?: string;
  publisherId?: string;
  issuedAt?: string;
  expiresAt?: string;
  expiryStatus: LocalAdePluginPackageExpiryStatus;
  manifestUrl: string;
  signatureHash: string;
  publicKeyFingerprint: string;
  status:
    | "installable"
    | "installed"
    | "update-available"
    | "invalid"
    | "revoked";
  signingStatus: "trusted" | "revoked";
  installedPluginId?: string;
  revokedAt?: string;
  revocationReason?: string;
  revocationSource?: "manual" | "registry";
  diagnostics: string[];
}

export interface LocalAdePluginRegistryRevocation {
  publicKeyFingerprint: string;
  revokedAt: string;
  reason?: string;
  source: "manual" | "registry";
}

export interface LocalAdePluginRegistryDescriptor {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  fingerprint: string;
  trustStatus: "trusted" | "untrusted" | "changed";
  trustedFingerprint?: string;
  trustedAt?: string;
  lastRefreshAt?: string;
  status: "ready" | "disabled" | "untrusted" | "failed" | "empty";
  revokedSigners: LocalAdePluginRegistryRevocation[];
  packages: LocalAdePluginRegistryPackage[];
  updatedAt: string;
  diagnostics: string[];
}

export type LocalAdeAuditReviewState = "all" | "reviewed" | "open";

export interface LocalAdeRunAuditStats {
  total: number;
  matching: number;
  included: number;
  reviewed: number;
  open: number;
  statuses: Record<LocalAdeHookRun["status"], number>;
}

export interface ExportHookRunsInput {
  projectId?: string;
  reviewState?: LocalAdeAuditReviewState;
  status?: LocalAdeHookRun["status"];
  limit?: number;
}

export interface LocalAdeHookRunExport {
  schemaVersion: 1;
  exportedAt: string;
  projectRoot: string;
  filters: {
    reviewState: LocalAdeAuditReviewState;
    status?: LocalAdeHookRun["status"];
    limit: number;
  };
  redacted: true;
  stats: LocalAdeRunAuditStats;
  runs: LocalAdeHookRun[];
  diagnostics: string[];
}

export interface ExportPluginRunsInput {
  projectId?: string;
  reviewState?: LocalAdeAuditReviewState;
  status?: LocalAdeHookRun["status"];
  limit?: number;
}

export interface LocalAdePluginRunExport {
  schemaVersion: 1;
  exportedAt: string;
  projectRoot: string;
  filters: {
    reviewState: LocalAdeAuditReviewState;
    status?: LocalAdeHookRun["status"];
    limit: number;
  };
  redacted: true;
  stats: LocalAdeRunAuditStats;
  runs: LocalAdePluginRun[];
  diagnostics: string[];
}

interface StoredMcpServer
  extends Omit<
    LocalAdeMcpServer,
    | "envKeys"
    | "headerKeys"
    | "headerEnv"
    | "health"
    | "protocol"
    | "tools"
    | "resources"
    | "probe"
    | "probeHistory"
    | "fingerprint"
    | "trustStatus"
    | "invocationHistory"
    | "notificationHistory"
    | "notificationMonitorHistory"
    | "remoteControls"
    | "diagnostics"
  > {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  headerEnv?: Record<string, string>;
  probeHistory?: LocalAdeMcpProbeRun[];
  invocationHistory?: LocalAdeMcpInvocationResult[];
  notificationHistory?: LocalAdeMcpNotification[];
  notificationMonitorHistory?: LocalAdeMcpNotificationMonitorRun[];
  remoteControls?: Partial<Pick<
    LocalAdeMcpRemoteControls,
    "requestTimeoutMs" | "reconnectAttempts" | "notificationWatchMs"
  >>;
}

interface McpDocument {
  version: 1;
  servers: StoredMcpServer[];
}

interface ProviderHealthRecord {
  status: LocalAdeProviderDescriptor["status"];
  cliStatus: LocalAdeProviderDescriptor["cliStatus"];
  authStatus: LocalAdeProviderDescriptor["authStatus"];
  modelStatus: LocalAdeProviderDescriptor["modelStatus"];
  readiness: LocalAdeProviderDescriptor["readiness"];
  version?: string;
  modelList?: string[];
  latencyMs?: number;
  checkedAt: string;
  diagnostics: string[];
  remediation: string[];
}

interface ProviderHealthDocument {
  version: 1;
  providers: Record<string, ProviderHealthRecord>;
}

interface CheckpointDocument {
  version: 1;
  checkpoints: LocalAdeCheckpoint[];
}

type RuntimeSession = ReturnType<SessionRuntimePort["getAll"]>[number];

interface RepoIndexFileRecord extends LocalAdeRepoIndexFile {
  embeddingVector?: number[];
}

interface RepoIndexDocument {
  version: 1;
  rootPath: string;
  indexedAt: string;
  files: RepoIndexFileRecord[];
  symbols?: LocalAdeRepoIndexSymbol[];
  tasks?: LocalAdeRepoIndexTask[];
  totalBytes: number;
  diagnostics: string[];
}

interface StoredHook {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  policyPreset?: LocalAdeExecutionPolicyPreset;
  envKeys?: string[];
  trustedFingerprint?: string;
  trustedAt?: string;
  grantedPermissionFingerprint?: string;
  permissionGrantedAt?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
  updatedAt: string;
}

interface StoredHookRunApproval {
  id: string;
  hookId: string;
  operation: "manual-run";
  fingerprint: string;
  approvedAt: string;
  expiresAt: string;
  consumedAt?: string;
}

interface StoredHookLifecyclePolicy {
  enabled?: boolean;
  disabledEvents?: string[];
  failureMode?: LocalAdeHookLifecycleFailureMode;
  updatedAt?: string;
}

interface StoredAutomationSchedulingPolicy {
  enabled?: boolean;
  maxConcurrentRuns?: number;
  cooldownMs?: number;
  updatedAt?: string;
}

interface HookDocument {
  version: 1;
  hooks: StoredHook[];
  runs: LocalAdeHookRun[];
  approvals: StoredHookRunApproval[];
  batches: LocalAdeHookBatch[];
  lifecyclePolicy: StoredHookLifecyclePolicy;
  schedulingPolicy: StoredAutomationSchedulingPolicy;
}

interface StoredPlugin {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  policyPreset?: LocalAdeExecutionPolicyPreset;
  installSource?: "manual" | "signed-package";
  publisher?: string;
  packagePublisherId?: string;
  packageManifestPath?: string;
  packageRegistryUrl?: string;
  packageRegistryName?: string;
  packageRegistryPackageId?: string;
  packageSignatureHash?: string;
  packagePublicKeyFingerprint?: string;
  packageIssuedAt?: string;
  packageExpiresAt?: string;
  packageVerifiedAt?: string;
  packageGovernanceStatus?: LocalAdePluginPackageGovernanceStatus;
  packageGovernanceDiagnostics?: string[];
  scopes?: LocalAdePluginScope[];
  dependencyIds?: string[];
  envKeys?: string[];
  trustedFingerprint?: string;
  trustedAt?: string;
  grantedPermissionFingerprint?: string;
  permissionGrantedAt?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
  updatedAt: string;
}

interface StoredPluginRunApproval {
  id: string;
  pluginId: string;
  operation: "manual-run";
  fingerprint: string;
  approvedAt: string;
  expiresAt: string;
  consumedAt?: string;
}

interface StoredPluginBatchSchedule {
  id: string;
  name: string;
  presetId: string;
  enabled: boolean;
  intervalMs: number;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunBatchId?: string;
  lastRunStatus?: LocalAdePluginBatch["status"] | "blocked";
  operationFingerprints: Record<string, string>;
  diagnostics?: string[];
}

interface PluginDocument {
  version: 1;
  plugins: StoredPlugin[];
  runs: LocalAdePluginRun[];
  approvals: StoredPluginRunApproval[];
  batches: LocalAdePluginBatch[];
  batchPresets: LocalAdePluginBatchPreset[];
  batchSchedules: StoredPluginBatchSchedule[];
  schedulingPolicy: StoredAutomationSchedulingPolicy;
}

interface StoredPluginRegistryPackage {
  id: string;
  name?: string;
  description?: string;
  publisher?: string;
  publisherId?: string;
  issuedAt?: string;
  expiresAt?: string;
  manifestUrl: string;
  signatureHash: string;
  publicKeyFingerprint: string;
  diagnostics?: string[];
}

interface StoredPluginRegistryRevocation {
  publicKeyFingerprint: string;
  revokedAt: string;
  reason?: string;
  source?: "manual" | "registry";
}

interface StoredPluginRegistry {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  trustedFingerprint?: string;
  trustedAt?: string;
  lastRefreshAt?: string;
  packages?: StoredPluginRegistryPackage[];
  revokedSigners?: StoredPluginRegistryRevocation[];
  diagnostics?: string[];
  updatedAt: string;
}

interface PluginRegistryStateDocument {
  version: 1;
  registries: StoredPluginRegistry[];
}

export interface UpsertMcpServerInput {
  projectId?: string;
  id?: string;
  name: string;
  transport: McpTransport;
  enabled?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  messageEndpoint?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  headerEnv?: Record<string, string>;
  remoteControls?: Pick<
    ConfigureMcpRemoteControlsInput,
    "requestTimeoutMs" | "reconnectAttempts" | "notificationWatchMs"
  >;
}

export interface ToggleMcpServerInput {
  projectId?: string;
  id: string;
  enabled: boolean;
}

export interface TrustMcpServerInput {
  projectId?: string;
  serverId: string;
  fingerprint: string;
}

export interface ProbeMcpServerInput {
  projectId?: string;
  id: string;
}

export interface InvokeMcpToolInput {
  projectId?: string;
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface ReadMcpResourceInput {
  projectId?: string;
  serverId: string;
  uri: string;
}

export interface WatchMcpNotificationsInput {
  projectId?: string;
  serverId: string;
  durationMs?: number;
}

export interface ConfigureMcpRemoteControlsInput {
  projectId?: string;
  serverId: string;
  fingerprint: string;
  requestTimeoutMs?: number;
  reconnectAttempts?: number;
  notificationWatchMs?: number;
}

export interface TestProviderInput {
  projectId?: string;
  providerId: string;
}

export interface SelectProviderModelInput {
  projectId?: string;
  providerId: string;
  modelId: string;
}

export interface ClearProviderModelInput {
  projectId?: string;
}

export interface CreateCheckpointInput {
  projectId?: string;
  name?: string;
}

export interface PreviewCheckpointInput {
  projectId?: string;
  checkpointId: string;
}

export interface RestoreCheckpointInput {
  projectId?: string;
  checkpointId: string;
  confirmation: string;
}

export interface RestoreCheckpointFilesInput extends RestoreCheckpointInput {
  files: string[];
}

export interface RestoreCheckpointHunkInput {
  file: string;
  hunkIndex: number;
}

export interface RestoreCheckpointHunksInput extends RestoreCheckpointInput {
  hunks: RestoreCheckpointHunkInput[];
}

export interface ResolveCheckpointTrackedConflictHunksInput
  extends RestoreCheckpointInput {
  hunks: RestoreCheckpointHunkInput[];
}

export interface ShelveCheckpointConflictsInput extends RestoreCheckpointInput {
  files: string[];
}

export interface ResolveCheckpointTrackedConflictsInput
  extends RestoreCheckpointInput {
  files: string[];
}

export interface ResolveCheckpointTrackedConflictChoiceInput
  extends RestoreCheckpointInput {
  files: string[];
  resolution: "restore" | "current";
}

export interface RefreshProjectIndexInput {
  projectId?: string;
}

export interface SearchProjectIndexInput {
  projectId?: string;
  query: string;
  limit?: number;
}

export interface BuildProjectMemoryContextInput {
  projectId?: string;
  query?: string;
  presetId?: string;
  retrievalMode?: ProjectMemoryRetrievalMode;
  sourceIds?: string[];
  sourcePaths?: string[];
  maxBytes?: number;
  maxChunks?: number;
}

export interface UpsertProjectMemoryPresetInput {
  projectId?: string;
  id?: string;
  name: string;
  sourcePaths: string[];
  defaultQuery?: string;
  retrievalMode?: ProjectMemoryRetrievalMode;
  maxBytes?: number;
  maxChunks?: number;
}

export interface DeleteProjectMemoryPresetInput {
  projectId?: string;
  id: string;
}

export interface UpsertHookInput {
  projectId?: string;
  id?: string;
  name: string;
  event?: string;
  enabled?: boolean;
  policyPreset?: LocalAdeExecutionPolicyPreset;
  envKeys?: string[];
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface ToggleHookInput {
  projectId?: string;
  id: string;
  enabled: boolean;
}

export interface UpdateHookLifecyclePolicyInput {
  projectId?: string;
  enabled?: boolean;
  disabledEvents?: string[];
  failureMode?: LocalAdeHookLifecycleFailureMode;
}

export interface UpdateAutomationSchedulingPolicyInput {
  projectId?: string;
  enabled?: boolean;
  maxConcurrentRuns?: number;
  cooldownMs?: number;
}

export interface RunHookInput {
  projectId?: string;
  hookId: string;
  confirmation: string;
  operationApprovalId: string;
}

export interface RunHookBatchInput {
  projectId?: string;
  hookIds: string[];
  operationFingerprints: Record<string, string>;
  confirmation: string;
  failureMode?: LocalAdeHookLifecycleFailureMode;
}

export interface ApproveHookRunInput {
  projectId?: string;
  hookId: string;
  operationFingerprint: string;
}

export interface ReviewHookRunInput {
  projectId?: string;
  runId: string;
  reviewed: boolean;
}

export interface TrustHookInput {
  projectId?: string;
  hookId: string;
  fingerprint: string;
}

export interface UpsertPluginInput {
  projectId?: string;
  id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  policyPreset?: LocalAdeExecutionPolicyPreset;
  scopes?: LocalAdePluginScope[];
  dependencyIds?: string[];
  envKeys?: string[];
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface InstallPluginPackageInput {
  projectId?: string;
  manifestPath?: string;
  registryUrl?: string;
  packageId?: string;
}

export interface RevalidatePluginPackageInput {
  projectId?: string;
  pluginId: string;
}

export interface UpsertPluginRegistryInput {
  projectId?: string;
  id?: string;
  name: string;
  url: string;
  enabled?: boolean;
}

export interface TrustPluginRegistryInput {
  projectId?: string;
  registryId: string;
  fingerprint: string;
}

export interface RevokePluginRegistryTrustInput {
  projectId?: string;
  registryId: string;
}

export interface RevokePluginRegistrySignerInput {
  projectId?: string;
  registryId: string;
  publicKeyFingerprint: string;
  reason?: string;
}

export interface RestorePluginRegistrySignerInput {
  projectId?: string;
  registryId: string;
  publicKeyFingerprint: string;
}

export interface RefreshPluginRegistryInput {
  projectId?: string;
  registryId: string;
}

export interface InstallPluginRegistryPackageInput {
  projectId?: string;
  registryId: string;
  packageId: string;
}

export interface TogglePluginInput {
  projectId?: string;
  id: string;
  enabled: boolean;
}

export interface TrustPluginInput {
  projectId?: string;
  pluginId: string;
  fingerprint: string;
}

export interface UpdatePluginPermissionGrantInput {
  projectId?: string;
  pluginId: string;
  permissionFingerprint: string;
  granted: boolean;
}

export interface ApprovePluginRunInput {
  projectId?: string;
  pluginId: string;
  operationFingerprint: string;
}

export interface RunPluginInput {
  projectId?: string;
  pluginId: string;
  confirmation: string;
  operationApprovalId: string;
}

export interface RunPluginBatchInput {
  projectId?: string;
  pluginIds: string[];
  operationFingerprints: Record<string, string>;
  confirmation: string;
  failureMode?: LocalAdePluginBatchFailureMode;
}

export interface UpsertPluginBatchPresetInput {
  projectId?: string;
  id?: string;
  name: string;
  pluginIds: string[];
  failureMode?: LocalAdePluginBatchFailureMode;
}

export interface UpsertPluginBatchScheduleInput {
  projectId?: string;
  id?: string;
  name: string;
  presetId: string;
  enabled?: boolean;
  intervalMs: number;
  nextRunAt?: string;
  operationFingerprints: Record<string, string>;
}

export interface DeletePluginBatchScheduleInput {
  projectId?: string;
  scheduleId: string;
}

export interface RunDuePluginBatchSchedulesInput {
  projectId?: string;
  scheduleIds?: string[];
  now?: string;
}

export interface LocalAdePluginBatchScheduleDispatchResult {
  users: number;
  projects: number;
  dueSchedules: number;
  dispatchedSchedules: number;
  failedProjects: number;
}

export interface DeletePluginBatchPresetInput {
  projectId?: string;
  presetId: string;
}

export interface RunPluginBatchPresetInput {
  projectId?: string;
  presetId: string;
  operationFingerprints: Record<string, string>;
  confirmation: string;
}

export interface ReviewPluginRunInput {
  projectId?: string;
  runId: string;
  reviewed: boolean;
}

export interface UpdateCapabilityStateInput {
  projectId?: string;
  capabilityId: string;
  enabled: boolean;
}

export interface LocalAdeChangeTrustSnapshot {
  rootPath: string;
  isGitRepo: boolean;
  changedFiles: string[];
  statusLines: string[];
  diagnostics: string[];
}

export interface LocalAdeWorkflowParity {
  workflow: string;
  status: "available" | "partial" | "blocked" | "not-applicable";
  electronSurface: string;
  sourceFile: string;
  blockerFile?: string;
  reason?: string;
  policy?: {
    scope: "local-desktop" | "remote-admin";
    decision: "exposed" | "not-applicable";
    rationale: string;
    reviewedAt: string;
  };
}

export interface LocalAdeCheckpointSessionAttribution {
  chatId: string;
  source: "active" | "stored" | "missing";
  status: string;
  messageCount: number;
  projectId?: string;
  sessionId?: string;
  agentName?: string;
  lastMessageRole?: "user" | "assistant";
  lastMessagePreview?: string;
  lastMessageAt?: number;
  activeTurnId?: string;
  lastCompletedTurnId?: string;
  subscriberCount?: number;
  pendingPermissions?: number;
  activeToolCalls?: number;
}

export interface LocalAdeCheckpoint {
  id: string;
  name: string;
  createdAt: string;
  projectRoot: string;
  sessionIds: string[];
  sessionAttributions: LocalAdeCheckpointSessionAttribution[];
  gitHead?: string;
  changedFiles: string[];
  statusLines: string[];
  restoreMode?: "reverse-patch" | "apply-patch";
  restoreStatusLines?: string[];
  safetyForCheckpointId?: string;
  preRestoreSafetyCheckpointId?: string;
  partialRestores?: Array<{
    restoredAt: string;
    files: string[];
    resolution?: "restore" | "current" | "mixed";
    hunks?: Array<{
      file: string;
      hunkIndex: number;
      header: string;
    }>;
    hunkChoices?: Array<{
      file: string;
      hunkIndex: number;
      header: string;
      resolution: "restore" | "current";
    }>;
    safetyCheckpointId?: string;
  }>;
  conflictShelves?: Array<{
    shelvedAt: string;
    files: string[];
    shelfPath: string;
    reason: string;
  }>;
  patchPath: string;
  patchBytes: number;
  canRestore: boolean;
  restoredAt?: string;
  diagnostics: string[];
}

export interface LocalAdeCheckpointDiffRow {
  kind: "context" | "add" | "delete" | "change" | "meta";
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
}

export interface LocalAdeCheckpointDiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  rows: LocalAdeCheckpointDiffRow[];
  truncated: boolean;
}

export interface LocalAdeCheckpointDiffFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "binary" | "unknown";
  oldPath?: string;
  newPath?: string;
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: LocalAdeCheckpointDiffHunk[];
  truncated: boolean;
}

export interface LocalAdeCheckpointPreview {
  checkpointId: string;
  name: string;
  restoreMode: "reverse-patch" | "apply-patch";
  patchPath: string;
  patchBytes: number;
  preview: string;
  truncated: boolean;
  restoreToken: string;
  canRestore: boolean;
  changedFiles: string[];
  statusLines: string[];
  sessionAttributions: LocalAdeCheckpointSessionAttribution[];
  diffFiles: LocalAdeCheckpointDiffFile[];
  diagnostics: string[];
  restoreBlockers: Array<{
    file: string;
    reason: string;
  }>;
  restoreRisks: Array<{
    file: string;
    level: "safe" | "warning" | "blocked";
    patchAction: string;
    checkpointStatus?: string;
    currentStatus?: string;
    reason: string;
  }>;
}

export interface LocalAdeAcpActivityEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  chatId?: string;
  kind?: string;
  payloadBytes?: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface LocalAdeAcpActivityCorrelation {
  key: string;
  label: string;
  eventCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  durationMs: number;
  latestMessage: string;
  latestLevel: LogLevel;
  chatId?: string;
  sessionId?: string;
  turnId?: string;
  levels: Record<LogLevel, number>;
  kinds: Record<string, number>;
}

export interface LocalAdeAcpActivityTimelineLane {
  key: string;
  label: string;
  eventCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  durationMs: number;
  latestMessage: string;
  latestLevel: LogLevel;
  latestKind?: string;
  chatId?: string;
  sessionId?: string;
  source: string;
  levels: Record<LogLevel, number>;
  kinds: Record<string, number>;
}

export interface LocalAdeAcpActivityTimelineFrame
  extends LocalAdeAcpActivityEntry {
  sequence: number;
  offsetMs: number;
  deltaMs: number;
  laneKey: string;
  laneLabel: string;
  correlationKey: string;
  correlationLabel: string;
}

export interface LocalAdeAcpActivityTimelineTransition {
  sequence: number;
  timestamp: number;
  deltaMs: number;
  fromLaneKey: string;
  fromLaneLabel: string;
  toLaneKey: string;
  toLaneLabel: string;
  fromKind?: string;
  toKind?: string;
  fromChatId?: string;
  toChatId?: string;
}

export interface LocalAdeAcpActivityTimeline {
  lanes: LocalAdeAcpActivityTimelineLane[];
  frames: LocalAdeAcpActivityTimelineFrame[];
  transitions: LocalAdeAcpActivityTimelineTransition[];
  spanMs: number;
  omittedFrames: number;
}

export interface LocalAdeAcpActivityStreamGap {
  sequence: number;
  deltaMs: number;
  fromFrameId: string;
  toFrameId: string;
  fromKind?: string;
  toKind?: string;
  fromChatId?: string;
  toChatId?: string;
}

export interface LocalAdeAcpActivityCausalityChain {
  key: string;
  label: string;
  eventCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  durationMs: number;
  latestMessage: string;
  latestLevel: LogLevel;
  chatId?: string;
  sessionId?: string;
  turnId?: string;
  levels: Record<LogLevel, number>;
  kinds: Record<string, number>;
}

export interface LocalAdeAcpActivityStreamDiagnostics {
  status: "idle" | "healthy" | "attention" | "stale";
  latestTimestamp?: number;
  latestAgeMs: number;
  staleAfterMs: number;
  heartbeatWindowMs: number;
  retryDelayMs: number;
  retryMaxAttempts: number;
  retryEligible: boolean;
  rootCount: number;
  correlatedFrameCount: number;
  orphanFrameCount: number;
  longestChainLength: number;
  maxSilenceMs: number;
  averageDeltaMs: number;
  gapThresholdMs: number;
  gaps: LocalAdeAcpActivityStreamGap[];
  chains: LocalAdeAcpActivityCausalityChain[];
  diagnostics: string[];
}

export interface LocalAdeAcpReplayPreset {
  id: string;
  name: string;
  chatId?: string;
  correlationKey?: string;
  kind?: string;
  limit: number;
  createdAt: string;
  updatedAt: string;
  lastReplayedAt?: string;
}

export interface LocalAdeAcpActivitySnapshot {
  entries: LocalAdeAcpActivityEntry[];
  correlations: LocalAdeAcpActivityCorrelation[];
  timeline: LocalAdeAcpActivityTimeline;
  stream: LocalAdeAcpActivityStreamDiagnostics;
  replayPresets: LocalAdeAcpReplayPreset[];
  stats: {
    total: number;
    levels: Record<LogLevel, number>;
    chatCount: number;
    kinds: Record<string, number>;
  };
  diagnostics: string[];
}

export interface ExportAcpActivityInput {
  projectId?: string;
  chatId?: string;
  limit?: number;
}

export interface RetryAcpActivityStreamInput {
  projectId?: string;
}

export interface LocalAdeAcpActivityExport
  extends Omit<LocalAdeAcpActivitySnapshot, "replayPresets"> {
  schemaVersion: 1;
  exportedAt: string;
  projectRoot: string;
  filters: {
    chatId?: string;
    limit: number;
  };
  redacted: true;
}

export interface ReplayAcpActivityInput extends ExportAcpActivityInput {
  correlationKey?: string;
  kind?: string;
}

export interface SaveAcpReplayPresetInput extends ReplayAcpActivityInput {
  id?: string;
  name: string;
}

export interface DeleteAcpReplayPresetInput {
  projectId?: string;
  id: string;
}

export interface LocalAdeAcpActivityReplayFrame extends LocalAdeAcpActivityEntry {
  sequence: number;
  elapsedMs: number;
  deltaMs: number;
  correlationKey: string;
  correlationLabel: string;
}

export interface LocalAdeAcpActivityReplay {
  schemaVersion: 1;
  replayedAt: string;
  projectRoot: string;
  filters: {
    chatId?: string;
    correlationKey?: string;
    kind?: string;
    limit: number;
  };
  redacted: true;
  frames: LocalAdeAcpActivityReplayFrame[];
  correlations: LocalAdeAcpActivityCorrelation[];
  stats: LocalAdeAcpActivitySnapshot["stats"];
  diagnostics: string[];
}

export interface LocalAdeSnapshot {
  generatedAt: string;
  projectRoot: string;
  projects: {
    activeProjectId: string | null;
    activeProjectPath: string | null;
    items: LocalAdeProjectSummary[];
  };
  sessions: {
    active: Array<{
      id: string;
      projectId?: string;
      projectRoot: string;
      sessionId?: string;
      chatStatus: string;
      subscriberCount: number;
      pendingPermissions: number;
      activeToolCalls: number;
      agentName?: string;
      pid?: number;
      model: {
        currentModelId: string | null;
        supportsSwitching: boolean;
        source: "config-option" | "models" | "none";
        availableModels: Array<{
          modelId: string;
          name: string;
          description?: string | null;
          provider?: string;
          providers?: string[];
        }>;
        diagnostics: string[];
      };
    }>;
    totalStored: number | null;
  };
  agents: {
    activeAgentId: string | null;
    items: Array<{
      id: string;
      name: string;
      type: string;
      command: string;
      args: string[];
      envKeys: string[];
      isActive: boolean;
    }>;
  };
  runtime: {
    defaultModel: string;
    defaultModelProviderId: string | null;
    defaultModelStatus: "not-set" | "selected" | "unverified";
    background: BackgroundRunnerState | null;
    diagnostics: string[];
  };
  providers: LocalAdeProviderDescriptor[];
  capabilities: ReturnType<typeof createCapabilityRegistrySnapshot>;
  projectMemory: {
    sources: LocalAdeMemorySource[];
    presets: LocalAdeProjectMemoryPreset[];
    warnings: string[];
  };
  projectIndex: LocalAdeRepoIndexSnapshot;
  hooks: {
    configPath: string;
    lifecyclePolicy: LocalAdeHookLifecyclePolicy;
    schedulingPolicy: LocalAdeAutomationSchedulingPolicy;
    items: LocalAdeHookDescriptor[];
    recentRuns: LocalAdeHookRun[];
    recentBatches: LocalAdeHookBatch[];
  };
  plugins: {
    configPath: string;
    schedulingPolicy: LocalAdeAutomationSchedulingPolicy;
    items: LocalAdePluginDescriptor[];
    catalog: LocalAdePluginCatalogItem[];
    registries: LocalAdePluginRegistryDescriptor[];
    recentRuns: LocalAdePluginRun[];
    recentBatches: LocalAdePluginBatch[];
    batchPresets: LocalAdePluginBatchPreset[];
    batchSchedules: LocalAdePluginBatchSchedule[];
    dependencyGraph: LocalAdePluginDependencyGraph;
  };
  mcp: {
    configPath: string;
    servers: LocalAdeMcpServer[];
    agentRouting: LocalAdeMcpAgentRouting;
  };
  commands: LocalAdeCommandDescriptor[];
  skills: LocalAdeSkillDescriptor[];
  outputStyles: LocalAdeOutputStyleDescriptor[];
  subagents: LocalAdeSubagentDescriptor[];
  changeTrust: LocalAdeChangeTrustSnapshot;
  checkpoints: {
    storagePath: string;
    patchDir: string;
    items: LocalAdeCheckpoint[];
  };
  logs: {
    entries: Array<{
      id: string;
      timestamp: number;
      level: string;
      source: string;
      message: string;
    }>;
    stats: {
      total: number;
      levels: Record<string, number>;
    };
  };
  acpActivity: LocalAdeAcpActivitySnapshot;
  storage: {
    sessionCount?: number;
    messageCount?: number;
    dbSizeBytes?: number;
    walSizeBytes?: number;
  } | null;
  dashboardParity: LocalAdeWorkflowParity[];
  blockers: LocalAdeWorkflowParity[];
}

interface ProjectContext {
  rootPath: string;
  activeProjectId: string | null;
  activeProjectPath: string | null;
  projects: LocalAdeProjectSummary[];
}

interface FrontmatterResult {
  attributes: Record<string, string | string[] | boolean>;
  body: string;
}

const DASHBOARD_PARITY: LocalAdeWorkflowParity[] = [
  {
    workflow: "Projects",
    status: "available",
    electronSurface: "Sidebar project tree and workspace overview",
    sourceFile: "apps/server/src/presentation/dashboard/components/projects-tab.tsx",
  },
  {
    workflow: "Sessions",
    status: "available",
    electronSurface: "Sidebar session tree and workspace overview",
    sourceFile: "apps/server/src/presentation/dashboard/components/sessions-tab.tsx",
  },
  {
    workflow: "Agents and runtime allowlists",
    status: "available",
    electronSurface: "Settings routes and Local ADE panels",
    sourceFile: "apps/server/src/presentation/dashboard/components/agents-tab.tsx",
  },
  {
    workflow: "Logs and observability",
    status: "available",
    electronSurface: "Settings > Activity route",
    sourceFile: "apps/server/src/presentation/dashboard/components/logs-tab.tsx",
  },
  {
    workflow: "Boot settings",
    status: "partial",
    electronSurface: "Settings connection route runtime allowlist panel",
    sourceFile: "apps/server/src/presentation/dashboard/components/settings-tab.tsx",
    reason:
      "Common boot tuning fields are not all editable in Electron yet; allowlists and ACP toggles are on the desktop path.",
  },
  {
    workflow: "Auth admin and device sessions",
    status: "not-applicable",
    electronSurface: "Local ADE policy rail",
    sourceFile: "apps/server/src/presentation/dashboard/components/auth-tab.tsx",
    blockerFile: "apps/server/src/transport/http/routes/admin.ts",
    reason:
      "Remote auth administration is intentionally outside the local desktop ADE surface; local sessions use the desktop-service channel and do not expose remote device-session controls.",
    policy: {
      scope: "local-desktop",
      decision: "not-applicable",
      rationale:
        "Remote auth admin/device-session management is a server administration workflow, not a local ADE workflow. It remains excluded from Electron until a separate remote-admin product policy is requested.",
      reviewedAt: "2026-06-12",
    },
  },
];

function toHashId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function normalizeSlash(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function getFallbackRepoRoot(): string {
  const explicit = process.env.ERAGEAR_REPO_ROOT?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.resolve(process.cwd(), "..", "..");
}

function ensureProjectDataDir(rootPath: string): string {
  return path.join(rootPath, ".eragear");
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readCapabilityState(rootPath: string): Promise<CapabilityStateDocument> {
  const filePath = path.join(ensureProjectDataDir(rootPath), STATE_FILE);
  const parsed = await readJsonObject(filePath);
  if (!parsed || !isRecord(parsed.capabilities)) {
    return { version: 1, capabilities: {} };
  }
  const capabilities: CapabilityStateDocument["capabilities"] = {};
  for (const [id, value] of Object.entries(parsed.capabilities)) {
    if (!isRecord(value) || typeof value.enabled !== "boolean") {
      continue;
    }
    capabilities[id] = {
      enabled: value.enabled,
      updatedAt:
        typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    };
  }

  const memory: CapabilityStateDocument["memory"] = {};
  if (isRecord(parsed.memory)) {
    for (const [id, value] of Object.entries(parsed.memory)) {
      if (!isRecord(value) || typeof value.enabled !== "boolean") {
        continue;
      }
      memory[id] = {
        enabled: value.enabled,
        updatedAt:
          typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
      };
    }
  }

  return {
    version: 1,
    capabilities,
    ...(Object.keys(memory).length > 0 ? { memory } : {}),
  };
}

async function writeCapabilityState(
  rootPath: string,
  document: CapabilityStateDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, STATE_FILE),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8"
  );
}

function parseScalar(value: string): string | string[] | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith("---")) {
    return { attributes: {}, body: raw };
  }
  const normalized = raw.replace(/\r\n/g, "\n");
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { attributes: {}, body: raw };
  }
  const header = normalized.slice(3, endIndex).trim();
  const body = normalized.slice(endIndex + 4).trimStart();
  const attributes: Record<string, string | string[] | boolean> = {};
  for (const line of header.split("\n").slice(0, 80)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (!key) {
      continue;
    }
    attributes[key] = parseScalar(value);
  }
  return { attributes, body };
}

function firstString(
  attributes: Record<string, string | string[] | boolean>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function attributeTags(attributes: Record<string, string | string[] | boolean>): string[] {
  const tags = attributes.tags;
  if (Array.isArray(tags)) {
    return tags.filter((item) => item.trim().length > 0);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function attributeStringList(
  attributes: Record<string, string | string[] | boolean>,
  keys: string[]
): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = attributes[key];
    if (Array.isArray(value)) {
      values.push(...value);
    } else if (typeof value === "string") {
      values.push(...value.split(","));
    }
  }
  return values.map((item) => item.trim()).filter(Boolean);
}

function titleFromMarkdown(body: string): string | undefined {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
}

function descriptionFromMarkdown(body: string): string | undefined {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"))
    .find(Boolean)
    ?.slice(0, 220);
}

function normalizeSlashCommandName(value: string): string {
  const normalized = value
    .trim()
    .replace(/^\//, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/${normalized || "command"}`;
}

async function walkFiles(params: {
  rootPath: string;
  match: (filePath: string) => boolean;
  maxFiles?: number;
}): Promise<string[]> {
  const maxFiles = params.maxFiles ?? MAX_DISCOVERY_FILES;
  const results: string[] = [];
  if (!existsSync(params.rootPath)) {
    return results;
  }

  async function visit(directory: string): Promise<void> {
    if (results.length >= maxFiles) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) {
        return;
      }
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (entry.isFile() && params.match(child)) {
        results.push(child);
      }
    }
  }

  await visit(params.rootPath);
  return results;
}

async function readMarkdownDescriptor(params: {
  filePath: string;
  kind: CapabilityKind;
  scope: CapabilityScope;
  rootPath: string;
  state: CapabilityStateDocument;
  defaultName: string;
  diagnostics?: string[];
}): Promise<CapabilityDescriptor | null> {
  let raw = "";
  try {
    raw = await readFile(params.filePath, "utf8");
  } catch {
    return null;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_MARKDOWN_BYTES) {
    return {
      id: `${params.kind}.${params.scope}.${toHashId(params.filePath)}`,
      kind: params.kind,
      name: params.defaultName,
      description: "File is too large for local capability discovery.",
      scope: params.scope,
      enabled: false,
      sourcePath: params.filePath,
      storage: "filesystem-discovery",
      diagnostics: [`Skipped files over ${MAX_MARKDOWN_BYTES} bytes.`],
    };
  }

  const parsed = parseFrontmatter(raw);
  const relative = normalizeSlash(path.relative(params.rootPath, params.filePath));
  const id = `${params.kind}.${params.scope}.${toHashId(params.rootPath, relative)}`;
  const name =
    firstString(parsed.attributes, ["name", "title", "command"]) ??
    titleFromMarkdown(parsed.body) ??
    params.defaultName;
  const stateEntry = params.state.capabilities[id];

  return {
    id,
    kind: params.kind,
    name,
    description:
      firstString(parsed.attributes, ["description", "summary"]) ??
      descriptionFromMarkdown(parsed.body),
    scope: params.scope,
    enabled: stateEntry?.enabled ?? true,
    sourcePath: params.filePath,
    storage: "filesystem-discovery",
    tags: [
      ...attributeTags(parsed.attributes),
      params.scope,
      relative.startsWith(".claude/") ? "claude-compatible" : "eragear",
    ],
    diagnostics: params.diagnostics,
  };
}

async function discoverCapabilityFiles(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  homePath: string;
}): Promise<CapabilityDescriptor[]> {
  const specs: Array<{
    kind: CapabilityKind;
    scope: CapabilityScope;
    rootPath: string;
    match: (filePath: string) => boolean;
    defaultName: (filePath: string) => string;
    diagnostics?: string[];
  }> = [
    {
      kind: "skill",
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "skills"),
      match: (filePath) => path.basename(filePath).toLowerCase() === "skill.md",
      defaultName: (filePath) => path.basename(path.dirname(filePath)),
    },
    {
      kind: "skill",
      scope: "project",
      rootPath: path.join(params.rootPath, ".claude", "skills"),
      match: (filePath) => path.basename(filePath).toLowerCase() === "skill.md",
      defaultName: (filePath) => path.basename(path.dirname(filePath)),
      diagnostics: ["Loaded as a compatibility skill descriptor."],
    },
    {
      kind: "command",
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "commands"),
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
    },
    {
      kind: "command",
      scope: "project",
      rootPath: path.join(params.rootPath, ".claude", "commands"),
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
      diagnostics: ["Loaded as a compatibility command descriptor."],
    },
    {
      kind: "output-style",
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "output-styles"),
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
      defaultName: (filePath) => path.basename(filePath, ".md"),
    },
    {
      kind: "skill",
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "skills"),
      match: (filePath) => path.basename(filePath).toLowerCase() === "skill.md",
      defaultName: (filePath) => path.basename(path.dirname(filePath)),
    },
    {
      kind: "command",
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "commands"),
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
    },
    {
      kind: "output-style",
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "output-styles"),
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
      defaultName: (filePath) => path.basename(filePath, ".md"),
    },
  ];

  const capabilities: CapabilityDescriptor[] = [];
  for (const spec of specs) {
    const files = await walkFiles({
      rootPath: spec.rootPath,
      match: spec.match,
    });
    for (const filePath of files) {
      const descriptor = await readMarkdownDescriptor({
        filePath,
        kind: spec.kind,
        scope: spec.scope,
        rootPath: params.rootPath,
        state: params.state,
        defaultName: spec.defaultName(filePath),
        diagnostics: spec.diagnostics,
      });
      if (descriptor) {
        capabilities.push(descriptor);
      }
    }
  }
  return capabilities;
}

async function readSkillDescriptor(params: {
  filePath: string;
  scope: CapabilityScope;
  rootPath: string;
  state: CapabilityStateDocument;
  defaultName: string;
  diagnostics?: string[];
}): Promise<LocalAdeSkillDescriptor | null> {
  let raw = "";
  try {
    raw = await readFile(params.filePath, "utf8");
  } catch {
    return null;
  }
  const relative = normalizeSlash(path.relative(params.rootPath, params.filePath));
  const id = `skill.${params.scope}.${toHashId(params.rootPath, relative)}`;
  const stateEntry = params.state.capabilities[id];
  if (Buffer.byteLength(raw, "utf8") > MAX_MARKDOWN_BYTES) {
    return {
      id,
      name: params.defaultName,
      description: "File is too large for local skill invocation.",
      scope: params.scope,
      enabled: false,
      sourcePath: params.filePath,
      prompt: "",
      tags: [params.scope, "eragear"],
      diagnostics: [`Skipped skill files over ${MAX_MARKDOWN_BYTES} bytes.`],
    };
  }

  const parsed = parseFrontmatter(raw);
  const name =
    firstString(parsed.attributes, ["name", "title", "skill"]) ??
    titleFromMarkdown(parsed.body) ??
    params.defaultName;
  const description =
    firstString(parsed.attributes, ["description", "summary"]) ??
    descriptionFromMarkdown(parsed.body);

  return {
    id,
    name,
    ...(description ? { description } : {}),
    scope: params.scope,
    enabled: stateEntry?.enabled ?? true,
    sourcePath: params.filePath,
    prompt: parsed.body.trim(),
    tags: [
      ...attributeTags(parsed.attributes),
      params.scope,
      relative.startsWith(".claude/") ? "claude-compatible" : "eragear",
    ],
    diagnostics: params.diagnostics ?? [],
  };
}

async function discoverSkillFiles(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  homePath: string;
}): Promise<LocalAdeSkillDescriptor[]> {
  const specs: Array<{
    scope: CapabilityScope;
    rootPath: string;
    diagnostics?: string[];
  }> = [
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "skills"),
    },
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".claude", "skills"),
      diagnostics: ["Loaded as a compatibility skill descriptor."],
    },
    {
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "skills"),
    },
  ];
  const skills: LocalAdeSkillDescriptor[] = [];
  for (const spec of specs) {
    const files = await walkFiles({
      rootPath: spec.rootPath,
      match: (filePath) => path.basename(filePath).toLowerCase() === "skill.md",
    });
    for (const filePath of files) {
      const descriptor = await readSkillDescriptor({
        filePath,
        scope: spec.scope,
        rootPath: params.rootPath,
        state: params.state,
        defaultName: path.basename(path.dirname(filePath)),
        diagnostics: spec.diagnostics,
      });
      if (descriptor) {
        skills.push(descriptor);
      }
    }
  }
  return skills;
}

async function readOutputStyleDescriptor(params: {
  filePath: string;
  scope: CapabilityScope;
  rootPath: string;
  state: CapabilityStateDocument;
  defaultName: string;
}): Promise<LocalAdeOutputStyleDescriptor | null> {
  let raw = "";
  try {
    raw = await readFile(params.filePath, "utf8");
  } catch {
    return null;
  }
  const relative = normalizeSlash(path.relative(params.rootPath, params.filePath));
  const id = `output-style.${params.scope}.${toHashId(params.rootPath, relative)}`;
  const stateEntry = params.state.capabilities[id];
  if (Buffer.byteLength(raw, "utf8") > MAX_MARKDOWN_BYTES) {
    return {
      id,
      name: params.defaultName,
      description: "File is too large for local output-style invocation.",
      scope: params.scope,
      enabled: false,
      sourcePath: params.filePath,
      prompt: "",
      tags: [params.scope, "eragear"],
      diagnostics: [`Skipped output-style files over ${MAX_MARKDOWN_BYTES} bytes.`],
    };
  }

  const parsed = parseFrontmatter(raw);
  const name =
    firstString(parsed.attributes, ["name", "title", "style"]) ??
    titleFromMarkdown(parsed.body) ??
    params.defaultName;
  const description =
    firstString(parsed.attributes, ["description", "summary"]) ??
    descriptionFromMarkdown(parsed.body);

  return {
    id,
    name,
    ...(description ? { description } : {}),
    scope: params.scope,
    enabled: stateEntry?.enabled ?? true,
    sourcePath: params.filePath,
    prompt: parsed.body.trim(),
    tags: [...attributeTags(parsed.attributes), params.scope, "eragear"],
    diagnostics: [],
  };
}

async function discoverOutputStyleFiles(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  homePath: string;
}): Promise<LocalAdeOutputStyleDescriptor[]> {
  const specs: Array<{
    scope: CapabilityScope;
    rootPath: string;
  }> = [
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "output-styles"),
    },
    {
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "output-styles"),
    },
  ];
  const outputStyles: LocalAdeOutputStyleDescriptor[] = [];
  for (const spec of specs) {
    const files = await walkFiles({
      rootPath: spec.rootPath,
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
    });
    for (const filePath of files) {
      const descriptor = await readOutputStyleDescriptor({
        filePath,
        scope: spec.scope,
        rootPath: params.rootPath,
        state: params.state,
        defaultName: path.basename(filePath, ".md"),
      });
      if (descriptor) {
        outputStyles.push(descriptor);
      }
    }
  }
  return outputStyles;
}

async function readCommandDescriptor(params: {
  filePath: string;
  scope: CapabilityScope;
  rootPath: string;
  state: CapabilityStateDocument;
  defaultName: string;
  diagnostics?: string[];
}): Promise<LocalAdeCommandDescriptor | null> {
  let raw = "";
  try {
    raw = await readFile(params.filePath, "utf8");
  } catch {
    return null;
  }
  const relative = normalizeSlash(path.relative(params.rootPath, params.filePath));
  const id = `command.${params.scope}.${toHashId(params.rootPath, relative)}`;
  const stateEntry = params.state.capabilities[id];
  if (Buffer.byteLength(raw, "utf8") > MAX_MARKDOWN_BYTES) {
    return {
      id,
      name: normalizeSlashCommandName(params.defaultName),
      description: "File is too large for local command invocation.",
      scope: params.scope,
      enabled: false,
      sourcePath: params.filePath,
      prompt: "",
      tags: [params.scope, "eragear"],
      diagnostics: [`Skipped command files over ${MAX_MARKDOWN_BYTES} bytes.`],
    };
  }

  const parsed = parseFrontmatter(raw);
  const name = normalizeSlashCommandName(
    firstString(parsed.attributes, ["name", "command", "title"]) ??
      titleFromMarkdown(parsed.body) ??
      params.defaultName
  );
  const description =
    firstString(parsed.attributes, ["description", "summary"]) ??
    descriptionFromMarkdown(parsed.body);
  const argumentHint = firstString(parsed.attributes, [
    "argument-hint",
    "argumentHint",
    "arguments",
    "args",
  ]);
  const tags = [
    ...attributeTags(parsed.attributes),
    params.scope,
    relative.startsWith(".claude/") ? "claude-compatible" : "eragear",
  ];

  return {
    id,
    name,
    ...(description ? { description } : {}),
    scope: params.scope,
    enabled: stateEntry?.enabled ?? true,
    sourcePath: params.filePath,
    prompt: parsed.body.trim(),
    ...(argumentHint ? { argumentHint } : {}),
    tags,
    diagnostics: params.diagnostics ?? [],
  };
}

async function discoverCommandFiles(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  homePath: string;
}): Promise<LocalAdeCommandDescriptor[]> {
  const specs: Array<{
    scope: CapabilityScope;
    rootPath: string;
    defaultName: (filePath: string) => string;
    diagnostics?: string[];
  }> = [
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "commands"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
    },
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".claude", "commands"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
      diagnostics: ["Loaded as a compatibility command descriptor."],
    },
    {
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "commands"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
    },
  ];
  const commands: LocalAdeCommandDescriptor[] = [];
  for (const spec of specs) {
    const files = await walkFiles({
      rootPath: spec.rootPath,
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
    });
    for (const filePath of files) {
      const descriptor = await readCommandDescriptor({
        filePath,
        scope: spec.scope,
        rootPath: params.rootPath,
        state: params.state,
        defaultName: spec.defaultName(filePath),
        diagnostics: spec.diagnostics,
      });
      if (descriptor) {
        commands.push(descriptor);
      }
    }
  }
  return commands;
}

async function readSubagentDescriptor(params: {
  filePath: string;
  scope: CapabilityScope;
  rootPath: string;
  state: CapabilityStateDocument;
  defaultName: string;
  diagnostics?: string[];
}): Promise<LocalAdeSubagentDescriptor | null> {
  let raw = "";
  try {
    raw = await readFile(params.filePath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseFrontmatter(raw);
  const relative = normalizeSlash(path.relative(params.rootPath, params.filePath));
  const id = `subagent.${params.scope}.${toHashId(params.rootPath, relative)}`;
  const name =
    firstString(parsed.attributes, ["name", "agent", "title"]) ??
    titleFromMarkdown(parsed.body) ??
    params.defaultName;
  const stateEntry = params.state.capabilities[id];
  const tags = [
    ...attributeTags(parsed.attributes),
    params.scope,
    relative.startsWith(".claude/") ? "claude-compatible" : "eragear",
  ];
  return {
    id,
    name,
    ...(firstString(parsed.attributes, ["description", "summary"]) ??
    descriptionFromMarkdown(parsed.body)
      ? {
          description:
            firstString(parsed.attributes, ["description", "summary"]) ??
            descriptionFromMarkdown(parsed.body),
        }
      : {}),
    scope: params.scope,
    enabled: stateEntry?.enabled ?? true,
    sourcePath: params.filePath,
    prompt: parsed.body.trim(),
    ...(firstString(parsed.attributes, ["model"])
      ? { model: firstString(parsed.attributes, ["model"]) }
      : {}),
    tools: attributeStringList(parsed.attributes, ["tools", "toolPolicy"]),
    tags,
    diagnostics: params.diagnostics ?? [],
  };
}

async function discoverSubagentFiles(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  homePath: string;
}): Promise<LocalAdeSubagentDescriptor[]> {
  const specs: Array<{
    scope: CapabilityScope;
    rootPath: string;
    diagnostics?: string[];
  }> = [
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "subagents"),
    },
    {
      scope: "project",
      rootPath: path.join(params.rootPath, ".claude", "agents"),
      diagnostics: ["Loaded as a compatibility subagent descriptor."],
    },
    {
      scope: "user",
      rootPath: path.join(params.homePath, ".eragear", "subagents"),
    },
  ];
  const subagents: LocalAdeSubagentDescriptor[] = [];
  for (const spec of specs) {
    const files = await walkFiles({
      rootPath: spec.rootPath,
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
    });
    for (const filePath of files) {
      const descriptor = await readSubagentDescriptor({
        filePath,
        scope: spec.scope,
        rootPath: params.rootPath,
        state: params.state,
        defaultName: path.basename(filePath, ".md"),
        diagnostics: spec.diagnostics,
      });
      if (descriptor) {
        subagents.push(descriptor);
      }
    }
  }
  return subagents;
}

function subagentCapabilities(
  subagents: LocalAdeSubagentDescriptor[]
): CapabilityDescriptor[] {
  return subagents.map((subagent) => ({
    id: subagent.id,
    kind: "subagent",
    name: subagent.name,
    description: subagent.description ?? "Manual delegated subagent prompt.",
    scope: subagent.scope,
    enabled: subagent.enabled,
    sourcePath: subagent.sourcePath,
    storage: "filesystem-discovery",
    tags: subagent.tags,
    diagnostics:
      subagent.diagnostics.length > 0
        ? subagent.diagnostics
        : ["Manual invocation is available through /agent-* chat commands."],
  }));
}

function redactPotentialSecrets(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!SECRET_HINT_PATTERN.test(line)) {
        return line;
      }
      return line.replace(
        /([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|private[_-]?key|authorization|cookie)[A-Za-z0-9_.-]*)\s*(:|=)\s*("[^"]*"|'[^']*'|[^,;\n]+)/gi,
        "$1$2 [redacted]"
      );
    })
    .join("\n");
}

function sanitizeDiagnosticText(text: string, secretValues: string[] = []): string {
  let sanitized = redactPotentialSecrets(text);
  for (const value of secretValues) {
    if (value.length < 3) {
      continue;
    }
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized
    .replace(/\0/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_CHARS);
}

function firstOutputLine(stdout: string, stderr: string): string | undefined {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function errorMessage(error: unknown, secretValues: string[] = []): string {
  if (error instanceof Error) {
    return sanitizeDiagnosticText(error.message, secretValues);
  }
  return sanitizeDiagnosticText(String(error), secretValues);
}

function commandLabel(command: string, args: string[] = []): string {
  return [command, ...args].join(" ").trim();
}

const SHELL_EVAL_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "powershell",
  "pwsh",
  "sh",
  "zsh",
]);

const SHELL_EVAL_FLAGS = new Set([
  "/c",
  "/k",
  "-c",
  "-command",
  "--command",
  "-encodedcommand",
  "-encodedarguments",
]);

function executableName(command: string): string {
  return path
    .basename(command.trim().replace(/^["']|["']$/g, ""))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/i, "");
}

function isShellEvalFlag(arg: string): boolean {
  const normalized = arg.trim().toLowerCase();
  return SHELL_EVAL_FLAGS.has(normalized);
}

function normalizeExecutionPolicyPreset(
  value: unknown
): LocalAdeExecutionPolicyPreset {
  return EXECUTION_POLICY_PRESET_VALUES.includes(
    value as LocalAdeExecutionPolicyPreset
  )
    ? (value as LocalAdeExecutionPolicyPreset)
    : "standard";
}

function createLocalProcessIsolation(params: {
  cwdScope: LocalAdeProcessIsolation["cwdScope"];
  projectRootExposed: boolean;
  timeoutMs?: number;
  processTreeTerminated?: boolean;
}): LocalAdeProcessIsolation {
  return {
    mode: "job-process-tree",
    shell: false,
    windowsHide: true,
    detachedProcessGroup: localProcessDetachedProcessGroup(),
    processTreeKill: "available",
    ...(typeof params.processTreeTerminated === "boolean"
      ? { processTreeTerminated: params.processTreeTerminated }
      : {}),
    cwdScope: params.cwdScope,
    envMode: "base-plus-allowlist",
    projectRootExposed: params.projectRootExposed,
    secretEnvRedaction: true,
    timeoutMs: params.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    stdoutLimitBytes: MAX_HOOK_OUTPUT_BYTES,
    stderrLimitBytes: MAX_HOOK_OUTPUT_BYTES,
    diagnostics: [
      "Process is spawned with shell:false and no shell expansion.",
      process.platform === "win32"
        ? "Timeout termination uses taskkill /T /F to terminate the process tree."
        : "Timeout termination uses a detached process group and negative-pid SIGTERM/SIGKILL fallback.",
      params.cwdScope === "temporary-sandbox"
        ? "Working directory is a temporary sandbox outside the project root."
        : "Working directory is constrained to the project root.",
      params.projectRootExposed
        ? "Project root is exposed to the process by policy."
        : "Project root is hidden from process environment.",
      "Only base runtime env plus approved allowlist keys are passed; output is redacted before persistence.",
    ],
  };
}

function readLocalProcessIsolation(
  value: unknown
): LocalAdeProcessIsolation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const cwdScope =
    value.cwdScope === "temporary-sandbox" ? "temporary-sandbox" : "project-root";
  const timeoutMs =
    typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)
      ? Math.max(1, Math.floor(value.timeoutMs))
      : DEFAULT_HOOK_TIMEOUT_MS;
  const processTreeTerminated =
    typeof value.processTreeTerminated === "boolean"
      ? value.processTreeTerminated
      : undefined;
  return {
    ...createLocalProcessIsolation({
      cwdScope,
      projectRootExposed: value.projectRootExposed === true,
      timeoutMs,
      ...(typeof processTreeTerminated === "boolean"
        ? { processTreeTerminated }
        : {}),
    }),
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => sanitizeDiagnosticText(entry))
          .slice(0, 12)
      : createLocalProcessIsolation({
          cwdScope,
          projectRootExposed: value.projectRootExposed === true,
          timeoutMs,
          ...(typeof processTreeTerminated === "boolean"
            ? { processTreeTerminated }
            : {}),
        }).diagnostics,
  };
}

function localProcessDetachedProcessGroup(): boolean {
  return process.platform !== "win32";
}

async function terminateLocalProcessTree(params: {
  child: ChildProcess;
  diagnostics: string[];
}): Promise<boolean> {
  const pid = params.child.pid;
  if (!pid) {
    params.diagnostics.push(
      "Process tree termination could not find a child pid; sent direct kill as fallback."
    );
    params.child.kill("SIGKILL");
    return false;
  }

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 3000,
      });
      params.diagnostics.push(
        `Process tree termination used taskkill /pid ${pid} /T /F.`
      );
      return true;
    } catch (error) {
      params.diagnostics.push(
        `Process tree termination via taskkill failed: ${errorMessage(error)}`
      );
      params.child.kill("SIGKILL");
      return false;
    }
  }

  try {
    process.kill(-pid, "SIGTERM");
    params.diagnostics.push(
      `Process tree termination sent SIGTERM to process group ${pid}.`
    );
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Process group already exited.
      }
    }, 250).unref?.();
    return true;
  } catch (error) {
    params.diagnostics.push(
      `Process group termination failed: ${errorMessage(error)}`
    );
    params.child.kill("SIGKILL");
    return false;
  }
}

function localProcessExecutionPolicy(params: {
  kind: "hook" | "plugin";
  command: string;
  args?: string[];
  preset?: LocalAdeExecutionPolicyPreset;
  context?: "manual-run" | "lifecycle";
  isolation?: Partial<
    Pick<
      LocalAdeProcessIsolation,
      "cwdScope" | "projectRootExposed" | "timeoutMs" | "processTreeTerminated"
    >
  >;
}): LocalAdeExecutionPolicy {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const command = params.command.trim();
  const name = executableName(command);
  const args = params.args ?? [];
  const preset = normalizeExecutionPolicyPreset(params.preset);
  const context = params.context ?? "manual-run";

  if (preset === "blocked") {
    blockers.push(
      `${params.kind} execution is disabled by the blocked policy preset.`
    );
  } else if (preset === "restricted") {
    if (params.kind === "hook" && context === "manual-run") {
      blockers.push(
        "Hook manual execution is disabled by the restricted policy preset; lifecycle events remain available."
      );
    } else if (params.kind === "hook") {
      warnings.push(
        "Hook restricted policy allows lifecycle execution and blocks manual runs."
      );
    } else {
      warnings.push(
        "Plugin restricted policy forces temporary sandbox workspace access before execution."
      );
    }
  }

  if (!command) {
    blockers.push(`${params.kind} command is empty.`);
  }
  if (
    SHELL_EVAL_EXECUTABLES.has(name) &&
    args.some((arg) => isShellEvalFlag(arg))
  ) {
    blockers.push(
      `${params.kind} command uses shell evaluation (${name} ${args.join(
        " "
      )}); direct shell eval is blocked by the local ADE sandbox. Use a dedicated script file or direct executable arguments.`
    );
  } else if (SHELL_EVAL_EXECUTABLES.has(name)) {
    warnings.push(
      `${params.kind} command targets shell interpreter ${name}; shell-eval flags remain blocked.`
    );
  }

  return {
    status: blockers.length > 0 ? "blocked" : "allowed",
    sandbox: "direct-spawn",
    isolation: createLocalProcessIsolation({
      cwdScope: params.isolation?.cwdScope ?? "project-root",
      projectRootExposed:
        params.isolation?.projectRootExposed ?? (params.kind === "hook"),
      timeoutMs: params.isolation?.timeoutMs,
      ...(typeof params.isolation?.processTreeTerminated === "boolean"
        ? { processTreeTerminated: params.isolation.processTreeTerminated }
        : {}),
    }),
    blockers,
    warnings,
  };
}

function assertLocalProcessExecutionAllowed(params: {
  kind: "hook" | "plugin";
  name: string;
  command: string;
  args?: string[];
  preset?: LocalAdeExecutionPolicyPreset;
  context?: "manual-run" | "lifecycle";
}): void {
  const policy = localProcessExecutionPolicy({
    kind: params.kind,
    command: params.command,
    args: params.args,
    preset: params.preset,
    context: params.context,
  });
  if (policy.status === "blocked") {
    throw new Error(
      `${params.kind === "hook" ? "Hook" : "Plugin"} execution blocked by local ADE sandbox for ${params.name}: ${policy.blockers.join(" ")}`
    );
  }
}

function parseJsonRpcError(error: unknown): string {
  if (!isRecord(error)) {
    return "Unknown JSON-RPC error.";
  }
  const code = typeof error.code === "number" ? error.code : "unknown";
  const message = typeof error.message === "string" ? error.message : "Unknown error";
  const data = error.data === undefined ? "" : ` data=${JSON.stringify(error.data)}`;
  return `JSON-RPC error ${code}: ${message}${data}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseMcpTools(result: unknown): LocalAdeMcpTool[] {
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    return [];
  }
  return result.tools
    .filter((tool): tool is Record<string, unknown> => isRecord(tool))
    .map((tool) => ({
      name: optionalString(tool.name) ?? "unnamed-tool",
      ...(optionalString(tool.description)
        ? { description: optionalString(tool.description) }
        : {}),
    }))
    .slice(0, MAX_MCP_DISCOVERY_ITEMS);
}

function parseMcpResources(result: unknown): LocalAdeMcpResource[] {
  if (!isRecord(result) || !Array.isArray(result.resources)) {
    return [];
  }
  return result.resources
    .filter((resource): resource is Record<string, unknown> => isRecord(resource))
    .map((resource) => ({
      uri: optionalString(resource.uri) ?? "unknown-resource",
      ...(optionalString(resource.name) ? { name: optionalString(resource.name) } : {}),
      ...(optionalString(resource.description)
        ? { description: optionalString(resource.description) }
        : {}),
      ...(optionalString(resource.mimeType)
        ? { mimeType: optionalString(resource.mimeType) }
        : {}),
    }))
    .slice(0, MAX_MCP_DISCOVERY_ITEMS);
}

function sanitizeMcpInvocationOutput(
  text: string,
  secretValues: string[] = []
): { value: string; truncated: boolean } {
  let sanitized = redactPotentialSecrets(text);
  for (const value of secretValues) {
    if (value.length < 3) {
      continue;
    }
    sanitized = sanitized.split(value).join("[redacted]");
  }
  sanitized = sanitized.replace(/\0/g, "").trim();
  const truncated =
    Buffer.byteLength(sanitized, "utf8") > MAX_MCP_INVOCATION_OUTPUT_BYTES;
  if (!truncated) {
    return { value: sanitized, truncated: false };
  }
  return {
    value: Buffer.from(sanitized, "utf8")
      .subarray(0, MAX_MCP_INVOCATION_OUTPUT_BYTES)
      .toString("utf8")
      .trimEnd(),
    truncated: true,
  };
}

function parseMcpInvocationContent(
  result: unknown,
  secretValues: string[] = []
): {
  content: LocalAdeMcpInvocationContent[];
  resultText: string;
  resultJson: string;
  truncated: boolean;
  isError: boolean;
} {
  const record = isRecord(result) ? result : {};
  const items = Array.isArray(record.content)
    ? record.content
    : Array.isArray(record.contents)
      ? record.contents
      : [];
  const content = items
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item): LocalAdeMcpInvocationContent => {
      const text =
        typeof item.text === "string"
          ? sanitizeMcpInvocationOutput(item.text, secretValues)
          : undefined;
      const blobLength =
        typeof item.blob === "string"
          ? Buffer.byteLength(item.blob, "base64")
          : undefined;
      return {
        type: optionalString(item.type) ?? (item.text ? "text" : "unknown"),
        ...(text?.value ? { text: text.value } : {}),
        ...(optionalString(item.uri) ? { uri: optionalString(item.uri) } : {}),
        ...(optionalString(item.mimeType)
          ? { mimeType: optionalString(item.mimeType) }
          : {}),
        ...(blobLength !== undefined ? { byteLength: blobLength } : {}),
      };
    })
    .slice(0, MAX_MCP_DISCOVERY_ITEMS);

  const textParts = content
    .map((item) => item.text)
    .filter((item): item is string => Boolean(item));
  const outputText = sanitizeMcpInvocationOutput(
    textParts.length > 0 ? textParts.join("\n") : JSON.stringify(result, null, 2),
    secretValues
  );
  const outputJson = sanitizeMcpInvocationOutput(
    JSON.stringify(result, null, 2),
    secretValues
  );

  return {
    content,
    resultText: outputText.value,
    resultJson: outputJson.value,
    truncated: outputText.truncated || outputJson.truncated,
    isError: record.isError === true,
  };
}

function sanitizeMcpNotificationPayload(
  value: unknown,
  secretValues: string[] = []
): { value: string; truncated: boolean } {
  let serialized = "";
  try {
    serialized = JSON.stringify(value ?? {}, null, 2);
  } catch {
    serialized = String(value ?? "");
  }
  const sanitized = sanitizeMcpInvocationOutput(serialized, secretValues).value;
  const bytes = Buffer.byteLength(sanitized, "utf8");
  if (bytes <= MAX_MCP_NOTIFICATION_PAYLOAD_BYTES) {
    return { value: sanitized, truncated: false };
  }
  return {
    value: Buffer.from(sanitized, "utf8")
      .subarray(0, MAX_MCP_NOTIFICATION_PAYLOAD_BYTES)
      .toString("utf8")
      .trimEnd(),
    truncated: true,
  };
}

function sanitizeMcpStoredNotificationPayload(
  value: string
): { value: string; truncated: boolean } {
  const sanitized = sanitizeMcpInvocationOutput(value).value;
  const bytes = Buffer.byteLength(sanitized, "utf8");
  if (bytes <= MAX_MCP_NOTIFICATION_PAYLOAD_BYTES) {
    return { value: sanitized, truncated: false };
  }
  return {
    value: Buffer.from(sanitized, "utf8")
      .subarray(0, MAX_MCP_NOTIFICATION_PAYLOAD_BYTES)
      .toString("utf8")
      .trimEnd(),
    truncated: true,
  };
}

function createMcpNotification(params: {
  server: StoredMcpServer;
  source: LocalAdeMcpNotification["source"];
  message: unknown;
  secretValues?: string[];
}): LocalAdeMcpNotification | undefined {
  if (!isRecord(params.message) || params.message.id !== undefined) {
    return undefined;
  }
  const method = sanitizeMcpHistoryText(params.message.method, 180);
  if (!method) {
    return undefined;
  }
  const payload = sanitizeMcpNotificationPayload(
    params.message.params ?? {},
    params.secretValues
  );
  return {
    id: `mcp-notification-${randomUUID()}`,
    serverId: params.server.id,
    serverName: params.server.name,
    transport: params.server.transport,
    source: params.source,
    method,
    receivedAt: new Date().toISOString(),
    payloadText: payload.value,
    truncated: payload.truncated,
  };
}

function mcpInvocationFailure(params: {
  server: StoredMcpServer;
  method: LocalAdeMcpInvocationResult["method"];
  target: string;
  startedAtMs: number;
  error: string;
  notifications?: LocalAdeMcpNotification[];
  diagnostics?: string[];
}): LocalAdeMcpInvocationResult {
  const finishedAtMs = Date.now();
  return {
    serverId: params.server.id,
    serverName: params.server.name,
    transport: params.server.transport,
    method: params.method,
    target: params.target,
    status: "failed",
    startedAt: new Date(params.startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - params.startedAtMs),
    isError: true,
    resultText: "",
    resultJson: "",
    truncated: false,
    content: [],
    notifications: params.notifications ?? [],
    diagnostics: [
      ...(params.diagnostics ?? []),
      `MCP ${params.method} failed: ${params.error}`,
    ],
  };
}

function mcpInvocationSuccess(params: {
  server: StoredMcpServer;
  method: LocalAdeMcpInvocationResult["method"];
  target: string;
  startedAtMs: number;
  result: unknown;
  secretValues?: string[];
  notifications?: LocalAdeMcpNotification[];
  diagnostics?: string[];
}): LocalAdeMcpInvocationResult {
  const finishedAtMs = Date.now();
  const parsed = parseMcpInvocationContent(params.result, params.secretValues);
  return {
    serverId: params.server.id,
    serverName: params.server.name,
    transport: params.server.transport,
    method: params.method,
    target: params.target,
    status: "success",
    startedAt: new Date(params.startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - params.startedAtMs),
    isError: parsed.isError,
    resultText: parsed.resultText,
    resultJson: parsed.resultJson,
    truncated: parsed.truncated,
    content: parsed.content,
    notifications: params.notifications ?? [],
    diagnostics: params.diagnostics ?? [],
  };
}

async function readMemorySource(params: {
  rootPath: string;
  relativePath: string;
  label: string;
  state: CapabilityStateDocument;
}): Promise<LocalAdeMemorySource> {
  const sourcePath = path.join(params.rootPath, params.relativePath);
  const id = `memory.project.${toHashId(params.rootPath, params.relativePath)}`;
  const stateEntry = params.state.memory?.[id] ?? params.state.capabilities[id];
  if (!existsSync(sourcePath)) {
    return {
      id,
      label: params.label,
      sourcePath,
      relativePath: normalizeSlash(params.relativePath),
      exists: false,
      enabled: false,
      byteLength: 0,
      preview: "",
      warnings: [],
    };
  }

  let raw = "";
  try {
    raw = await readFile(sourcePath, "utf8");
  } catch (error) {
    return {
      id,
      label: params.label,
      sourcePath,
      relativePath: normalizeSlash(params.relativePath),
      exists: true,
      enabled: false,
      byteLength: 0,
      preview: "",
      warnings: [
        `Could not read memory file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const warnings = SECRET_HINT_PATTERN.test(raw)
    ? ["Potential secret-looking text detected; review before including."]
    : [];
  const preview = redactPotentialSecrets(raw).slice(0, MAX_MEMORY_PREVIEW_BYTES);
  return {
    id,
    label: params.label,
    sourcePath,
    relativePath: normalizeSlash(params.relativePath),
    exists: true,
    enabled: stateEntry?.enabled ?? true,
    byteLength: Buffer.byteLength(raw, "utf8"),
    preview,
    warnings,
  };
}

async function readProjectMemory(
  rootPath: string,
  state: CapabilityStateDocument
): Promise<{ sources: LocalAdeMemorySource[]; warnings: string[] }> {
  const sources = await Promise.all([
    readMemorySource({ rootPath, relativePath: "AGENTS.md", label: "AGENTS.md", state }),
    readMemorySource({ rootPath, relativePath: "CLAUDE.md", label: "CLAUDE.md", state }),
    readMemorySource({
      rootPath,
      relativePath: path.join(".eragear", "memory.md"),
      label: "Project memory",
      state,
    }),
    readMemorySource({
      rootPath,
      relativePath: path.join(".eragear", "context.md"),
      label: "Project context",
      state,
    }),
  ]);
  const existing = sources.filter((source) => source.exists);
  return {
    sources: existing,
    warnings: [
      "Project memory is surfaced for review; avoid storing API keys, tokens, passwords, or private keys in Markdown context.",
      ...existing.flatMap((source) => source.warnings.map((warning) => `${source.relativePath}: ${warning}`)),
    ],
  };
}

function clampProjectMemoryContextBytes(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_PROJECT_MEMORY_CONTEXT_BYTES;
  }
  return Math.max(1_000, Math.min(Math.floor(value), MAX_PROJECT_MEMORY_CONTEXT_BYTES));
}

function clampProjectMemorySemanticChunks(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PROJECT_MEMORY_SEMANTIC_CHUNKS;
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_PROJECT_MEMORY_SEMANTIC_CHUNKS));
}

function normalizeProjectMemoryRetrievalMode(
  value: unknown
): ProjectMemoryRetrievalMode {
  return value === "semantic" ? "semantic" : "full";
}

function redactMemoryContextText(text: string): string {
  return redactPotentialSecrets(text)
    .split(/\r?\n/)
    .map((line) => {
      if (!SECRET_HINT_PATTERN.test(line)) {
        return line;
      }
      return line.includes("[redacted]") ? line : "[redacted memory line]";
    })
    .join("\n");
}

const PROJECT_MEMORY_SEARCH_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "before",
  "from",
  "have",
  "into",
  "that",
  "the",
  "this",
  "with",
  "your",
  "will",
  "project",
  "memory",
  "context",
  "please",
  "review",
]);

function tokenizeProjectMemorySearchText(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  return matches.filter((token) => !PROJECT_MEMORY_SEARCH_STOP_WORDS.has(token));
}

function tokenVector(tokens: string[]): number[] {
  const vector = Array.from({ length: PROJECT_MEMORY_VECTOR_DIMENSIONS }, () => 0);
  for (const token of tokens) {
    const hash = createHash("sha1").update(token).digest();
    const index = (hash[0] ?? 0) % PROJECT_MEMORY_VECTOR_DIMENSIONS;
    const sign = (hash[1] ?? 0) % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  return vector;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  const dimensions = Math.max(left.length, right.length);
  for (let index = 0; index < dimensions; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function roundedProjectMemoryScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Math.round(score * 10_000) / 10_000));
}

interface ModelEmbeddingConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

interface ModelEmbeddingResult {
  vectors: number[][];
  diagnostics: string[];
}

function normalizeModelEmbeddingEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/\/embeddings\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  if (/\/v1\/?$/i.test(trimmed)) {
    return `${trimmed.replace(/\/+$/, "")}/embeddings`;
  }
  return `${trimmed.replace(/\/+$/, "")}/v1/embeddings`;
}

function safeEmbeddingEndpointLabel(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return sanitizeDiagnosticText(endpoint).replace(/\?.*$/, "");
  }
}

function resolveModelEmbeddingConfig(): ModelEmbeddingConfig | null {
  const rawEndpoint =
    process.env.ERAGEAR_EMBEDDINGS_ENDPOINT ??
    process.env.ERAGEAR_EMBEDDING_ENDPOINT;
  const endpoint = rawEndpoint ? normalizeModelEmbeddingEndpoint(rawEndpoint) : "";
  if (!endpoint) {
    return null;
  }
  const model =
    process.env.ERAGEAR_EMBEDDINGS_MODEL?.trim() ||
    process.env.ERAGEAR_EMBEDDING_MODEL?.trim() ||
    "text-embedding-3-small";
  const rawTimeout = Number(
    process.env.ERAGEAR_EMBEDDINGS_TIMEOUT_MS ??
      process.env.ERAGEAR_EMBEDDING_TIMEOUT_MS
  );
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.max(1_000, Math.min(30_000, Math.floor(rawTimeout)))
    : MODEL_EMBEDDING_TIMEOUT_MS;
  const apiKey =
    process.env.ERAGEAR_EMBEDDINGS_API_KEY ??
    process.env.ERAGEAR_EMBEDDING_API_KEY;
  return {
    endpoint,
    model,
    ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
    timeoutMs,
  };
}

function sanitizeEmbeddingVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const vector = value
    .slice(0, MAX_MODEL_EMBEDDING_DIMENSIONS)
    .map((item) => (typeof item === "number" && Number.isFinite(item) ? item : 0));
  return vector.some((item) => item !== 0) ? vector : null;
}

function normalizeEmbeddingVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude <= 0) {
    return vector;
  }
  return vector.map((value) => Math.round((value / magnitude) * 1_000_000) / 1_000_000);
}

function embeddingVectorHash(vector: number[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(vector))
    .digest("hex")}`;
}

async function requestModelEmbeddings(params: {
  config: ModelEmbeddingConfig;
  input: string[];
}): Promise<ModelEmbeddingResult> {
  if (params.input.length === 0) {
    return { vectors: [], diagnostics: [] };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.config.timeoutMs);
  try {
    const response = await fetch(params.config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(params.config.apiKey
          ? { authorization: `Bearer ${params.config.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: params.config.model,
        input: params.input,
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Embedding endpoint returned HTTP ${response.status}: ${sanitizeDiagnosticText(
          responseText,
          params.config.apiKey ? [params.config.apiKey] : []
        ).slice(0, 300)}`
      );
    }
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
      throw new Error("Embedding endpoint response did not include data[].embedding.");
    }
    const records = parsed.data;
    const vectors: number[][] = [];
    for (let index = 0; index < params.input.length; index += 1) {
      const record =
        records.find(
          (item) => isRecord(item) && typeof item.index === "number" && item.index === index
        ) ?? records[index];
      const vector = isRecord(record)
        ? sanitizeEmbeddingVector(record.embedding)
        : null;
      if (!vector) {
        throw new Error(`Embedding endpoint returned an empty vector for input ${index}.`);
      }
      vectors.push(normalizeEmbeddingVector(vector));
    }
    return {
      vectors,
      diagnostics: [
        `Model embedding request completed through ${safeEmbeddingEndpointLabel(
          params.config.endpoint
        )}.`,
        `Embedding model ${params.config.model} returned ${vectors.length} vector(s).`,
      ],
    };
  } catch (error) {
    throw new Error(
      `Model embedding request failed: ${errorMessage(
        error,
        params.config.apiKey ? [params.config.apiKey] : []
      )}`
    );
  } finally {
    clearTimeout(timer);
  }
}

interface ProjectMemoryChunkCandidate {
  source: LocalAdeMemorySource;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  text: string;
  byteLength: number;
  score: number;
  ranker?: ProjectSemanticRanker;
  embeddingModel?: string;
  embeddingDimensions?: number;
}

function splitProjectMemorySourceIntoChunks(
  source: LocalAdeMemorySource,
  redacted: string
): Omit<ProjectMemoryChunkCandidate, "score">[] {
  const lines = redacted.split(/\r?\n/);
  const chunks: Omit<ProjectMemoryChunkCandidate, "score">[] = [];
  let current: string[] = [];
  let currentBytes = 0;
  let startLine = 1;

  const pushCurrent = (endLine: number) => {
    const text = current.join("\n").trim();
    if (!text) {
      current = [];
      currentBytes = 0;
      startLine = endLine + 1;
      return;
    }
    chunks.push({
      source,
      chunkIndex: chunks.length + 1,
      startLine,
      endLine,
      text,
      byteLength: Buffer.byteLength(text, "utf8"),
    });
    current = [];
    currentBytes = 0;
    startLine = endLine + 1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (/^#{1,6}\s+\S/.test(line) && current.length > 0) {
      pushCurrent(lineNumber - 1);
      startLine = lineNumber;
    } else if (
      current.length > 0 &&
      currentBytes + lineBytes > MAX_PROJECT_MEMORY_CHUNK_BYTES
    ) {
      pushCurrent(lineNumber - 1);
      startLine = lineNumber;
    }
    current.push(line);
    currentBytes += lineBytes;
  }
  if (current.length > 0) {
    pushCurrent(lines.length);
  }
  return chunks;
}

async function rankProjectMemoryChunkCandidates(params: {
  query: string;
  candidates: ProjectMemoryChunkCandidate[];
}): Promise<{
  candidates: ProjectMemoryChunkCandidate[];
  ranker: ProjectSemanticRanker;
  model?: string;
  dimensions?: number;
  diagnostics: string[];
}> {
  const config = resolveModelEmbeddingConfig();
  if (config && params.candidates.length > 0) {
    try {
      const response = await requestModelEmbeddings({
        config,
        input: [
          params.query,
          ...params.candidates.map((candidate) => candidate.text),
        ],
      });
      const queryVector = response.vectors[0] ?? [];
      const dimensions = queryVector.length;
      const ranked = params.candidates.map((candidate, index) => {
        const vector = response.vectors[index + 1] ?? [];
        return {
          ...candidate,
          score: roundedProjectMemoryScore(cosineSimilarity(queryVector, vector)),
          ranker: "model-embedding" as const,
          embeddingModel: config.model,
          embeddingDimensions: dimensions,
        };
      });
      return {
        candidates: ranked,
        ranker: "model-embedding",
        model: config.model,
        ...(dimensions > 0 ? { dimensions } : {}),
        diagnostics: [
          ...response.diagnostics,
          `Ranked ${ranked.length} project memory chunk(s) with model-backed embeddings.`,
        ],
      };
    } catch (error) {
      const fallback = rankProjectMemoryChunkCandidatesWithLocalTokens(params);
      return {
        ...fallback,
        diagnostics: [
          `Model embedding ranking was unavailable; using local token vectors. ${errorMessage(
            error,
            config.apiKey ? [config.apiKey] : []
          )}`,
          ...fallback.diagnostics,
        ],
      };
    }
  }

  const fallback = rankProjectMemoryChunkCandidatesWithLocalTokens(params);
  return {
    ...fallback,
    diagnostics: [
      "ERAGEAR_EMBEDDINGS_ENDPOINT is not configured; using local token-vector ranking.",
      ...fallback.diagnostics,
    ],
  };
}

function rankProjectMemoryChunkCandidatesWithLocalTokens(params: {
  query: string;
  candidates: ProjectMemoryChunkCandidate[];
}): {
  candidates: ProjectMemoryChunkCandidate[];
  ranker: ProjectSemanticRanker;
  diagnostics: string[];
} {
  const queryTokens = tokenizeProjectMemorySearchText(params.query);
  const queryVector = tokenVector(queryTokens);
  const ranked = params.candidates.map((candidate) => {
    const chunkTokens = tokenizeProjectMemorySearchText(candidate.text);
    return {
      ...candidate,
      score: roundedProjectMemoryScore(
        cosineSimilarity(queryVector, tokenVector(chunkTokens))
      ),
      ranker: "local-token-vector" as const,
    };
  });
  return {
    candidates: ranked,
    ranker: "local-token-vector",
    diagnostics: [
      `Ranked ${ranked.length} project memory chunk(s) with local token vectors.`,
    ],
  };
}

function normalizeMemorySourcePath(value: string): string {
  return normalizeSlash(value.trim()).replace(/^\.\//, "").toLowerCase();
}

function normalizeProjectMemoryPresetName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw new Error("Project memory preset name is required.");
  }
  return name.slice(0, MAX_PROJECT_MEMORY_PRESET_NAME_CHARS);
}

function normalizeProjectMemoryPresetDefaultQuery(
  value: string | undefined
): string | undefined {
  const query = value?.trim().replace(/\s+/g, " ");
  return query ? query.slice(0, 500) : undefined;
}

function normalizeProjectMemoryPresetSourcePaths(
  value: unknown,
  knownSources?: LocalAdeMemorySource[]
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownByPath = new Map(
    (knownSources ?? []).map((source) => [
      normalizeMemorySourcePath(source.relativePath),
      source.relativePath,
    ])
  );
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = normalizeMemorySourcePath(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    const sourcePath = knownByPath.get(normalized);
    if (knownSources && !sourcePath) {
      continue;
    }
    seen.add(normalized);
    result.push(sourcePath ?? normalizeSlash(item.trim()).replace(/^\.\//, ""));
    if (result.length >= 8) {
      break;
    }
  }
  return result;
}

function normalizeProjectMemoryPreset(
  item: unknown
): LocalAdeProjectMemoryPreset | null {
  if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
    return null;
  }
  const id = item.id.trim();
  const rawName = item.name.trim();
  if (!id || !rawName) {
    return null;
  }
  const sourcePaths = normalizeProjectMemoryPresetSourcePaths(item.sourcePaths);
  const defaultQuery = normalizeProjectMemoryPresetDefaultQuery(
    typeof item.defaultQuery === "string" ? item.defaultQuery : undefined
  );
  const createdAt =
    typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString();
  const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;
  return {
    id,
    name: rawName.slice(0, MAX_PROJECT_MEMORY_PRESET_NAME_CHARS),
    sourcePaths,
    ...(defaultQuery ? { defaultQuery } : {}),
    retrievalMode: normalizeProjectMemoryRetrievalMode(item.retrievalMode),
    maxBytes: clampProjectMemoryContextBytes(
      typeof item.maxBytes === "number" ? item.maxBytes : undefined
    ),
    maxChunks: clampProjectMemorySemanticChunks(
      typeof item.maxChunks === "number" ? item.maxChunks : undefined
    ),
    createdAt,
    updatedAt,
    ...(typeof item.lastUsedAt === "string" ? { lastUsedAt: item.lastUsedAt } : {}),
    diagnostics: Array.isArray(item.diagnostics)
      ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

async function readProjectMemoryPresetDocument(
  rootPath: string
): Promise<ProjectMemoryPresetDocument> {
  const parsed = await readJsonObject(
    path.join(ensureProjectDataDir(rootPath), PROJECT_MEMORY_PRESETS_FILE)
  );
  if (!parsed || !Array.isArray(parsed.presets)) {
    return { version: 1, presets: [] };
  }
  return {
    version: 1,
    presets: parsed.presets
      .map((item) => normalizeProjectMemoryPreset(item))
      .filter((item): item is LocalAdeProjectMemoryPreset => Boolean(item))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_PROJECT_MEMORY_PRESETS),
  };
}

async function writeProjectMemoryPresetDocument(
  rootPath: string,
  document: ProjectMemoryPresetDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, PROJECT_MEMORY_PRESETS_FILE),
    `${JSON.stringify(
      {
        version: 1,
        presets: document.presets
          .slice(0, MAX_PROJECT_MEMORY_PRESETS)
          .map((preset) => ({
            id: preset.id,
            name: preset.name,
            sourcePaths: preset.sourcePaths,
            ...(preset.defaultQuery ? { defaultQuery: preset.defaultQuery } : {}),
            retrievalMode: normalizeProjectMemoryRetrievalMode(
              preset.retrievalMode
            ),
            maxBytes: clampProjectMemoryContextBytes(preset.maxBytes),
            maxChunks: clampProjectMemorySemanticChunks(preset.maxChunks),
            createdAt: preset.createdAt,
            updatedAt: preset.updatedAt,
            ...(preset.lastUsedAt ? { lastUsedAt: preset.lastUsedAt } : {}),
            diagnostics: preset.diagnostics,
          })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function createProjectMemoryPresetDiagnostics(
  preset: Pick<LocalAdeProjectMemoryPreset, "sourcePaths">,
  sources: LocalAdeMemorySource[]
): string[] {
  const sourcesByPath = new Map(
    sources.map((source) => [normalizeMemorySourcePath(source.relativePath), source])
  );
  const diagnostics: string[] = [];
  for (const sourcePath of preset.sourcePaths) {
    const source = sourcesByPath.get(normalizeMemorySourcePath(sourcePath));
    if (!source) {
      diagnostics.push(`Preset source ${sourcePath} is not available in this project.`);
      continue;
    }
    if (!source.enabled) {
      diagnostics.push(`Preset source ${source.relativePath} is currently disabled.`);
    }
    diagnostics.push(
      ...source.warnings.map((warning) => `${source.relativePath}: ${warning}`)
    );
  }
  return diagnostics;
}

async function buildProjectMemoryContextResult(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  query: string;
  preset?: LocalAdeProjectMemoryPreset;
  retrievalMode?: ProjectMemoryRetrievalMode;
  sourceIds?: string[];
  sourcePaths?: string[];
  maxBytes?: number;
  maxChunks?: number;
}): Promise<LocalAdeProjectMemoryContextResult> {
  const query = params.query.trim();
  const retrievalMode = normalizeProjectMemoryRetrievalMode(params.retrievalMode);
  const memory = await readProjectMemory(params.rootPath, params.state);
  const sourceIdFilter = new Set(
    (params.sourceIds ?? []).map((id) => id.trim()).filter(Boolean)
  );
  const sourcePathFilter = new Set(
    (params.sourcePaths ?? [])
      .map(normalizeMemorySourcePath)
      .filter(Boolean)
  );
  const hasSourceFilter = sourceIdFilter.size > 0 || sourcePathFilter.size > 0;
  const enabledSources = memory.sources.filter((source) => {
    if (!source.enabled) {
      return false;
    }
    if (!hasSourceFilter) {
      return true;
    }
    return (
      sourceIdFilter.has(source.id) ||
      sourcePathFilter.has(normalizeMemorySourcePath(source.relativePath))
    );
  });
  const maxBytes = clampProjectMemoryContextBytes(params.maxBytes);
  const maxChunks = clampProjectMemorySemanticChunks(params.maxChunks);

  if (retrievalMode === "semantic") {
    const candidates: ProjectMemoryChunkCandidate[] = [];
    const totalChunksBySourceId = new Map<string, number>();

    for (const source of enabledSources) {
      const raw = await readFile(source.sourcePath, "utf8");
      const redacted = redactMemoryContextText(raw).trim();
      const sourceChunks = splitProjectMemorySourceIntoChunks(source, redacted);
      totalChunksBySourceId.set(source.id, sourceChunks.length);
      for (const chunk of sourceChunks) {
        candidates.push({ ...chunk, score: 0 });
      }
    }

    const semanticRanking = await rankProjectMemoryChunkCandidates({
      query,
      candidates,
    });

    const rankedCandidates = semanticRanking.candidates.sort(
      (left, right) =>
        right.score - left.score ||
        left.source.relativePath.localeCompare(right.source.relativePath) ||
        left.chunkIndex - right.chunkIndex
    );
    const selectedChunks: LocalAdeProjectMemoryContextChunk[] = [];
    const sections: string[] = [];
    let remainingBytes = maxBytes;

    for (const candidate of rankedCandidates) {
      if (selectedChunks.length >= maxChunks || remainingBytes <= 0) {
        break;
      }
      const textBytes = Buffer.byteLength(candidate.text, "utf8");
      const slice =
        textBytes > remainingBytes
          ? candidate.text.slice(0, Math.max(0, remainingBytes))
          : candidate.text;
      const includedBytes = Buffer.byteLength(slice, "utf8");
      if (includedBytes <= 0) {
        continue;
      }
      const truncated = textBytes > includedBytes;
      remainingBytes -= includedBytes;
      selectedChunks.push({
        sourceId: candidate.source.id,
        label: candidate.source.label,
        relativePath: candidate.source.relativePath,
        chunkIndex: candidate.chunkIndex,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        score: candidate.score,
        ...(candidate.ranker ? { ranker: candidate.ranker } : {}),
        ...(candidate.embeddingModel
          ? { embeddingModel: candidate.embeddingModel }
          : {}),
        includedBytes,
        truncated,
      });
      sections.push(
        [
          `Memory chunk ${selectedChunks.length}: ${candidate.source.label}`,
          `Path: ${candidate.source.relativePath}`,
          `Lines: ${candidate.startLine}-${candidate.endLine}`,
          semanticRanking.ranker === "model-embedding"
            ? `Model embedding score: ${candidate.score.toFixed(4)}`
            : `Local vector score: ${candidate.score.toFixed(4)}`,
          truncated ? `Content truncated to fit ${maxBytes} byte budget.` : "",
          "",
          slice,
        ]
          .filter((line) => line.length > 0)
          .join("\n")
      );
    }

    const includedBytesBySourceId = new Map<string, number>();
    const selectedCountBySourceId = new Map<string, number>();
    const truncatedSourceIds = new Set<string>();
    for (const chunk of selectedChunks) {
      includedBytesBySourceId.set(
        chunk.sourceId,
        (includedBytesBySourceId.get(chunk.sourceId) ?? 0) + chunk.includedBytes
      );
      selectedCountBySourceId.set(
        chunk.sourceId,
        (selectedCountBySourceId.get(chunk.sourceId) ?? 0) + 1
      );
      if (chunk.truncated) {
        truncatedSourceIds.add(chunk.sourceId);
      }
    }
    const includedSources = enabledSources
      .filter((source) => includedBytesBySourceId.has(source.id))
      .map((source) => ({
        id: source.id,
        label: source.label,
        relativePath: source.relativePath,
        byteLength: source.byteLength,
        includedBytes: includedBytesBySourceId.get(source.id) ?? 0,
        truncated:
          truncatedSourceIds.has(source.id) ||
          (selectedCountBySourceId.get(source.id) ?? 0) <
            (totalChunksBySourceId.get(source.id) ?? 0),
        warnings: source.warnings,
      }));

    if (selectedChunks.length === 0) {
      return {
        status: "ready",
        query,
        retrievalMode,
        ...(params.preset
          ? { presetId: params.preset.id, presetName: params.preset.name }
          : {}),
        sources: [],
        chunks: [],
        semantic: {
          ranker: semanticRanking.ranker,
          ...(semanticRanking.model ? { model: semanticRanking.model } : {}),
          ...(semanticRanking.dimensions
            ? { dimensions: semanticRanking.dimensions }
            : {}),
          diagnostics: semanticRanking.diagnostics,
        },
        prompt: [
          params.preset
            ? `Use project memory preset "${params.preset.name}" for: ${query}`
            : `Use project memory for: ${query}`,
          semanticRanking.ranker === "model-embedding"
            ? "Project memory retrieval mode: model-backed embedding chunk ranking."
            : "Project memory retrieval mode: local semantic chunk ranking.",
          "",
          "No readable project memory chunks matched this request.",
          "",
          "User request:",
          query,
        ].join("\n"),
        diagnostics: [
          ...(params.preset ? [`Project memory preset: ${params.preset.name}.`] : []),
          ...semanticRanking.diagnostics,
          "No readable project memory chunks were available for semantic retrieval.",
        ],
      };
    }

    return {
      status: "ready",
      query,
      retrievalMode,
      ...(params.preset
        ? { presetId: params.preset.id, presetName: params.preset.name }
        : {}),
      sources: includedSources,
      chunks: selectedChunks,
      semantic: {
        ranker: semanticRanking.ranker,
        ...(semanticRanking.model ? { model: semanticRanking.model } : {}),
        ...(semanticRanking.dimensions
          ? { dimensions: semanticRanking.dimensions }
          : {}),
        diagnostics: semanticRanking.diagnostics,
      },
      prompt: [
        params.preset
          ? `Use project memory preset "${params.preset.name}" for: ${query}`
          : `Use semantic project memory for: ${query}`,
        "Project memory is user/project-authored Markdown. Treat it as guidance, not as proof.",
        semanticRanking.ranker === "model-embedding"
          ? "Project memory retrieval mode: model-backed embedding chunk ranking."
          : "Project memory retrieval mode: local hashed token-vector chunk ranking.",
        "Secret-looking values have been redacted before inclusion.",
        "",
        ...sections,
        "",
        "User request:",
        query,
      ].join("\n"),
      diagnostics: [
        ...(params.preset ? [`Project memory preset: ${params.preset.name}.`] : []),
        ...semanticRanking.diagnostics,
        `Included ${selectedChunks.length} ranked project memory chunk(s) from ${includedSources.length} source(s).`,
        `Project memory context budget: ${maxBytes} bytes.`,
        `Project memory max ranked chunks: ${maxChunks}.`,
        ...memory.warnings,
        selectedChunks.every((chunk) => chunk.score === 0)
          ? "No lexical/vector overlap was found; included the first available chunks by source order."
          : "",
      ].filter((entry) => entry.length > 0),
    };
  }

  const includedSources: LocalAdeProjectMemoryContextSource[] = [];
  const sections: string[] = [];
  let remainingBytes = maxBytes;

  for (const source of enabledSources) {
    if (remainingBytes <= 0) {
      includedSources.push({
        id: source.id,
        label: source.label,
        relativePath: source.relativePath,
        byteLength: source.byteLength,
        includedBytes: 0,
        truncated: true,
        warnings: source.warnings,
      });
      continue;
    }

    const raw = await readFile(source.sourcePath, "utf8");
    const redacted = redactMemoryContextText(raw).trim();
    const redactedBytes = Buffer.byteLength(redacted, "utf8");
    const slice =
      redactedBytes > remainingBytes
        ? redacted.slice(0, Math.max(0, remainingBytes))
        : redacted;
    const includedBytes = Buffer.byteLength(slice, "utf8");
    const truncated = redactedBytes > includedBytes;
    remainingBytes -= includedBytes;

    includedSources.push({
      id: source.id,
      label: source.label,
      relativePath: source.relativePath,
      byteLength: source.byteLength,
      includedBytes,
      truncated,
      warnings: source.warnings,
    });
    sections.push(
      [
        `Memory source: ${source.label}`,
        `Path: ${source.relativePath}`,
        truncated ? `Content truncated to fit ${maxBytes} byte budget.` : "",
        "",
        slice,
      ]
        .filter((line) => line.length > 0)
        .join("\n")
    );
  }

  if (includedSources.length === 0) {
    return {
      status: "no-enabled-sources",
      query,
      retrievalMode,
      ...(params.preset
        ? { presetId: params.preset.id, presetName: params.preset.name }
        : {}),
      sources: [],
      chunks: [],
      prompt: [
        params.preset
          ? `Use project memory preset "${params.preset.name}" for: ${query}`
          : `Use project memory for: ${query}`,
        "",
        "No enabled project memory sources are available.",
        "Enable AGENTS.md, CLAUDE.md, .eragear/memory.md, or .eragear/context.md in Local ADE before using /memory.",
        "",
        "User request:",
        query,
      ].join("\n"),
      diagnostics: [
        ...(params.preset ? [`Project memory preset: ${params.preset.name}.`] : []),
        hasSourceFilter
          ? "No selected project memory sources are enabled."
          : "No project memory sources are enabled.",
      ],
    };
  }

  return {
    status: "ready",
    query,
    retrievalMode,
    ...(params.preset
      ? { presetId: params.preset.id, presetName: params.preset.name }
      : {}),
    sources: includedSources,
    chunks: [],
    prompt: [
      params.preset
        ? `Use project memory preset "${params.preset.name}" for: ${query}`
        : `Use enabled project memory for: ${query}`,
      "Project memory is user/project-authored Markdown. Treat it as guidance, not as proof.",
      "Secret-looking values have been redacted before inclusion.",
      "",
      ...sections,
      "",
      "User request:",
      query,
    ].join("\n"),
    diagnostics: [
      ...(params.preset ? [`Project memory preset: ${params.preset.name}.`] : []),
      `Included ${includedSources.length} enabled project memory source(s).`,
      `Project memory context budget: ${maxBytes} bytes.`,
      ...memory.warnings,
      ...(includedSources.some((source) => source.truncated)
        ? ["One or more project memory sources were truncated to fit the context budget."]
        : []),
    ],
  };
}

const REPO_INDEX_IGNORED_DIR_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

const REPO_INDEX_IGNORED_RELATIVE_PREFIXES = [
  ".eragear/checkpoints",
  ".eragear/logs",
  ".eragear/cache",
];

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".cjs", "JavaScript"],
  [".css", "CSS"],
  [".go", "Go"],
  [".html", "HTML"],
  [".java", "Java"],
  [".js", "JavaScript"],
  [".json", "JSON"],
  [".jsx", "JavaScript"],
  [".md", "Markdown"],
  [".py", "Python"],
  [".rs", "Rust"],
  [".sql", "SQL"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".yaml", "YAML"],
  [".yml", "YAML"],
]);

const REPO_INDEX_SCAN_EXTENSIONS = new Set([
  ".cjs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".ts",
  ".tsx",
]);

const TASK_MARKER_PATTERN = /\b(TODO|FIXME|HACK|BUG|XXX)\b[:\-\s]*(.*)$/i;

function shouldSkipRepoIndexDirectory(rootPath: string, directoryPath: string): boolean {
  const relative = normalizeSlash(path.relative(rootPath, directoryPath));
  if (!relative || relative === ".") {
    return false;
  }
  const segments = relative.split("/");
  if (segments.some((segment) => REPO_INDEX_IGNORED_DIR_NAMES.has(segment))) {
    return true;
  }
  return REPO_INDEX_IGNORED_RELATIVE_PREFIXES.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`)
  );
}

function extensionForIndex(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return extension || "[none]";
}

function languageForExtension(extension: string): string | undefined {
  return LANGUAGE_BY_EXTENSION.get(extension);
}

function summarizeRepoIndexExtensions(
  files: LocalAdeRepoIndexFile[]
): Array<{ extension: string; count: number }> {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.extension, (counts.get(file.extension) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([extension, count]) => ({ extension, count }))
    .sort((left, right) => right.count - left.count || left.extension.localeCompare(right.extension))
    .slice(0, 12);
}

function parseRepoIndexSymbols(input: unknown): LocalAdeRepoIndexSymbol[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const symbols: LocalAdeRepoIndexSymbol[] = [];
  for (const item of input) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.name !== "string" ||
      typeof item.kind !== "string" ||
      typeof item.line !== "number"
    ) {
      continue;
    }
    const kind =
      item.kind === "class" ||
      item.kind === "function" ||
      item.kind === "interface" ||
      item.kind === "type" ||
      item.kind === "component" ||
      item.kind === "export"
        ? item.kind
        : "export";
    const symbol: LocalAdeRepoIndexSymbol = {
      path: normalizeSlash(item.path),
      name: item.name.trim(),
      kind,
      line: Math.max(1, Math.floor(item.line)),
    };
    if (typeof item.language === "string" && item.language.trim()) {
      symbol.language = item.language.trim();
    }
    if (symbol.name) {
      symbols.push(symbol);
    }
  }
  return symbols.slice(0, MAX_REPO_INDEX_SYMBOLS);
}

function parseRepoIndexTasks(input: unknown): LocalAdeRepoIndexTask[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const tasks: LocalAdeRepoIndexTask[] = [];
  for (const item of input) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.marker !== "string" ||
      typeof item.line !== "number" ||
      typeof item.text !== "string"
    ) {
      continue;
    }
    const marker = item.marker.toUpperCase();
    if (
      marker !== "TODO" &&
      marker !== "FIXME" &&
      marker !== "HACK" &&
      marker !== "BUG" &&
      marker !== "XXX"
    ) {
      continue;
    }
    tasks.push({
      path: normalizeSlash(item.path),
      marker,
      line: Math.max(1, Math.floor(item.line)),
      text: sanitizeDiagnosticText(item.text),
    });
  }
  return tasks.slice(0, MAX_REPO_INDEX_TASKS);
}

function parseRepoIndexFiles(input: unknown): RepoIndexFileRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const files: RepoIndexFileRecord[] = [];
  for (const item of input) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.sizeBytes !== "number" ||
      typeof item.extension !== "string"
    ) {
      continue;
    }
    const file: RepoIndexFileRecord = {
      path: normalizeSlash(item.path),
      sizeBytes: Math.max(0, Math.floor(item.sizeBytes)),
      extension: item.extension,
    };
    if (typeof item.modifiedAt === "string" && item.modifiedAt.trim()) {
      file.modifiedAt = item.modifiedAt;
    }
    if (typeof item.language === "string" && item.language.trim()) {
      file.language = item.language;
    }
    if (Array.isArray(item.semanticTags)) {
      const semanticTags = sanitizeRepoIndexSemanticTags(item.semanticTags);
      if (semanticTags.length > 0) {
        file.semanticTags = semanticTags;
      }
    }
    if (typeof item.semanticHash === "string" && item.semanticHash.trim()) {
      file.semanticHash = item.semanticHash.trim().slice(0, 80);
    }
    if (typeof item.embeddingModel === "string" && item.embeddingModel.trim()) {
      file.embeddingModel = item.embeddingModel.trim().slice(0, 120);
    }
    if (typeof item.embeddingDimensions === "number") {
      file.embeddingDimensions = Math.max(0, Math.floor(item.embeddingDimensions));
    }
    if (typeof item.embeddingHash === "string" && item.embeddingHash.trim()) {
      file.embeddingHash = item.embeddingHash.trim().slice(0, 80);
    }
    const embeddingVector = sanitizeEmbeddingVector(item.embeddingVector);
    if (embeddingVector) {
      file.embeddingVector = normalizeEmbeddingVector(embeddingVector);
      file.embeddingDimensions = file.embeddingVector.length;
      file.embeddingHash = file.embeddingHash ?? embeddingVectorHash(file.embeddingVector);
    }
    files.push(file);
  }
  return files.slice(0, MAX_REPO_INDEX_FILES);
}

function toVisibleRepoIndexFile(file: RepoIndexFileRecord): LocalAdeRepoIndexFile {
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    extension: file.extension,
    ...(file.modifiedAt ? { modifiedAt: file.modifiedAt } : {}),
    ...(file.language ? { language: file.language } : {}),
    ...(file.semanticTags ? { semanticTags: file.semanticTags } : {}),
    ...(file.semanticHash ? { semanticHash: file.semanticHash } : {}),
    ...(file.embeddingModel ? { embeddingModel: file.embeddingModel } : {}),
    ...(file.embeddingDimensions
      ? { embeddingDimensions: file.embeddingDimensions }
      : {}),
    ...(file.embeddingHash ? { embeddingHash: file.embeddingHash } : {}),
  };
}

async function readRepoIndexDocument(
  rootPath: string
): Promise<RepoIndexDocument | null> {
  const parsed = await readJsonObject(
    path.join(ensureProjectDataDir(rootPath), REPO_INDEX_FILE)
  );
  if (!parsed || typeof parsed.indexedAt !== "string") {
    return null;
  }
  const files = parseRepoIndexFiles(parsed.files);
  const symbols = parseRepoIndexSymbols(parsed.symbols);
  const tasks = parseRepoIndexTasks(parsed.tasks);
  const diagnostics = Array.isArray(parsed.diagnostics)
    ? parsed.diagnostics.filter((item): item is string => typeof item === "string")
    : [];
  return {
    version: 1,
    rootPath: typeof parsed.rootPath === "string" ? parsed.rootPath : rootPath,
    indexedAt: parsed.indexedAt,
    files,
    symbols,
    tasks,
    totalBytes:
      typeof parsed.totalBytes === "number"
        ? Math.max(0, Math.floor(parsed.totalBytes))
        : files.reduce((sum, file) => sum + file.sizeBytes, 0),
    diagnostics,
  };
}

function toRepoIndexSnapshot(
  rootPath: string,
  document: RepoIndexDocument | null
): LocalAdeRepoIndexSnapshot {
  const storagePath = path.join(ensureProjectDataDir(rootPath), REPO_INDEX_FILE);
  if (!document) {
    return {
      storagePath,
      indexedFiles: 0,
      totalBytes: 0,
      semantic: {
        status: "empty",
        profiledFiles: 0,
        tokenCount: 0,
        source: "local-token-profile",
      },
      extensions: [],
      files: [],
      symbols: [],
      tasks: [],
      diagnostics: ["Project index has not been refreshed yet."],
    };
  }
  return {
    storagePath,
    indexedAt: document.indexedAt,
    indexedFiles: document.files.length,
    totalBytes: document.totalBytes,
    semantic: repoIndexSemanticSummary(document.files),
    extensions: summarizeRepoIndexExtensions(document.files),
    files: document.files
      .slice(0, MAX_REPO_INDEX_VISIBLE_FILES)
      .map((file) => toVisibleRepoIndexFile(file)),
    symbols: (document.symbols ?? []).slice(0, MAX_REPO_INDEX_SYMBOLS),
    tasks: (document.tasks ?? []).slice(0, MAX_REPO_INDEX_TASKS),
    diagnostics: document.diagnostics,
  };
}

function clampRepoIndexSearchLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_REPO_INDEX_SEARCH_RESULTS;
  }
  return Math.max(1, Math.min(MAX_REPO_INDEX_SEARCH_RESULTS, Math.floor(value)));
}

function tokenizeRepoIndexQuery(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of query
    .toLowerCase()
    .split(/[^a-z0-9_$.-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)) {
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
    if (tokens.length >= MAX_REPO_INDEX_QUERY_TOKENS) {
      break;
    }
  }
  return tokens;
}

function splitRepoIndexIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$.-]+/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 48);
}

const REPO_INDEX_SEMANTIC_ALIAS_GROUPS = [
  ["agent", "assistant", "delegate", "subagent"],
  ["auth", "login", "credential", "credentials", "token"],
  ["checkpoint", "snapshot", "savepoint", "restorepoint"],
  ["context", "memory", "instruction", "knowledge"],
  ["diagnostic", "diagnostics", "health", "status", "readiness"],
  ["index", "search", "retrieval", "semantic", "embedding", "vector"],
  ["mcp", "tool", "tools", "resource", "resources", "protocol"],
  ["plugin", "extension", "addon", "package"],
  ["provider", "model", "llm", "inference"],
  ["restore", "rollback", "undo", "revert", "recover"],
  ["runtime", "process", "session", "worker"],
  ["safety", "safe", "guard", "guarded", "trust"],
] as const;

const REPO_INDEX_SEMANTIC_ALIASES = new Map<string, string[]>(
  REPO_INDEX_SEMANTIC_ALIAS_GROUPS.flatMap((group) =>
    group.map((token) => [token, [...group]] as const)
  )
);

function expandRepoIndexSemanticTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    for (const alias of REPO_INDEX_SEMANTIC_ALIASES.get(token) ?? []) {
      expanded.add(alias);
    }
  }
  return [...expanded].slice(0, MAX_REPO_INDEX_FILE_SEMANTIC_TOKENS);
}

function sanitizeRepoIndexSemanticTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const tags = new Set<string>();
  for (const item of input) {
    for (const token of splitRepoIndexIdentifier(String(item))) {
      if (SECRET_HINT_PATTERN.test(token)) {
        continue;
      }
      tags.add(token);
      for (const alias of REPO_INDEX_SEMANTIC_ALIASES.get(token) ?? []) {
        tags.add(alias);
      }
      if (tags.size >= MAX_REPO_INDEX_FILE_SEMANTIC_TOKENS) {
        return [...tags].sort((left, right) => left.localeCompare(right));
      }
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}

function redactRepoIndexSemanticText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !SECRET_HINT_PATTERN.test(line))
    .join("\n")
    .slice(0, MAX_REPO_INDEX_SEMANTIC_TEXT_BYTES);
}

function buildRepoIndexSemanticTags(params: {
  relativePath: string;
  extension: string;
  language?: string;
  raw: string;
  symbols: LocalAdeRepoIndexSymbol[];
  tasks: LocalAdeRepoIndexTask[];
}): string[] {
  const fragments = [
    params.relativePath,
    params.extension,
    params.language ?? "",
    ...params.symbols.flatMap((symbol) => [symbol.name, symbol.kind]),
    ...params.tasks.map((task) => `${task.marker} ${task.text}`),
    redactRepoIndexSemanticText(params.raw),
  ];
  return sanitizeRepoIndexSemanticTags(fragments);
}

function repoIndexSemanticHash(tags: string[]): string | undefined {
  if (tags.length === 0) {
    return undefined;
  }
  return `sha256:${createHash("sha256").update(tags.join("\n")).digest("hex")}`;
}

function repoIndexSemanticSummary(
  files: RepoIndexFileRecord[]
): LocalAdeRepoIndexSnapshot["semantic"] {
  const profiledFiles = files.filter((file) => (file.semanticTags?.length ?? 0) > 0);
  const embeddedFiles = files.filter((file) => (file.embeddingVector?.length ?? 0) > 0);
  const tokenCount = profiledFiles.reduce(
    (sum, file) => sum + (file.semanticTags?.length ?? 0),
    0
  );
  const firstEmbedded = embeddedFiles[0];
  return {
    status: embeddedFiles.length > 0 || profiledFiles.length > 0 ? "ready" : "empty",
    profiledFiles: profiledFiles.length,
    tokenCount,
    source: embeddedFiles.length > 0 ? "model-embedding" : "local-token-profile",
    ...(embeddedFiles.length > 0 ? { embeddedFiles: embeddedFiles.length } : {}),
    ...(firstEmbedded?.embeddingModel ? { model: firstEmbedded.embeddingModel } : {}),
    ...(firstEmbedded?.embeddingDimensions
      ? { dimensions: firstEmbedded.embeddingDimensions }
      : {}),
    ...(embeddedFiles.length > 0 ? { provider: "openai-compatible" as const } : {}),
  };
}

function scoreRepoIndexText(params: {
  text: string | undefined;
  phrase: string;
  tokens: string[];
  weight: number;
}): number {
  const text = params.text?.trim().toLowerCase();
  if (!text) {
    return 0;
  }
  let score = 0;
  if (params.phrase && text.includes(params.phrase)) {
    score += 12 * params.weight;
  }
  for (const token of params.tokens) {
    if (text === token) {
      score += 10 * params.weight;
    } else if (text.includes(token)) {
      score += Math.max(2, Math.min(8, token.length)) * params.weight;
    }
  }
  return score;
}

function scoreRepoIndexSemanticTags(params: {
  tags: string[] | undefined;
  tokens: string[];
  weight: number;
}): number {
  if (!params.tags || params.tags.length === 0 || params.tokens.length === 0) {
    return 0;
  }
  const tagSet = new Set(params.tags);
  const expandedQuery = expandRepoIndexSemanticTokens(params.tokens);
  let score = 0;
  for (const token of expandedQuery) {
    if (tagSet.has(token)) {
      score += 7 * params.weight;
    }
  }
  return score;
}

function searchRepoIndexDocument(params: {
  document: RepoIndexDocument;
  query: string;
  limit?: number;
  queryEmbedding?: number[];
}): LocalAdeRepoIndexSearchItem[] {
  const phrase = params.query.trim().toLowerCase();
  const tokens = tokenizeRepoIndexQuery(params.query);
  const results: LocalAdeRepoIndexSearchItem[] = [];

  for (const file of params.document.files) {
    const directScore =
      scoreRepoIndexText({ text: file.path, phrase, tokens, weight: 1.4 }) +
      scoreRepoIndexText({ text: file.language, phrase, tokens, weight: 0.8 }) +
      scoreRepoIndexText({ text: file.extension, phrase, tokens, weight: 0.5 });
    const semanticScore = scoreRepoIndexSemanticTags({
      tags: file.semanticTags,
      tokens,
      weight: 1,
    });
    const embeddingSimilarity =
      params.queryEmbedding && file.embeddingVector
        ? roundedProjectMemoryScore(
            cosineSimilarity(params.queryEmbedding, file.embeddingVector)
          )
        : 0;
    const embeddingScore = embeddingSimilarity >= 0.12 ? embeddingSimilarity * 48 : 0;
    const score = directScore + semanticScore + embeddingScore;
    if (score <= 0) {
      continue;
    }
    const detailParts = [
      `${file.language ?? file.extension} - ${file.sizeBytes} bytes`,
      semanticScore > 0 ? "semantic profile match" : "",
      embeddingScore > 0
        ? `model embedding match ${embeddingSimilarity.toFixed(4)}`
        : "",
    ].filter((item) => item.length > 0);
    results.push({
      type: "file",
      path: file.path,
      title: file.path,
      detail: detailParts.join(" - "),
      score,
      matchKind:
        directScore > 0 ? "direct" : embeddingScore > 0 ? "embedding" : "semantic",
      ...(file.language ? { language: file.language } : {}),
    });
  }

  for (const symbol of params.document.symbols ?? []) {
    const score =
      scoreRepoIndexText({ text: symbol.name, phrase, tokens, weight: 4 }) +
      scoreRepoIndexText({ text: symbol.kind, phrase, tokens, weight: 1 }) +
      scoreRepoIndexText({ text: symbol.path, phrase, tokens, weight: 1.2 }) +
      scoreRepoIndexText({ text: symbol.language, phrase, tokens, weight: 0.8 });
    if (score <= 0) {
      continue;
    }
    results.push({
      type: "symbol",
      path: symbol.path,
      title: `${symbol.kind} ${symbol.name}`,
      detail: `${symbol.path}:${symbol.line}`,
      score,
      line: symbol.line,
      ...(symbol.language ? { language: symbol.language } : {}),
    });
  }

  for (const task of params.document.tasks ?? []) {
    const score =
      scoreRepoIndexText({ text: task.text, phrase, tokens, weight: 3 }) +
      scoreRepoIndexText({ text: task.marker, phrase, tokens, weight: 2 }) +
      scoreRepoIndexText({ text: task.path, phrase, tokens, weight: 1.2 });
    if (score <= 0) {
      continue;
    }
    results.push({
      type: "task",
      path: task.path,
      title: `${task.marker} ${task.path}`,
      detail: `${task.path}:${task.line} - ${task.text}`,
      score,
      line: task.line,
      marker: task.marker,
    });
  }

  const typePriority: Record<LocalAdeRepoIndexSearchItem["type"], number> = {
    symbol: 0,
    task: 1,
    file: 2,
  };

  return results
    .sort(
      (left, right) =>
        right.score - left.score ||
        typePriority[left.type] - typePriority[right.type] ||
        left.path.localeCompare(right.path) ||
        (left.line ?? 0) - (right.line ?? 0)
    )
    .slice(0, clampRepoIndexSearchLimit(params.limit));
}

function buildRepoIndexContextPrompt(params: {
  query: string;
  document: RepoIndexDocument | null;
  results: LocalAdeRepoIndexSearchItem[];
  status: LocalAdeRepoIndexSearchResult["status"];
}): string {
  const query = params.query.trim();
  if (!params.document) {
    return [
      `Search the local project index for: ${query}`,
      "",
      "The project index has not been refreshed yet.",
      "Refresh Project Index in Settings > Memory before using /index for retrieval.",
    ].join("\n");
  }

  const hasModelEmbeddings = params.document.files.some(
    (file) => (file.embeddingVector?.length ?? 0) > 0
  );
  const lines = [
    `Use the local project index context for: ${query}`,
    `Index timestamp: ${params.document.indexedAt}`,
    hasModelEmbeddings
      ? "The index contains metadata, code-symbol signals, task markers, model-backed embedding vectors, and local semantic token profiles; bounded redacted excerpts were embedded."
      : "The index contains metadata, code-symbol signals, task markers, and local semantic token profiles; full file contents are not embedded.",
    "Before editing, read the referenced files directly.",
    "",
    params.results.length > 0
      ? "Matched project index entries:"
      : "No project index entries matched this query.",
    ...params.results.map((item, index) => {
      const location = item.line ? `${item.path}:${item.line}` : item.path;
      const match = item.matchKind ? ` - match:${item.matchKind}` : "";
      return `${index + 1}. [${item.type}] ${item.title} - ${location} - ${item.detail}${match}`;
    }),
    "",
    "User request:",
    query,
  ];

  if (params.status === "no-results") {
    lines.splice(
      4,
      0,
      "Use this as a signal that the index had no direct hit; ask for a narrower symbol, file, or task if needed."
    );
  }

  return lines.join("\n");
}

async function buildRepoIndexSearchResult(params: {
  query: string;
  document: RepoIndexDocument | null;
  limit?: number;
}): Promise<LocalAdeRepoIndexSearchResult> {
  const query = params.query.trim();
  if (!params.document) {
    const diagnostics = ["Project index has not been refreshed yet."];
    return {
      status: "not-indexed",
      query,
      results: [],
      prompt: buildRepoIndexContextPrompt({
        query,
        document: null,
        results: [],
        status: "not-indexed",
      }),
      diagnostics,
    };
  }

  const diagnostics = [
    "Project index search uses bounded metadata, symbols, task markers, model-backed embedding vectors when configured, and local semantic token profiles.",
  ];
  let queryEmbedding: number[] | undefined;
  const embeddedFiles = params.document.files.filter(
    (file) => (file.embeddingVector?.length ?? 0) > 0
  );
  if (embeddedFiles.length > 0) {
    const config = resolveModelEmbeddingConfig();
    if (config) {
      try {
        const response = await requestModelEmbeddings({
          config,
          input: [query],
        });
        queryEmbedding = response.vectors[0];
        diagnostics.push(...response.diagnostics);
        diagnostics.push(
          `Compared query embedding against ${embeddedFiles.length} indexed file vector(s).`
        );
      } catch (error) {
        diagnostics.push(
          `Model-backed query embedding was unavailable; using direct and local semantic profile search. ${errorMessage(
            error,
            config.apiKey ? [config.apiKey] : []
          )}`
        );
      }
    } else {
      diagnostics.push(
        "Indexed file vectors are present, but ERAGEAR_EMBEDDINGS_ENDPOINT is not configured for query embedding."
      );
    }
  }

  const results = searchRepoIndexDocument({
    document: params.document,
    query,
    limit: params.limit,
    ...(queryEmbedding ? { queryEmbedding } : {}),
  });
  const status: LocalAdeRepoIndexSearchResult["status"] =
    results.length > 0 ? "ready" : "no-results";
  if (status === "no-results") {
    diagnostics.push("No indexed file, symbol, or task marker matched the query.");
  }
  return {
    status,
    query,
    indexedAt: params.document.indexedAt,
    results,
    prompt: buildRepoIndexContextPrompt({
      query,
      document: params.document,
      results,
      status,
    }),
    diagnostics,
  };
}

function symbolFromLine(params: {
  line: string;
  extension: string;
}): Pick<LocalAdeRepoIndexSymbol, "kind" | "name"> | null {
  const trimmed = params.line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) {
    return null;
  }

  const classMatch = trimmed.match(
    /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/
  );
  if (classMatch?.[1]) {
    return { kind: "class", name: classMatch[1] };
  }

  const interfaceMatch = trimmed.match(
    /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/
  );
  if (interfaceMatch?.[1]) {
    return { kind: "interface", name: interfaceMatch[1] };
  }

  const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/);
  if (typeMatch?.[1]) {
    return { kind: "type", name: typeMatch[1] };
  }

  const functionMatch = trimmed.match(
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/
  );
  if (functionMatch?.[1]) {
    return { kind: "function", name: functionMatch[1] };
  }

  const constMatch = trimmed.match(
    /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$])/
  );
  if (constMatch?.[1]) {
    const name = constMatch[1];
    return {
      kind: /^[A-Z]/.test(name) && /\.(tsx|jsx)$/.test(params.extension)
        ? "component"
        : "export",
      name,
    };
  }

  if (params.extension === ".py") {
    const pythonMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/);
    const name = pythonMatch?.[1] ?? pythonMatch?.[2];
    if (name) {
      return { kind: trimmed.startsWith("class ") ? "class" : "function", name };
    }
  }

  if (params.extension === ".go") {
    const goFunc = trimmed.match(/^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/);
    if (goFunc?.[1]) {
      return { kind: "function", name: goFunc[1] };
    }
    const goType = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/);
    if (goType?.[1]) {
      return { kind: "type", name: goType[1] };
    }
  }

  if (params.extension === ".rs") {
    const rustMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)|^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/);
    const name = rustMatch?.[1] ?? rustMatch?.[2];
    if (name) {
      return {
        kind: rustMatch?.[1] ? "function" : "type",
        name,
      };
    }
  }

  return null;
}

async function scanRepoIndexSignals(params: {
  absolutePath: string;
  relativePath: string;
  extension: string;
  language?: string;
  sizeBytes: number;
}): Promise<{
  symbols: LocalAdeRepoIndexSymbol[];
  tasks: LocalAdeRepoIndexTask[];
  semanticTags: string[];
  semanticHash?: string;
  diagnostics: string[];
}> {
  if (
    params.sizeBytes > MAX_REPO_INDEX_FILE_SCAN_BYTES ||
    !REPO_INDEX_SCAN_EXTENSIONS.has(params.extension)
  ) {
    return { symbols: [], tasks: [], semanticTags: [], diagnostics: [] };
  }

  let raw = "";
  try {
    raw = await readFile(params.absolutePath, "utf8");
  } catch (error) {
    return {
      symbols: [],
      tasks: [],
      semanticTags: [],
      diagnostics: [
        `Skipped signal scan for ${params.relativePath}: ${errorMessage(error)}`,
      ],
    };
  }

  const symbols: LocalAdeRepoIndexSymbol[] = [];
  const tasks: LocalAdeRepoIndexTask[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    if (symbols.length < 24) {
      const symbol = symbolFromLine({
        line,
        extension: params.extension,
      });
      if (symbol) {
        symbols.push({
          path: params.relativePath,
          name: symbol.name,
          kind: symbol.kind,
          line: lineNumber,
          ...(params.language ? { language: params.language } : {}),
        });
      }
    }
    if (tasks.length < 16) {
      const taskMatch = line.match(TASK_MARKER_PATTERN);
      if (taskMatch?.[1]) {
        tasks.push({
          path: params.relativePath,
          marker: taskMatch[1].toUpperCase() as LocalAdeRepoIndexTask["marker"],
          line: lineNumber,
          text: sanitizeDiagnosticText(taskMatch[2] ?? line).slice(0, 220),
        });
      }
    }
  }

  const semanticTags = buildRepoIndexSemanticTags({
    relativePath: params.relativePath,
    extension: params.extension,
    ...(params.language ? { language: params.language } : {}),
    raw,
    symbols,
    tasks,
  });
  const semanticHash = repoIndexSemanticHash(semanticTags);

  return {
    symbols,
    tasks,
    semanticTags,
    ...(semanticHash ? { semanticHash } : {}),
    diagnostics: [],
  };
}

function buildRepoIndexEmbeddingInput(params: {
  file: RepoIndexFileRecord;
  raw: string;
  symbols: LocalAdeRepoIndexSymbol[];
  tasks: LocalAdeRepoIndexTask[];
}): string {
  const relatedSymbols = params.symbols
    .filter((symbol) => symbol.path === params.file.path)
    .slice(0, 24)
    .map((symbol) => `${symbol.kind} ${symbol.name} line ${symbol.line}`);
  const relatedTasks = params.tasks
    .filter((task) => task.path === params.file.path)
    .slice(0, 16)
    .map((task) => `${task.marker} line ${task.line}: ${task.text}`);
  return [
    `Path: ${params.file.path}`,
    `Type: ${params.file.language ?? params.file.extension}`,
    `Semantic tags: ${(params.file.semanticTags ?? []).join(", ")}`,
    relatedSymbols.length > 0 ? `Symbols: ${relatedSymbols.join("; ")}` : "",
    relatedTasks.length > 0 ? `Tasks: ${relatedTasks.join("; ")}` : "",
    "Redacted bounded excerpt:",
    redactRepoIndexSemanticText(params.raw),
  ]
    .filter((line) => line.length > 0)
    .join("\n")
    .slice(0, MAX_REPO_INDEX_SEMANTIC_TEXT_BYTES);
}

function repoIndexPathDepth(filePath: string): number {
  return normalizeSlash(filePath).split("/").filter(Boolean).length;
}

function repoIndexEmbeddingSignalCount(file: RepoIndexFileRecord): number {
  return (
    (file.semanticTags?.length ?? 0) +
    (file.language ? 4 : 0) +
    (file.extension === ".md" ? 2 : 0)
  );
}

async function applyRepoIndexModelEmbeddings(params: {
  rootPath: string;
  files: RepoIndexFileRecord[];
  symbols: LocalAdeRepoIndexSymbol[];
  tasks: LocalAdeRepoIndexTask[];
  diagnostics: string[];
}): Promise<void> {
  const config = resolveModelEmbeddingConfig();
  if (!config) {
    params.diagnostics.push(
      "ERAGEAR_EMBEDDINGS_ENDPOINT is not configured; Project Index is using local semantic token profiles."
    );
    return;
  }

  const candidates: Array<{ file: RepoIndexFileRecord; input: string }> = [];
  const prioritizedFiles = [...params.files].sort(
    (left, right) =>
      repoIndexPathDepth(left.path) - repoIndexPathDepth(right.path) ||
      repoIndexEmbeddingSignalCount(right) - repoIndexEmbeddingSignalCount(left) ||
      left.path.localeCompare(right.path)
  );

  for (const file of prioritizedFiles) {
    if (candidates.length >= MAX_REPO_INDEX_EMBEDDING_FILES) {
      break;
    }
    if (
      file.sizeBytes > MAX_REPO_INDEX_FILE_SCAN_BYTES ||
      !REPO_INDEX_SCAN_EXTENSIONS.has(file.extension)
    ) {
      continue;
    }
    const absolutePath = path.resolve(params.rootPath, file.path);
    if (!absolutePath.startsWith(path.resolve(params.rootPath))) {
      continue;
    }
    try {
      const raw = await readFile(absolutePath, "utf8");
      candidates.push({
        file,
        input: buildRepoIndexEmbeddingInput({
          file,
          raw,
          symbols: params.symbols,
          tasks: params.tasks,
        }),
      });
    } catch (error) {
      params.diagnostics.push(
        `Skipped model embedding for ${file.path}: ${errorMessage(error)}`
      );
    }
  }

  if (candidates.length === 0) {
    params.diagnostics.push("No indexable files were eligible for model embeddings.");
    return;
  }

  try {
    let embedded = 0;
    for (let offset = 0; offset < candidates.length; offset += MODEL_EMBEDDING_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + MODEL_EMBEDDING_BATCH_SIZE);
      const response = await requestModelEmbeddings({
        config,
        input: batch.map((candidate) => candidate.input),
      });
      params.diagnostics.push(...response.diagnostics);
      for (let index = 0; index < batch.length; index += 1) {
        const vector = response.vectors[index];
        if (!vector) {
          continue;
        }
        const file = batch[index]?.file;
        if (!file) {
          continue;
        }
        file.embeddingVector = vector;
        file.embeddingModel = config.model;
        file.embeddingDimensions = vector.length;
        file.embeddingHash = embeddingVectorHash(vector);
        embedded += 1;
      }
    }
    params.diagnostics.push(
      `Project Index stored ${embedded} model-backed embedding vector(s) for ${config.model}.`
    );
  } catch (error) {
    params.diagnostics.push(
      `Model-backed Project Index embeddings were unavailable; using local semantic token profiles. ${errorMessage(
        error,
        config.apiKey ? [config.apiKey] : []
      )}`
    );
  }
}

async function createRepoIndexDocument(rootPath: string): Promise<RepoIndexDocument> {
  const files: RepoIndexFileRecord[] = [];
  const symbols: LocalAdeRepoIndexSymbol[] = [];
  const tasks: LocalAdeRepoIndexTask[] = [];
  const diagnostics: string[] = [
    "Project index stores file metadata, code-symbol signals, task markers, model-backed embedding vectors when configured, and local semantic token profiles as fallback.",
  ];

  async function visit(directory: string): Promise<void> {
    if (files.length >= MAX_REPO_INDEX_FILES) {
      return;
    }
    let entries: Dirent[] = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(`Skipped unreadable directory ${shortPathForDiagnostic(directory)}: ${errorMessage(error)}`);
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_REPO_INDEX_FILES) {
        return;
      }
      const child = path.join(directory, entry.name);
      const relative = normalizeSlash(path.relative(rootPath, child));
      if (entry.isDirectory()) {
        if (!shouldSkipRepoIndexDirectory(rootPath, child)) {
          await visit(child);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      try {
        const info = await stat(child);
        const extension = extensionForIndex(relative);
        const language = languageForExtension(extension);
        const file: RepoIndexFileRecord = {
          path: relative,
          sizeBytes: info.size,
          extension,
          modifiedAt: info.mtime.toISOString(),
        };
        if (language) {
          file.language = language;
        }
        let signals:
          | Awaited<ReturnType<typeof scanRepoIndexSignals>>
          | undefined;
        if (
          symbols.length < MAX_REPO_INDEX_SYMBOLS ||
          tasks.length < MAX_REPO_INDEX_TASKS ||
          REPO_INDEX_SCAN_EXTENSIONS.has(extension)
        ) {
          signals = await scanRepoIndexSignals({
            absolutePath: child,
            relativePath: relative,
            extension,
            ...(language ? { language } : {}),
            sizeBytes: info.size,
          });
          diagnostics.push(...signals.diagnostics);
          if (signals.semanticTags.length > 0) {
            file.semanticTags = signals.semanticTags;
          }
          if (signals.semanticHash) {
            file.semanticHash = signals.semanticHash;
          }
          if (symbols.length < MAX_REPO_INDEX_SYMBOLS) {
            symbols.push(
              ...signals.symbols.slice(0, MAX_REPO_INDEX_SYMBOLS - symbols.length)
            );
          }
          if (tasks.length < MAX_REPO_INDEX_TASKS) {
            tasks.push(...signals.tasks.slice(0, MAX_REPO_INDEX_TASKS - tasks.length));
          }
        }
        files.push(file);
      } catch (error) {
        diagnostics.push(`Skipped unreadable file ${relative}: ${errorMessage(error)}`);
      }
    }
  }

  await visit(rootPath);
  files.sort((left, right) => left.path.localeCompare(right.path));
  symbols.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  tasks.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  if (files.length >= MAX_REPO_INDEX_FILES) {
    diagnostics.push(`Index reached the ${MAX_REPO_INDEX_FILES} file limit.`);
  }
  if (symbols.length >= MAX_REPO_INDEX_SYMBOLS) {
    diagnostics.push(`Symbol scan reached the ${MAX_REPO_INDEX_SYMBOLS} item limit.`);
  }
  if (tasks.length >= MAX_REPO_INDEX_TASKS) {
    diagnostics.push(`Task scan reached the ${MAX_REPO_INDEX_TASKS} item limit.`);
  }
  await applyRepoIndexModelEmbeddings({
    rootPath,
    files,
    symbols,
    tasks,
    diagnostics,
  });

  return {
    version: 1,
    rootPath,
    indexedAt: new Date().toISOString(),
    files,
    symbols,
    tasks,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    diagnostics,
  };
}

async function writeRepoIndexDocument(
  rootPath: string,
  document: RepoIndexDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, REPO_INDEX_FILE),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8"
  );
}

function shortPathForDiagnostic(filePath: string): string {
  const normalized = normalizeSlash(filePath);
  const parts = normalized.split("/");
  return parts.length <= 4 ? normalized : `.../${parts.slice(-3).join("/")}`;
}

function normalizeHookEvent(value: string | undefined): string {
  const normalized = (value ?? "manual")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "manual";
}

function clampHookTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_HOOK_TIMEOUT_MS;
  }
  return Math.max(500, Math.min(MAX_HOOK_TIMEOUT_MS, Math.floor(value)));
}

function sanitizeHookArgs(args: string[] | undefined): string[] {
  return (args ?? [])
    .map((arg) => String(arg).trim())
    .filter(Boolean)
    .slice(0, 32);
}

function sanitizeHookEnvKeys(input: unknown): string[] {
  return sanitizePluginEnvKeys(input);
}

function hookExecutionFingerprint(
  hook: Pick<
    StoredHook,
    "command" | "args" | "workingDirectory" | "event" | "envKeys" | "policyPreset"
  >
): string {
  const payload = JSON.stringify({
    version: 1,
    event: normalizeHookEvent(hook.event),
    policyPreset: normalizeExecutionPolicyPreset(hook.policyPreset),
    command: hook.command.trim(),
    args: (hook.args ?? []).map((arg) => String(arg)),
    workingDirectory: normalizeSlash(hook.workingDirectory ?? "."),
    envKeys: sanitizeHookEnvKeys(hook.envKeys),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function hookTrustStatus(
  hook: StoredHook,
  fingerprint = hookExecutionFingerprint(hook)
): LocalAdeHookDescriptor["trustStatus"] {
  if (!hook.trustedFingerprint) {
    return "untrusted";
  }
  return hook.trustedFingerprint === fingerprint ? "trusted" : "changed";
}

function hookRunConfirmationToken(hook: Pick<StoredHook, "id">): string {
  return `RUN HOOK ${hook.id}`;
}

function hookRunOperationFingerprint(hook: StoredHook): string {
  const payload = JSON.stringify({
    version: 1,
    operation: "manual-run",
    hookId: hook.id,
    event: normalizeHookEvent(hook.event),
    policyPreset: normalizeExecutionPolicyPreset(hook.policyPreset),
    executionFingerprint: hookExecutionFingerprint(hook),
    command: hook.command,
    args: hook.args ?? [],
    workingDirectory: hook.workingDirectory ?? null,
    envKeys: sanitizeHookEnvKeys(hook.envKeys),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function pruneHookRunApprovals(
  approvals: StoredHookRunApproval[]
): StoredHookRunApproval[] {
  return approvals.slice(-MAX_HOOK_RUN_APPROVALS);
}

function hookRunOperationApprovalStatus(
  hook: StoredHook,
  approvals: StoredHookRunApproval[],
  fingerprint = hookRunOperationFingerprint(hook),
  nowMs = Date.now()
): Pick<
  LocalAdeHookRunOperation,
  "approvalStatus" | "approvalId" | "approvedAt" | "expiresAt" | "consumedAt"
> {
  const hookApprovals = approvals
    .filter((approval) => approval.hookId === hook.id)
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
  const matching = hookApprovals.find(
    (approval) => approval.fingerprint === fingerprint
  );
  if (matching?.consumedAt) {
    return {
      approvalStatus: "consumed",
      approvalId: matching.id,
      approvedAt: matching.approvedAt,
      expiresAt: matching.expiresAt,
      consumedAt: matching.consumedAt,
    };
  }
  if (matching) {
    const expiresMs = Date.parse(matching.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
      return {
        approvalStatus: "approved",
        approvalId: matching.id,
        approvedAt: matching.approvedAt,
        expiresAt: matching.expiresAt,
      };
    }
    return {
      approvalStatus: "expired",
      approvalId: matching.id,
      approvedAt: matching.approvedAt,
      expiresAt: matching.expiresAt,
    };
  }
  const latestUnconsumed = hookApprovals.find((approval) => !approval.consumedAt);
  if (latestUnconsumed) {
    return {
      approvalStatus: "changed",
      approvalId: latestUnconsumed.id,
      approvedAt: latestUnconsumed.approvedAt,
      expiresAt: latestUnconsumed.expiresAt,
    };
  }
  return { approvalStatus: "missing" };
}

function hookRunOperationPreview(
  rootPath: string,
  hook: StoredHook,
  approvals: StoredHookRunApproval[]
): LocalAdeHookRunOperation {
  const executionFingerprint = hookExecutionFingerprint(hook);
  const fingerprint = hookRunOperationFingerprint(hook);
  const status = hookRunOperationApprovalStatus(hook, approvals, fingerprint);
  const isolation = createLocalProcessIsolation({
    cwdScope: "project-root",
    projectRootExposed: true,
    timeoutMs: clampHookTimeout(hook.timeoutMs),
  });
  return {
    operation: "manual-run",
    fingerprint,
    ...status,
    cwd: resolveHookWorkingDirectory(rootPath, hook),
    command: hook.command,
    args: hook.args ?? [],
    event: normalizeHookEvent(hook.event),
    envKeys: sanitizeHookEnvKeys(hook.envKeys),
    executionFingerprint,
    isolation,
    diagnostics: [
      `Hook run operation fingerprint: ${fingerprint}.`,
      `Manual hook run operation approval status: ${status.approvalStatus}.`,
      `Hook run approval expires after ${
        HOOK_RUN_APPROVAL_TTL_MS / 1000
      } seconds.`,
      ...isolation.diagnostics,
    ],
  };
}

function assertHookReadyForManualRun(hook: StoredHook): void {
  if (!hook.enabled) {
    throw new Error(`Hook is disabled: ${hook.name}`);
  }
  if (!hook.command.trim()) {
    throw new Error(`Hook command is empty: ${hook.name}`);
  }
  assertLocalProcessExecutionAllowed({
    kind: "hook",
    name: hook.name,
    command: hook.command,
    args: hook.args,
    preset: hook.policyPreset,
    context: "manual-run",
  });
  const fingerprint = hookExecutionFingerprint(hook);
  const trustStatus = hookTrustStatus(hook, fingerprint);
  if (trustStatus !== "trusted") {
    throw new Error(
      trustStatus === "changed"
        ? `Hook command, args, event, working directory, or env keys changed after trust approval: ${hook.name} (${fingerprint})`
        : `Hook must be trusted before execution: ${hook.name} (${fingerprint})`
    );
  }
}

function assertHookRunConfirmation(hook: StoredHook, confirmation: string): void {
  const expected = hookRunConfirmationToken(hook);
  if (confirmation.trim() !== expected) {
    throw new Error(`Hook run confirmation mismatch. Type ${expected} to execute.`);
  }
}

function hookExecutionEnv(
  rootPath: string,
  hook: StoredHook,
  event: string,
  context: Record<string, string | undefined> | undefined
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PLUGIN_BASE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  for (const key of sanitizeHookEnvKeys(hook.envKeys)) {
    const value = process.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return {
    ...env,
    ERAGEAR_HOOK_EVENT: event,
    ERAGEAR_HOOK_ID: hook.id,
    ERAGEAR_HOOK_NAME: hook.name,
    ERAGEAR_PROJECT_ROOT: rootPath,
    ERAGEAR_HOOK_ENV_KEYS: sanitizeHookEnvKeys(hook.envKeys).join(","),
    ...hookContextEnv(context),
  };
}

function normalizeHookLifecycleFailureMode(
  value: unknown
): LocalAdeHookLifecycleFailureMode {
  return value === "stop-on-failure" ? "stop-on-failure" : "continue";
}

function sanitizeHookLifecycleEvents(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const events = new Set<string>();
  for (const item of input) {
    const event = normalizeHookEvent(typeof item === "string" ? item : String(item));
    if (event && event !== "manual") {
      events.add(event);
    }
  }
  return [...events].slice(0, 32);
}

function normalizeHookLifecyclePolicy(
  input: unknown
): StoredHookLifecyclePolicy {
  const source = isRecord(input) ? input : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    disabledEvents: sanitizeHookLifecycleEvents(source.disabledEvents),
    failureMode: normalizeHookLifecycleFailureMode(source.failureMode),
    ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
  };
}

function visibleHookLifecyclePolicy(
  policy: StoredHookLifecyclePolicy
): LocalAdeHookLifecyclePolicy {
  const normalized = normalizeHookLifecyclePolicy(policy);
  const disabledEvents = sanitizeHookLifecycleEvents(normalized.disabledEvents);
  return {
    enabled: normalized.enabled ?? true,
    disabledEvents,
    failureMode: normalizeHookLifecycleFailureMode(normalized.failureMode),
    ...(normalized.updatedAt ? { updatedAt: normalized.updatedAt } : {}),
    diagnostics: [
      normalized.enabled === false
        ? "Lifecycle hook dispatch is paused for this project."
        : "Lifecycle hook dispatch is enabled for this project.",
      disabledEvents.length > 0
        ? `Lifecycle events paused: ${disabledEvents.join(", ")}.`
        : "No lifecycle events are paused.",
      `Lifecycle failure mode: ${normalizeHookLifecycleFailureMode(normalized.failureMode)}.`,
    ],
  };
}

function clampAutomationMaxConcurrentRuns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AUTOMATION_MAX_CONCURRENT_RUNS;
  }
  return Math.min(
    MAX_AUTOMATION_MAX_CONCURRENT_RUNS,
    Math.max(1, Math.trunc(value))
  );
}

function clampAutomationCooldownMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(
    MAX_AUTOMATION_COOLDOWN_MS,
    Math.max(0, Math.trunc(value))
  );
}

function normalizeAutomationSchedulingPolicy(
  input: unknown
): StoredAutomationSchedulingPolicy {
  const source = isRecord(input) ? input : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    maxConcurrentRuns: clampAutomationMaxConcurrentRuns(source.maxConcurrentRuns),
    cooldownMs: clampAutomationCooldownMs(source.cooldownMs),
    ...(typeof source.updatedAt === "string" ? { updatedAt: source.updatedAt } : {}),
  };
}

function visibleAutomationSchedulingPolicy(
  policy: StoredAutomationSchedulingPolicy
): LocalAdeAutomationSchedulingPolicy {
  const normalized = normalizeAutomationSchedulingPolicy(policy);
  const maxConcurrentRuns = clampAutomationMaxConcurrentRuns(
    normalized.maxConcurrentRuns
  );
  const cooldownMs = clampAutomationCooldownMs(normalized.cooldownMs);
  return {
    enabled: normalized.enabled ?? true,
    maxConcurrentRuns,
    cooldownMs,
    ...(normalized.updatedAt ? { updatedAt: normalized.updatedAt } : {}),
    diagnostics: [
      normalized.enabled === false
        ? "Automation scheduling is paused for this surface."
        : "Automation scheduling is enabled for this surface.",
      `Maximum concurrent runs: ${maxConcurrentRuns}.`,
      cooldownMs > 0
        ? `Per-item cooldown: ${cooldownMs}ms.`
        : "Per-item cooldown is disabled.",
    ],
  };
}

function clampPluginBatchScheduleIntervalMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5 * 60 * 1000;
  }
  return Math.min(
    MAX_PLUGIN_BATCH_SCHEDULE_INTERVAL_MS,
    Math.max(MIN_PLUGIN_BATCH_SCHEDULE_INTERVAL_MS, Math.trunc(value))
  );
}

function normalizePluginBatchScheduleNextRunAt(
  value: unknown,
  fallbackIso: string
): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallbackIso;
}

function sanitizePluginBatchOperationFingerprints(
  value: unknown
): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [pluginId, fingerprint] of Object.entries(value)) {
    const key = pluginId.trim();
    const next = String(fingerprint).trim();
    if (key && next.startsWith("sha256:")) {
      result[key] = next;
    }
  }
  return result;
}

function toVisiblePluginBatchSchedules(
  document: PluginDocument
): LocalAdePluginBatchSchedule[] {
  const nowMs = Date.now();
  return document.batchSchedules.map((schedule) => {
    const preset = document.batchPresets.find(
      (item) => item.id === schedule.presetId
    );
    const diagnostics = [
      ...(Array.isArray(schedule.diagnostics)
        ? schedule.diagnostics.map((diagnostic) =>
            sanitizeDiagnosticText(diagnostic)
          )
        : []),
    ];
    const pluginIds = preset?.pluginIds ?? [];
    const pluginNames = preset?.pluginNames ?? [];
    const missingFingerprintIds = pluginIds.filter(
      (pluginId) => !schedule.operationFingerprints[pluginId]
    );
    const staleFingerprintIds = pluginIds.filter((pluginId) => {
      const plugin = document.plugins.find((item) => item.id === pluginId);
      if (!plugin) {
        return false;
      }
      return schedule.operationFingerprints[pluginId] !== pluginRunOperationFingerprint(plugin);
    });
    let status: LocalAdePluginBatchScheduleStatus = "scheduled";
    if (!schedule.enabled) {
      status = "paused";
      diagnostics.push("Plugin batch schedule is paused.");
    } else if (!preset) {
      status = "missing-preset";
      diagnostics.push(
        `Plugin batch schedule references missing preset: ${schedule.presetId}.`
      );
    } else if (missingFingerprintIds.length > 0 || staleFingerprintIds.length > 0) {
      status = "stale-fingerprint";
      if (missingFingerprintIds.length > 0) {
        diagnostics.push(
          `Schedule is missing operation fingerprint(s): ${missingFingerprintIds.join(", ")}.`
        );
      }
      if (staleFingerprintIds.length > 0) {
        diagnostics.push(
          `Schedule operation fingerprint changed for plugin(s): ${staleFingerprintIds.join(", ")}.`
        );
      }
    } else if (Date.parse(schedule.nextRunAt) <= nowMs) {
      status = "due";
      diagnostics.push("Plugin batch schedule is due now.");
    } else {
      diagnostics.push(`Plugin batch schedule next run: ${schedule.nextRunAt}.`);
    }
    return {
      id: schedule.id,
      name: schedule.name,
      presetId: schedule.presetId,
      ...(preset ? { presetName: preset.name } : {}),
      enabled: schedule.enabled,
      intervalMs: schedule.intervalMs,
      nextRunAt: schedule.nextRunAt,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      ...(schedule.lastRunAt ? { lastRunAt: schedule.lastRunAt } : {}),
      ...(schedule.lastRunBatchId
        ? { lastRunBatchId: schedule.lastRunBatchId }
        : {}),
      ...(schedule.lastRunStatus
        ? { lastRunStatus: schedule.lastRunStatus }
        : {}),
      pluginIds,
      pluginNames,
      operationFingerprints: schedule.operationFingerprints,
      status,
      diagnostics,
    };
  });
}

function automationRunTrackerKey(
  rootPath: string,
  kind: "hook" | "plugin"
): string {
  return `${kind}:${path.resolve(rootPath)}`;
}

function activeAutomationRunCount(
  rootPath: string,
  kind: "hook" | "plugin"
): number {
  return automationActiveRuns.get(automationRunTrackerKey(rootPath, kind)) ?? 0;
}

function latestAutomationRunFinishedAt(
  runs: Array<Pick<LocalAdeHookRun, "hookId" | "finishedAt">> | Array<Pick<LocalAdePluginRun, "pluginId" | "finishedAt">>,
  kind: "hook" | "plugin",
  itemId: string
): string | undefined {
  for (const run of runs) {
    if (
      (kind === "hook" && "hookId" in run && run.hookId === itemId) ||
      (kind === "plugin" && "pluginId" in run && run.pluginId === itemId)
    ) {
      return run.finishedAt;
    }
  }
  return undefined;
}

function automationSchedulingState(params: {
  rootPath: string;
  kind: "hook" | "plugin";
  itemId: string;
  policy: StoredAutomationSchedulingPolicy;
  runs:
    | Array<Pick<LocalAdeHookRun, "hookId" | "finishedAt">>
    | Array<Pick<LocalAdePluginRun, "pluginId" | "finishedAt">>;
}): LocalAdeAutomationSchedulingState {
  const policy = visibleAutomationSchedulingPolicy(params.policy);
  const activeRuns = activeAutomationRunCount(params.rootPath, params.kind);
  const base = {
    activeRuns,
    maxConcurrentRuns: policy.maxConcurrentRuns,
    cooldownMs: policy.cooldownMs,
  };
  if (!policy.enabled) {
    return {
      ...base,
      status: "paused",
      diagnostics: [
        ...policy.diagnostics,
        `${params.kind} automation run is paused by scheduling policy.`,
      ],
    };
  }
  if (activeRuns >= policy.maxConcurrentRuns) {
    return {
      ...base,
      status: "parallel-limit",
      diagnostics: [
        ...policy.diagnostics,
        `${params.kind} automation run is blocked because ${activeRuns}/${policy.maxConcurrentRuns} run slots are active.`,
      ],
    };
  }
  const lastFinishedAt = latestAutomationRunFinishedAt(
    params.runs,
    params.kind,
    params.itemId
  );
  if (lastFinishedAt && policy.cooldownMs > 0) {
    const lastFinishedMs = Date.parse(lastFinishedAt);
    const nextAllowedMs = lastFinishedMs + policy.cooldownMs;
    if (Number.isFinite(lastFinishedMs) && nextAllowedMs > Date.now()) {
      const nextAllowedAt = new Date(nextAllowedMs).toISOString();
      return {
        ...base,
        status: "cooldown",
        nextAllowedAt,
        diagnostics: [
          ...policy.diagnostics,
          `${params.kind} automation run is cooling down until ${nextAllowedAt}.`,
        ],
      };
    }
  }
  return {
    ...base,
    status: "ready",
    diagnostics: [
      ...policy.diagnostics,
      `${params.kind} automation run is ready for execution.`,
    ],
  };
}

function automationSchedulingBlockMessage(
  kind: "hook" | "plugin",
  name: string,
  state: LocalAdeAutomationSchedulingState
): string {
  if (state.status === "paused") {
    return `${kind} automation run skipped for ${name} because scheduling is paused.`;
  }
  if (state.status === "parallel-limit") {
    return `${kind} automation run skipped for ${name} because the parallel run limit is active (${state.activeRuns}/${state.maxConcurrentRuns}).`;
  }
  if (state.status === "cooldown") {
    return `${kind} automation run skipped for ${name} because cooldown is active until ${state.nextAllowedAt ?? "the next allowed run"}.`;
  }
  return `${kind} automation run skipped for ${name} by scheduling policy.`;
}

function acquireAutomationRun(params: {
  rootPath: string;
  kind: "hook" | "plugin";
  itemId: string;
  policy: StoredAutomationSchedulingPolicy;
  runs:
    | Array<Pick<LocalAdeHookRun, "hookId" | "finishedAt">>
    | Array<Pick<LocalAdePluginRun, "pluginId" | "finishedAt">>;
}): { state: LocalAdeAutomationSchedulingState; release?: () => void } {
  const state = automationSchedulingState(params);
  if (state.status !== "ready") {
    return { state };
  }
  const key = automationRunTrackerKey(params.rootPath, params.kind);
  const activeRuns = automationActiveRuns.get(key) ?? 0;
  if (activeRuns >= state.maxConcurrentRuns) {
    return {
      state: {
        ...state,
        status: "parallel-limit",
        activeRuns,
        diagnostics: [
          ...state.diagnostics,
          `${params.kind} automation run lost its execution slot before spawn.`,
        ],
      },
    };
  }
  automationActiveRuns.set(key, activeRuns + 1);
  return {
    state: {
      ...state,
      activeRuns: activeRuns + 1,
    },
    release: () => {
      const current = automationActiveRuns.get(key) ?? 0;
      if (current <= 1) {
        automationActiveRuns.delete(key);
      } else {
        automationActiveRuns.set(key, current - 1);
      }
    },
  };
}

async function readHookDocument(rootPath: string): Promise<HookDocument> {
  const parsed = await readJsonObject(path.join(ensureProjectDataDir(rootPath), HOOKS_FILE));
  if (!parsed || !Array.isArray(parsed.hooks)) {
    return {
      version: 1,
      hooks: [],
      runs: [],
      approvals: [],
      batches: [],
      lifecyclePolicy: normalizeHookLifecyclePolicy(undefined),
      schedulingPolicy: normalizeAutomationSchedulingPolicy(undefined),
    };
  }
  const hooks: StoredHook[] = [];
  for (const item of parsed.hooks) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.command !== "string"
    ) {
      continue;
    }
    const hook: StoredHook = {
      id: item.id.trim() || `hook-${toHashId(item.name, item.command)}`,
      name: item.name.trim() || "Local hook",
      event: normalizeHookEvent(typeof item.event === "string" ? item.event : undefined),
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      policyPreset: normalizeExecutionPolicyPreset(item.policyPreset),
      envKeys: sanitizeHookEnvKeys(Array.isArray(item.envKeys) ? item.envKeys : []),
      ...(typeof item.trustedFingerprint === "string" &&
      item.trustedFingerprint.startsWith("sha256:")
        ? { trustedFingerprint: item.trustedFingerprint }
        : {}),
      ...(typeof item.trustedAt === "string" ? { trustedAt: item.trustedAt } : {}),
      command: item.command.trim(),
      args: Array.isArray(item.args)
        ? item.args.map((arg) => String(arg).trim()).filter(Boolean)
        : [],
      timeoutMs: clampHookTimeout(
        typeof item.timeoutMs === "number" ? item.timeoutMs : undefined
      ),
      updatedAt:
        typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    };
    if (typeof item.workingDirectory === "string" && item.workingDirectory.trim()) {
      hook.workingDirectory = normalizeSlash(item.workingDirectory.trim());
    }
    hooks.push(hook);
  }

  const runs: LocalAdeHookRun[] = [];
  if (Array.isArray(parsed.runs)) {
    for (const item of parsed.runs) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.hookId !== "string" ||
        typeof item.hookName !== "string" ||
        typeof item.event !== "string" ||
        typeof item.startedAt !== "string" ||
        typeof item.finishedAt !== "string" ||
        typeof item.durationMs !== "number" ||
        typeof item.status !== "string" ||
        typeof item.stdout !== "string" ||
        typeof item.stderr !== "string"
      ) {
        continue;
      }
      const status =
        item.status === "success" ||
        item.status === "failed" ||
        item.status === "timeout" ||
        item.status === "disabled"
          ? item.status
          : "failed";
      runs.push({
        id: item.id,
        hookId: item.hookId,
        hookName: item.hookName,
        event: item.event,
        ...(typeof item.batchId === "string" ? { batchId: item.batchId } : {}),
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: Math.max(0, Math.floor(item.durationMs)),
        status,
        ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
        ...(typeof item.signal === "string" ? { signal: item.signal } : {}),
        stdout: sanitizeDiagnosticText(item.stdout),
        stderr: sanitizeDiagnosticText(item.stderr),
        ...(readLocalProcessIsolation(item.isolation)
          ? { isolation: readLocalProcessIsolation(item.isolation) }
          : {}),
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
          : [],
        ...(typeof item.reviewedAt === "string" ? { reviewedAt: item.reviewedAt } : {}),
      });
    }
  }

  const approvals: StoredHookRunApproval[] = [];
  if (Array.isArray(parsed.approvals)) {
    for (const item of parsed.approvals) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.hookId !== "string" ||
        item.operation !== "manual-run" ||
        typeof item.fingerprint !== "string" ||
        typeof item.approvedAt !== "string" ||
        typeof item.expiresAt !== "string"
      ) {
        continue;
      }
      approvals.push({
        id: item.id,
        hookId: item.hookId,
        operation: "manual-run",
        fingerprint: item.fingerprint,
        approvedAt: item.approvedAt,
        expiresAt: item.expiresAt,
        ...(typeof item.consumedAt === "string"
          ? { consumedAt: item.consumedAt }
          : {}),
      });
    }
  }

  const batches: LocalAdeHookBatch[] = [];
  if (Array.isArray(parsed.batches)) {
    for (const item of parsed.batches) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.startedAt !== "string" ||
        typeof item.finishedAt !== "string" ||
        typeof item.durationMs !== "number" ||
        typeof item.status !== "string"
      ) {
        continue;
      }
      const counts = createRunStatusCounts();
      if (isRecord(item.counts)) {
        for (const statusKey of RUN_STATUS_VALUES) {
          const value = item.counts[statusKey];
          counts[statusKey] =
            typeof value === "number" && Number.isFinite(value)
              ? Math.max(0, Math.floor(value))
              : 0;
        }
      }
      const status =
        item.status === "success" ||
        item.status === "partial" ||
        item.status === "failed" ||
        item.status === "blocked"
          ? item.status
          : "failed";
      batches.push({
        id: item.id,
        hookIds: Array.isArray(item.hookIds)
          ? item.hookIds.filter((value): value is string => typeof value === "string")
          : [],
        hookNames: Array.isArray(item.hookNames)
          ? item.hookNames.filter((value): value is string => typeof value === "string")
          : [],
        runIds: Array.isArray(item.runIds)
          ? item.runIds.filter((value): value is string => typeof value === "string")
          : [],
        failureMode:
          item.failureMode === "stop-on-failure" ? "stop-on-failure" : "continue",
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: Math.max(0, Math.floor(item.durationMs)),
        status,
        counts,
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => sanitizeDiagnosticText(entry))
          : [],
      });
    }
  }

  return {
    version: 1,
    hooks,
    runs: runs.slice(0, MAX_HOOK_RUNS),
    approvals: pruneHookRunApprovals(approvals),
    batches: batches.slice(0, MAX_HOOK_BATCHES),
    lifecyclePolicy: normalizeHookLifecyclePolicy(parsed.lifecyclePolicy),
    schedulingPolicy: normalizeAutomationSchedulingPolicy(parsed.schedulingPolicy),
  };
}

async function writeHookDocument(
  rootPath: string,
  document: HookDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, HOOKS_FILE),
    `${JSON.stringify(
      {
        version: 1,
        hooks: document.hooks,
        runs: document.runs.slice(0, MAX_HOOK_RUNS),
        approvals: pruneHookRunApprovals(document.approvals),
        batches: document.batches.slice(0, MAX_HOOK_BATCHES),
        lifecyclePolicy: normalizeHookLifecyclePolicy(document.lifecyclePolicy),
        schedulingPolicy: normalizeAutomationSchedulingPolicy(
          document.schedulingPolicy
        ),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function resolveHookWorkingDirectory(rootPath: string, hook: StoredHook): string {
  if (!hook.workingDirectory) {
    return rootPath;
  }
  const resolved = path.resolve(rootPath, hook.workingDirectory);
  if (!isPathInside(rootPath, resolved)) {
    throw new Error(
      `Hook working directory must stay inside the project root: ${hook.workingDirectory}`
    );
  }
  return resolved;
}

function toVisibleHooks(
  rootPath: string,
  document: HookDocument
): LocalAdeHookDescriptor[] {
  const sourcePath = path.join(ensureProjectDataDir(rootPath), HOOKS_FILE);
  return document.hooks.map((hook) => {
    const lastRun = document.runs.find((run) => run.hookId === hook.id);
    const fingerprint = hookExecutionFingerprint(hook);
    const trustStatus = hookTrustStatus(hook, fingerprint);
    const executionPolicy = localProcessExecutionPolicy({
      kind: "hook",
      command: hook.command,
      args: hook.args,
      preset: hook.policyPreset,
      context: "manual-run",
      isolation: {
        cwdScope: "project-root",
        projectRootExposed: true,
        timeoutMs: clampHookTimeout(hook.timeoutMs),
      },
    });
    const runOperation = hookRunOperationPreview(
      rootPath,
      hook,
      document.approvals
    );
    const scheduling = automationSchedulingState({
      rootPath,
      kind: "hook",
      itemId: hook.id,
      policy: document.schedulingPolicy,
      runs: document.runs,
    });
    const diagnostics = [
      "Manual hook execution is available from Settings > Automation.",
      `Hook execution fingerprint: ${fingerprint}.`,
      `Hook policy preset: ${normalizeExecutionPolicyPreset(hook.policyPreset)}.`,
      `Manual hook runs require confirmation token: ${hookRunConfirmationToken(hook)}.`,
      `Hook run operation fingerprint: ${runOperation.fingerprint}.`,
      `Manual hook run operation approval status: ${runOperation.approvalStatus}.`,
      `Hook sandbox policy: ${executionPolicy.status}.`,
      `Hook scheduling status: ${scheduling.status}.`,
      hook.envKeys?.length
        ? `Hook env allowlist: ${sanitizeHookEnvKeys(hook.envKeys).join(", ")}.`
        : "Hook runs with base process env only plus Eragear hook context.",
    ];
    diagnostics.push(
      ...executionPolicy.blockers,
      ...executionPolicy.warnings,
      ...scheduling.diagnostics
    );
    if (trustStatus === "trusted") {
      diagnostics.push("Hook trust is approved for the current command fingerprint.");
    } else if (trustStatus === "changed") {
      diagnostics.push(
        "Hook command, args, event, working directory, or env keys changed after trust approval; review and trust the current fingerprint before running."
      );
    } else {
      diagnostics.push("Hook is untrusted; review and trust this fingerprint before running.");
    }
    if (!hook.command.trim()) {
      diagnostics.push("Hook command is empty.");
    }
    if (hook.workingDirectory) {
      const resolved = path.resolve(rootPath, hook.workingDirectory);
      if (!isPathInside(rootPath, resolved)) {
        diagnostics.push("Working directory is outside the project root.");
      }
    }
    return {
      id: hook.id,
      name: hook.name,
      event: hook.event,
      enabled: hook.enabled,
      policyPreset: normalizeExecutionPolicyPreset(hook.policyPreset),
      envKeys: sanitizeHookEnvKeys(hook.envKeys),
      fingerprint,
      trustStatus,
      ...(hook.trustedFingerprint
        ? { trustedFingerprint: hook.trustedFingerprint }
        : {}),
      ...(hook.trustedAt ? { trustedAt: hook.trustedAt } : {}),
      command: hook.command,
      args: hook.args ?? [],
      timeoutMs: hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      ...(hook.workingDirectory ? { workingDirectory: hook.workingDirectory } : {}),
      sourcePath,
      updatedAt: hook.updatedAt,
      runConfirmationToken: hookRunConfirmationToken(hook),
      runOperation,
      executionPolicy,
      scheduling,
      ...(lastRun ? { lastRun } : {}),
      diagnostics,
    };
  });
}

function hookCapabilities(hooks: LocalAdeHookDescriptor[]): CapabilityDescriptor[] {
  return hooks.map((hook) => ({
    id: `hook.project.${hook.id}`,
    kind: "hook",
    name: hook.name,
    description:
      hook.event === "manual"
        ? "Manual hook runnable from Settings > Automation."
        : `Lifecycle hook for ${hook.event}.`,
    scope: "project",
    enabled:
      hook.enabled &&
      hook.trustStatus === "trusted" &&
      hook.executionPolicy.status === "allowed" &&
      hook.scheduling.status === "ready",
    sourcePath: hook.sourcePath,
    storage: "filesystem-discovery",
    tags: [
      hook.event === "manual" ? "manual-hook" : "lifecycle-hook",
      hook.event,
      `policy:${normalizeExecutionPolicyPreset(hook.policyPreset)}`,
      hook.trustStatus === "trusted" ? "trusted" : "requires-trust",
      hook.executionPolicy.status === "allowed" ? "sandbox:allowed" : "sandbox:blocked",
      `schedule:${hook.scheduling.status}`,
    ],
    diagnostics: hook.diagnostics,
  }));
}

function createFailedHookRun(params: {
  hook: StoredHook;
  event: string;
  message: string;
  batchId?: string;
}): LocalAdeHookRun {
  const now = new Date().toISOString();
  return {
    id: `hook-run-${randomUUID()}`,
    hookId: params.hook.id,
    hookName: params.hook.name,
    event: params.event,
    ...(params.batchId ? { batchId: params.batchId } : {}),
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "failed",
    stdout: "",
    stderr: "",
    isolation: createLocalProcessIsolation({
      cwdScope: "project-root",
      projectRootExposed: true,
      timeoutMs: clampHookTimeout(params.hook.timeoutMs),
    }),
    diagnostics: [params.message],
  };
}

function createDisabledHookRun(params: {
  hook: StoredHook;
  event: string;
  message: string;
  batchId: string;
}): LocalAdeHookRun {
  const now = new Date().toISOString();
  return {
    id: `hook-run-${randomUUID()}`,
    hookId: params.hook.id,
    hookName: params.hook.name,
    event: params.event,
    batchId: params.batchId,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "disabled",
    stdout: "",
    stderr: "",
    isolation: createLocalProcessIsolation({
      cwdScope: "project-root",
      projectRootExposed: true,
      timeoutMs: clampHookTimeout(params.hook.timeoutMs),
    }),
    diagnostics: [params.message],
  };
}

function createDisabledPluginRun(params: {
  plugin: StoredPlugin;
  message: string;
  batchId?: string;
}): LocalAdePluginRun {
  const now = new Date().toISOString();
  return {
    id: `plugin-run-${randomUUID()}`,
    pluginId: params.plugin.id,
    pluginName: params.plugin.name,
    ...(params.batchId ? { batchId: params.batchId } : {}),
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "disabled",
    stdout: "",
    stderr: "",
    isolation: createLocalProcessIsolation({
      cwdScope: pluginWorkspaceAccess(params.plugin) === "project-root"
        ? "project-root"
        : "temporary-sandbox",
      projectRootExposed: pluginWorkspaceAccess(params.plugin) === "project-root",
      timeoutMs: clampPluginTimeout(params.plugin.timeoutMs),
    }),
    diagnostics: [params.message],
  };
}

function createFailedPluginRun(params: {
  plugin: StoredPlugin;
  message: string;
  batchId?: string;
}): LocalAdePluginRun {
  const now = new Date().toISOString();
  return {
    id: `plugin-run-${randomUUID()}`,
    pluginId: params.plugin.id,
    pluginName: params.plugin.name,
    ...(params.batchId ? { batchId: params.batchId } : {}),
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "failed",
    stdout: "",
    stderr: "",
    isolation: createLocalProcessIsolation({
      cwdScope: pluginWorkspaceAccess(params.plugin) === "project-root"
        ? "project-root"
        : "temporary-sandbox",
      projectRootExposed: pluginWorkspaceAccess(params.plugin) === "project-root",
      timeoutMs: clampPluginTimeout(params.plugin.timeoutMs),
    }),
    diagnostics: [params.message],
  };
}

async function runHookProcess(params: {
  rootPath: string;
  hook: StoredHook;
  event?: string;
  batchId?: string;
  context?: Record<string, string | undefined>;
}): Promise<LocalAdeHookRun> {
  if (!params.hook.enabled) {
    throw new Error(`Hook is disabled: ${params.hook.name}`);
  }
  if (!params.hook.command.trim()) {
    throw new Error(`Hook command is empty: ${params.hook.name}`);
  }
  assertLocalProcessExecutionAllowed({
    kind: "hook",
    name: params.hook.name,
    command: params.hook.command,
    args: params.hook.args,
    preset: params.hook.policyPreset,
    context: params.event ? "lifecycle" : "manual-run",
  });
  const fingerprint = hookExecutionFingerprint(params.hook);
  const trustStatus = hookTrustStatus(params.hook, fingerprint);
  if (trustStatus !== "trusted") {
    throw new Error(
      trustStatus === "changed"
        ? `Hook command, args, event, working directory, or env keys changed after trust approval: ${params.hook.name} (${fingerprint})`
        : `Hook must be trusted before execution: ${params.hook.name} (${fingerprint})`
    );
  }

  const cwd = resolveHookWorkingDirectory(params.rootPath, params.hook);
  const event = normalizeHookEvent(params.event ?? params.hook.event);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const timeoutMs = clampHookTimeout(params.hook.timeoutMs);
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;
  let processTreeTerminated = false;
  const terminationDiagnostics: string[] = [];

  function appendOutput(current: string, chunk: Buffer, stream: "stdout" | "stderr") {
    if (Buffer.byteLength(current, "utf8") >= MAX_HOOK_OUTPUT_BYTES) {
      if (stream === "stdout") {
        stdoutTruncated = true;
      } else {
        stderrTruncated = true;
      }
      return current;
    }
    const next = current + chunk.toString("utf8");
    if (Buffer.byteLength(next, "utf8") <= MAX_HOOK_OUTPUT_BYTES) {
      return next;
    }
    const limited = Buffer.from(next, "utf8")
      .subarray(0, MAX_HOOK_OUTPUT_BYTES)
      .toString("utf8");
    if (stream === "stdout") {
      stdoutTruncated = true;
    } else {
      stderrTruncated = true;
    }
    return limited;
  }

  const result = await new Promise<{
    exitCode?: number;
    signal?: string;
    error?: Error;
  }>((resolve) => {
    let settled = false;
    let terminationPromise: Promise<void> | undefined;
    const child = spawn(params.hook.command, params.hook.args ?? [], {
      cwd,
      env: hookExecutionEnv(params.rootPath, params.hook, event, params.context),
      shell: false,
      windowsHide: true,
      detached: localProcessDetachedProcessGroup(),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminationPromise = terminateLocalProcessTree({
        child,
        diagnostics: terminationDiagnostics,
      }).then((terminated) => {
        processTreeTerminated = terminated;
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk, "stderr");
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void (async () => {
        await terminationPromise;
        resolve({ error });
      })();
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void (async () => {
        await terminationPromise;
        resolve({
          ...(typeof code === "number" ? { exitCode: code } : {}),
          ...(signal ? { signal } : {}),
        });
      })();
    });
  });

  const finishedAt = new Date().toISOString();
  const exitCode = result.exitCode;
  const status: LocalAdeHookRun["status"] = timedOut
    ? "timeout"
    : result.error
      ? "failed"
      : exitCode === 0
        ? "success"
        : "failed";
  const diagnostics = [
    `Executed ${commandLabel(params.hook.command, params.hook.args)} without shell expansion.`,
    `Hook event: ${event}.`,
    `Working directory: ${cwd}.`,
    `Trusted hook fingerprint: ${fingerprint}.`,
    sanitizeHookEnvKeys(params.hook.envKeys).length > 0
      ? `Hook env allowlist: ${sanitizeHookEnvKeys(params.hook.envKeys).join(", ")}.`
      : "Hook env allowlist is empty; only base env and Eragear context were passed.",
  ];
  const isolation = createLocalProcessIsolation({
    cwdScope: "project-root",
    projectRootExposed: true,
    timeoutMs,
    processTreeTerminated,
  });
  diagnostics.push(...isolation.diagnostics, ...terminationDiagnostics);
  if (result.error) {
    diagnostics.push(`Hook process error: ${errorMessage(result.error)}`);
  }
  if (timedOut) {
    diagnostics.push(`Hook timed out after ${timeoutMs}ms.`);
  }
  if (stdoutTruncated || stderrTruncated) {
    diagnostics.push(`Hook output was truncated to ${MAX_HOOK_OUTPUT_BYTES} bytes per stream.`);
  }

  return {
    id: `hook-run-${randomUUID()}`,
    hookId: params.hook.id,
    hookName: params.hook.name,
    event,
    ...(params.batchId ? { batchId: params.batchId } : {}),
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    status,
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    ...(result.signal ? { signal: result.signal } : {}),
    stdout: sanitizeDiagnosticText(stdout),
    stderr: sanitizeDiagnosticText(stderr),
    isolation,
    diagnostics,
  };
}

async function runLifecycleHooks(params: {
  rootPath: string;
  document: HookDocument;
  event: string;
  context?: Record<string, string | undefined>;
}): Promise<HookDocument> {
  const event = normalizeHookEvent(params.event);
  const matchingHooks = params.document.hooks.filter(
    (hook) => hook.enabled && normalizeHookEvent(hook.event) === event
  );
  if (matchingHooks.length === 0) {
    return params.document;
  }

  const policy = visibleHookLifecyclePolicy(params.document.lifecyclePolicy);
  const batchId = `hook-batch-${randomUUID()}`;
  const runs: LocalAdeHookRun[] = [];
  if (!policy.enabled || policy.disabledEvents.includes(event)) {
    const message = !policy.enabled
      ? `Lifecycle hook batch ${batchId} skipped because lifecycle dispatch is paused.`
      : `Lifecycle hook batch ${batchId} skipped because event ${event} is paused by lifecycle governance.`;
    for (const hook of matchingHooks) {
      runs.push(createDisabledHookRun({ hook, event, batchId, message }));
    }
    return {
      ...params.document,
      runs: [...runs, ...params.document.runs].slice(0, MAX_HOOK_RUNS),
    };
  }

  let stopAfterFailure = false;
  for (const hook of matchingHooks) {
    if (stopAfterFailure) {
      runs.push(
        createDisabledHookRun({
          hook,
          event,
          batchId,
          message: `Lifecycle hook batch ${batchId} skipped ${hook.name} because failure mode is stop-on-failure and an earlier hook failed.`,
        })
      );
      continue;
    }
    const slot = acquireAutomationRun({
      rootPath: params.rootPath,
      kind: "hook",
      itemId: hook.id,
      policy: params.document.schedulingPolicy,
      runs: [...runs, ...params.document.runs],
    });
    if (slot.state.status !== "ready" || !slot.release) {
      runs.push(
        createDisabledHookRun({
          hook,
          event,
          batchId,
          message: automationSchedulingBlockMessage("hook", hook.name, slot.state),
        })
      );
      continue;
    }
    try {
      const run = await runHookProcess({
          rootPath: params.rootPath,
          hook,
          event,
          batchId,
          context: params.context,
        });
      runs.push(run);
      if (policy.failureMode === "stop-on-failure" && run.status !== "success") {
        stopAfterFailure = true;
      }
    } catch (error) {
      const run = createFailedHookRun({
          hook,
          event,
          batchId,
          message: `Lifecycle hook failed before execution: ${errorMessage(error)}`,
        });
      runs.push(run);
      if (policy.failureMode === "stop-on-failure") {
        stopAfterFailure = true;
      }
    } finally {
      slot.release();
    }
  }

  return {
    ...params.document,
    runs: [...runs, ...params.document.runs].slice(0, MAX_HOOK_RUNS),
  };
}

function hookContextEnv(
  context: Record<string, string | undefined> | undefined
): Record<string, string> {
  if (!context) {
    return {};
  }
  const env: Record<string, string> = {};
  if (context.userId) {
    env.ERAGEAR_USER_ID = context.userId;
  }
  if (context.projectId) {
    env.ERAGEAR_PROJECT_ID = context.projectId;
  }
  if (context.chatId) {
    env.ERAGEAR_CHAT_ID = context.chatId;
  }
  if (context.agentSessionId) {
    env.ERAGEAR_AGENT_SESSION_ID = context.agentSessionId;
  }
  if (context.turnId) {
    env.ERAGEAR_TURN_ID = context.turnId;
  }
  return env;
}

function clampPluginTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PLUGIN_TIMEOUT_MS;
  }
  return Math.max(500, Math.min(MAX_PLUGIN_TIMEOUT_MS, Math.floor(value)));
}

function sanitizePluginScopes(input: unknown): LocalAdePluginScope[] {
  const scopes = new Set<LocalAdePluginScope>();
  if (!Array.isArray(input)) {
    for (const scope of DEFAULT_PLUGIN_SCOPES) {
      scopes.add(scope);
    }
  } else {
    for (const item of input) {
      const value = String(item).trim();
      if (
        PLUGIN_SCOPE_VALUES.includes(value as LocalAdePluginScope)
      ) {
        scopes.add(value as LocalAdePluginScope);
      }
    }
  }
  scopes.add("process");
  return [...PLUGIN_SCOPE_VALUES].filter((scope) => scopes.has(scope));
}

function sanitizePluginEnvKeys(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const keys = new Set<string>();
  for (const item of input) {
    const value = String(item).trim();
    if (!value || !isValidMcpHeaderEnvKey(value)) {
      continue;
    }
    keys.add(value);
    if (keys.size >= 32) {
      break;
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function normalizePluginPolicy(input: {
  scopes?: LocalAdePluginScope[];
  envKeys?: string[];
}): { scopes: LocalAdePluginScope[]; envKeys: string[] } {
  const scopes = sanitizePluginScopes(input.scopes);
  const envKeys = sanitizePluginEnvKeys(input.envKeys);
  if (envKeys.length > 0 && !scopes.includes("env")) {
    scopes.push("env");
  }
  return {
    scopes: [...PLUGIN_SCOPE_VALUES].filter((scope) => scopes.includes(scope)),
    envKeys,
  };
}

function effectivePluginPolicy(input: {
  scopes?: LocalAdePluginScope[];
  envKeys?: string[];
  policyPreset?: LocalAdeExecutionPolicyPreset;
}): { scopes: LocalAdePluginScope[]; envKeys: string[] } {
  const policy = normalizePluginPolicy(input);
  if (normalizeExecutionPolicyPreset(input.policyPreset) !== "restricted") {
    return policy;
  }
  return {
    scopes: policy.scopes.filter((scope) => scope !== "project-root"),
    envKeys: policy.envKeys,
  };
}

function pluginExecutionFingerprint(plugin: Pick<
  StoredPlugin,
  "command" | "args" | "workingDirectory" | "scopes" | "envKeys" | "policyPreset"
>): string {
  const policy = effectivePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
    policyPreset: plugin.policyPreset,
  });
  const payload = JSON.stringify({
    version: 1,
    policyPreset: normalizeExecutionPolicyPreset(plugin.policyPreset),
    command: plugin.command.trim(),
    args: (plugin.args ?? []).map((arg) => String(arg)),
    workingDirectory: normalizeSlash(plugin.workingDirectory ?? "."),
    scopes: policy.scopes,
    envKeys: policy.envKeys,
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function pluginPermissionFingerprint(plugin: Pick<
  StoredPlugin,
  "workingDirectory" | "scopes" | "envKeys" | "policyPreset"
>): string {
  const policy = effectivePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
    policyPreset: plugin.policyPreset,
  });
  const payload = JSON.stringify({
    version: 1,
    policyPreset: normalizeExecutionPolicyPreset(plugin.policyPreset),
    scopes: policy.scopes,
    envKeys: policy.envKeys,
    workspace:
      policy.scopes.includes("project-root")
        ? normalizeSlash(plugin.workingDirectory ?? ".")
        : "sandbox",
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function pluginPermissionStatus(
  plugin: StoredPlugin,
  permissionFingerprint = pluginPermissionFingerprint(plugin)
): LocalAdePluginDescriptor["permissionStatus"] {
  if (!plugin.grantedPermissionFingerprint) {
    return "missing";
  }
  return plugin.grantedPermissionFingerprint === permissionFingerprint
    ? "granted"
    : "changed";
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue | undefined };

interface SignedPluginPackagePayload {
  schemaVersion: 1;
  publisher: string;
  publisherId?: string;
  issuedAt?: string;
  expiresAt?: string;
  plugin: {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    scopes: LocalAdePluginScope[];
    dependencyIds?: string[];
    envKeys: string[];
    command: string;
    args: string[];
    timeoutMs: number;
    workingDirectory?: string;
  };
}

interface SignedPluginPackageVerification {
  payload: SignedPluginPackagePayload;
  manifestReference: string;
  manifestRelativePath?: string;
  signatureHash: string;
  publicKeyFingerprint: string;
  expiryStatus: LocalAdePluginPackageExpiryStatus;
  registry?: {
    url: string;
    name: string;
    packageId: string;
  };
}

interface PluginRegistryPackageReference {
  id: string;
  name?: string;
  description?: string;
  publisher?: string;
  publisherId?: string;
  issuedAt?: string;
  expiresAt?: string;
  manifestUrl: string;
  signatureHash: string;
  publicKeyFingerprint: string;
}

interface PluginRegistryRevocationReference {
  publicKeyFingerprint: string;
  revokedAt: string;
  reason?: string;
}

interface PluginRegistryDocument {
  schemaVersion: 1;
  name: string;
  packages: PluginRegistryPackageReference[];
  revokedSigners: PluginRegistryRevocationReference[];
}

function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot encode non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter((entry): entry is [string, CanonicalJsonValue] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",")}}`;
}

function resolvePluginPackageManifestPath(
  rootPath: string,
  manifestPath: string
): string {
  const trimmed = manifestPath.trim();
  if (!trimmed) {
    throw new Error("Plugin package manifest path is required.");
  }
  if (trimmed.includes("\0")) {
    throw new Error("Plugin package manifest path contains an invalid character.");
  }
  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(rootPath, trimmed);
  if (!isPathInside(rootPath, resolved)) {
    throw new Error("Plugin package manifest must stay inside the project root.");
  }
  return resolved;
}

function normalizeSignedPluginPackagePayload(
  manifest: unknown
): SignedPluginPackagePayload {
  if (!isRecord(manifest)) {
    throw new Error("Plugin package manifest must be a JSON object.");
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error("Plugin package schemaVersion must be 1.");
  }
  if (typeof manifest.publisher !== "string" || !manifest.publisher.trim()) {
    throw new Error("Plugin package publisher is required.");
  }
  const publisherId = normalizePluginPackagePublisherId(manifest.publisherId);
  const issuedAt = normalizePluginPackageDate(
    manifest.issuedAt,
    "Plugin package issuedAt"
  );
  const expiresAt = normalizePluginPackageDate(
    manifest.expiresAt,
    "Plugin package expiresAt"
  );
  if (!isRecord(manifest.plugin)) {
    throw new Error("Plugin package plugin descriptor is required.");
  }
  const plugin = manifest.plugin;
  if (typeof plugin.id !== "string" || !plugin.id.trim()) {
    throw new Error("Plugin package plugin.id is required.");
  }
  const id = plugin.id.trim();
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(id)) {
    throw new Error(
      "Plugin package plugin.id may only contain letters, numbers, dots, dashes, and underscores."
    );
  }
  if (typeof plugin.name !== "string" || !plugin.name.trim()) {
    throw new Error("Plugin package plugin.name is required.");
  }
  if (typeof plugin.command !== "string" || !plugin.command.trim()) {
    throw new Error("Plugin package plugin.command is required.");
  }
  if (!Array.isArray(plugin.scopes)) {
    throw new Error("Plugin package plugin.scopes must explicitly declare permissions.");
  }
  const policy = normalizePluginPolicy({
    scopes: plugin.scopes.filter(
      (scope): scope is LocalAdePluginScope =>
        typeof scope === "string" &&
        PLUGIN_SCOPE_VALUES.includes(scope as LocalAdePluginScope)
    ),
    envKeys: Array.isArray(plugin.envKeys)
      ? plugin.envKeys.filter((key): key is string => typeof key === "string")
      : [],
  });
  const description =
    typeof plugin.description === "string" && plugin.description.trim()
      ? sanitizeDiagnosticText(plugin.description.trim()).slice(0, 400)
      : undefined;
  const workingDirectory =
    typeof plugin.workingDirectory === "string" && plugin.workingDirectory.trim()
      ? normalizeSlash(plugin.workingDirectory.trim())
      : undefined;
  const dependencyIds = normalizePluginDependencyIds(plugin.dependencyIds, id);
  return {
    schemaVersion: 1,
    publisher: sanitizeDiagnosticText(manifest.publisher.trim()).slice(0, 160),
    ...(publisherId ? { publisherId } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    plugin: {
      id,
      name: sanitizeDiagnosticText(plugin.name.trim()).slice(0, 160),
      ...(description ? { description } : {}),
      enabled: typeof plugin.enabled === "boolean" ? plugin.enabled : true,
      scopes: policy.scopes,
      ...(dependencyIds.length > 0 ? { dependencyIds } : {}),
      envKeys: policy.envKeys,
      command: plugin.command.trim(),
      args: sanitizeHookArgs(
        Array.isArray(plugin.args) ? plugin.args.map((arg) => String(arg)) : undefined
      ),
      timeoutMs: clampPluginTimeout(
        typeof plugin.timeoutMs === "number" ? plugin.timeoutMs : undefined
      ),
      ...(workingDirectory ? { workingDirectory } : {}),
    },
  };
}

function parsePluginPackageSignature(value: unknown): Buffer {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Plugin package signature is required.");
  }
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error("Plugin package signature must be base64.");
  }
  const signature = Buffer.from(compact, "base64");
  if (
    signature.length === 0 ||
    signature.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")
  ) {
    throw new Error("Plugin package signature must be valid base64.");
  }
  return signature;
}

function normalizePluginPackageReference(value: string): string {
  const trimmed = sanitizeDiagnosticText(value.trim()).slice(0, 500);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return normalizeSlash(trimmed);
}

function normalizePluginPackagePublisherId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const publisherId = sanitizeDiagnosticText(value.trim()).slice(0, 128);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(publisherId)) {
    throw new Error(
      "Plugin package publisherId may only contain letters, numbers, dots, dashes, underscores, and colons."
    );
  }
  return publisherId;
}

function normalizePluginPackageDate(value: unknown, label: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const timestamp = sanitizeDiagnosticText(value.trim()).slice(0, 80);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp;
}

function pluginPackageExpiryStatus(
  value: { packageExpiresAt?: string; expiresAt?: string },
  nowMs = Date.now()
): LocalAdePluginPackageExpiryStatus {
  const expiresAt = value.packageExpiresAt ?? value.expiresAt;
  if (!expiresAt) {
    return "not-declared";
  }
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs ? "valid" : "expired";
}

function assertPluginPackageTemporalPolicy(
  payload: SignedPluginPackagePayload,
  nowMs = Date.now()
): LocalAdePluginPackageExpiryStatus {
  const issuedMs = payload.issuedAt ? Date.parse(payload.issuedAt) : undefined;
  const expiresMs = payload.expiresAt ? Date.parse(payload.expiresAt) : undefined;
  if (
    typeof issuedMs === "number" &&
    Number.isFinite(issuedMs) &&
    issuedMs > nowMs + PLUGIN_PACKAGE_CLOCK_SKEW_MS
  ) {
    throw new Error("Plugin package issuedAt is in the future.");
  }
  if (
    typeof issuedMs === "number" &&
    typeof expiresMs === "number" &&
    Number.isFinite(issuedMs) &&
    Number.isFinite(expiresMs) &&
    issuedMs > expiresMs
  ) {
    throw new Error("Plugin package issuedAt must be before expiresAt.");
  }
  const expiryStatus = pluginPackageExpiryStatus(payload, nowMs);
  if (expiryStatus === "expired") {
    throw new Error("Plugin package signature has expired.");
  }
  return expiryStatus;
}

function assertPluginRegistryPackagePinsMatch(
  packageRef: PluginRegistryPackageReference | StoredPluginRegistryPackage,
  verified: SignedPluginPackageVerification
): void {
  if (verified.payload.plugin.id !== packageRef.id) {
    throw new Error("Plugin registry package id does not match signed plugin id.");
  }
  if (packageRef.publisher && packageRef.publisher !== verified.payload.publisher) {
    throw new Error("Plugin registry publisher does not match signed package.");
  }
  if (
    packageRef.publisherId &&
    packageRef.publisherId !== verified.payload.publisherId
  ) {
    throw new Error("Plugin registry publisherId does not match signed package.");
  }
  if (packageRef.issuedAt && packageRef.issuedAt !== verified.payload.issuedAt) {
    throw new Error("Plugin registry issuedAt pin does not match signed package.");
  }
  if (packageRef.expiresAt && packageRef.expiresAt !== verified.payload.expiresAt) {
    throw new Error("Plugin registry expiresAt pin does not match signed package.");
  }
}

function normalizeSha256Pin(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a sha256: hash.`);
  }
  return normalized;
}

function parsePluginDistributionUrl(value: string, label: string): URL {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(
      `${label} is not a valid URL: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use http or https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${label} must not include query strings or fragments.`);
  }
  return parsed;
}

async function fetchTextWithLimit(
  url: URL,
  maxBytes: number,
  label: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PLUGIN_REGISTRY_FETCH_TIMEOUT_MS
  );
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    }
    return new TextDecoder().decode(buffer);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after ${PLUGIN_REGISTRY_FETCH_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function verifySignedPluginPackageManifest(params: {
  rootPath: string;
  manifestText: string;
  manifestReference: string;
  expectedSignatureHash?: string;
  expectedPublicKeyFingerprint?: string;
}): SignedPluginPackageVerification {
  if (Buffer.byteLength(params.manifestText, "utf8") > MAX_PLUGIN_PACKAGE_BYTES) {
    throw new Error(
      `Plugin package manifest exceeds ${MAX_PLUGIN_PACKAGE_BYTES} bytes.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.manifestText);
  } catch (error) {
    throw new Error(
      `Plugin package manifest is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("Plugin package manifest must be a JSON object.");
  }
  const payload = normalizeSignedPluginPackagePayload(parsed);
  const publicKeyPem =
    typeof parsed.publicKeyPem === "string" ? parsed.publicKeyPem.trim() : "";
  if (!publicKeyPem) {
    throw new Error("Plugin package publicKeyPem is required.");
  }
  const signature = parsePluginPackageSignature(parsed.signature);
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch (error) {
    throw new Error(
      `Plugin package public key is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const canonicalPayload = canonicalJson(payload as unknown as CanonicalJsonValue);
  if (
    !verifySignature(
      null,
      Buffer.from(canonicalPayload, "utf8"),
      publicKey,
      signature
    )
  ) {
    throw new Error("Plugin package signature verification failed.");
  }
  const expiryStatus = assertPluginPackageTemporalPolicy(payload);
  const candidate: StoredPlugin = {
    ...payload.plugin,
    policyPreset: "standard",
    updatedAt: new Date(0).toISOString(),
  };
  assertLocalProcessExecutionAllowed({
    kind: "plugin",
    name: candidate.name,
    command: candidate.command,
    args: candidate.args,
    preset: candidate.policyPreset,
    context: "manual-run",
  });
  if (candidate.workingDirectory) {
    resolvePluginWorkingDirectory(params.rootPath, candidate);
  }
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const result: SignedPluginPackageVerification = {
    payload,
    manifestReference: params.manifestReference,
    signatureHash: `sha256:${createHash("sha256").update(signature).digest("hex")}`,
    publicKeyFingerprint: `sha256:${createHash("sha256")
      .update(publicKeyDer)
      .digest("hex")}`,
    expiryStatus,
  };
  const expectedSignatureHash = params.expectedSignatureHash
    ? normalizeSha256Pin(
        params.expectedSignatureHash,
        "Plugin registry package signatureHash"
      )
    : undefined;
  const expectedPublicKeyFingerprint = params.expectedPublicKeyFingerprint
    ? normalizeSha256Pin(
        params.expectedPublicKeyFingerprint,
        "Plugin registry package publicKeyFingerprint"
      )
    : undefined;
  if (expectedSignatureHash && expectedSignatureHash !== result.signatureHash) {
    throw new Error("Plugin registry signatureHash pin does not match package.");
  }
  if (
    expectedPublicKeyFingerprint &&
    expectedPublicKeyFingerprint !== result.publicKeyFingerprint
  ) {
    throw new Error(
      "Plugin registry publicKeyFingerprint pin does not match package."
    );
  }
  return result;
}

async function readSignedPluginPackage(params: {
  rootPath: string;
  manifestPath: string;
}): Promise<SignedPluginPackageVerification & { manifestRelativePath: string }> {
  const resolvedManifestPath = resolvePluginPackageManifestPath(
    params.rootPath,
    params.manifestPath
  );
  const manifestText = await readFile(resolvedManifestPath, "utf8");
  const manifestRelativePath = normalizeSlash(
    path.relative(params.rootPath, resolvedManifestPath)
  );
  const verified = verifySignedPluginPackageManifest({
    rootPath: params.rootPath,
    manifestText,
    manifestReference: manifestRelativePath,
  });
  return {
    ...verified,
    manifestReference: manifestRelativePath,
    manifestRelativePath,
  };
}

function normalizePluginRegistryDocument(
  value: unknown,
  registryUrl: URL
): PluginRegistryDocument {
  if (!isRecord(value)) {
    throw new Error("Plugin registry must be a JSON object.");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Plugin registry schemaVersion must be 1.");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("Plugin registry name is required.");
  }
  if (!Array.isArray(value.packages)) {
    throw new Error("Plugin registry packages must be an array.");
  }
  const packages: PluginRegistryPackageReference[] = [];
  for (const entry of value.packages.slice(0, MAX_DISCOVERY_FILES)) {
    if (!isRecord(entry)) {
      continue;
    }
    if (typeof entry.id !== "string" || !/^[A-Za-z0-9._-]{1,96}$/.test(entry.id)) {
      continue;
    }
    if (typeof entry.manifestUrl !== "string" || !entry.manifestUrl.trim()) {
      continue;
    }
    const manifestUrl = parsePluginDistributionUrl(
      new URL(entry.manifestUrl.trim(), registryUrl).toString(),
      "Plugin registry manifestUrl"
    ).toString();
    const publisherId = normalizePluginPackagePublisherId(entry.publisherId);
    const issuedAt = normalizePluginPackageDate(
      entry.issuedAt,
      "Plugin registry package issuedAt"
    );
    const expiresAt = normalizePluginPackageDate(
      entry.expiresAt,
      "Plugin registry package expiresAt"
    );
    packages.push({
      id: entry.id.trim(),
      ...(typeof entry.name === "string" && entry.name.trim()
        ? { name: sanitizeDiagnosticText(entry.name.trim()).slice(0, 160) }
        : {}),
      ...(typeof entry.description === "string" && entry.description.trim()
        ? {
            description: sanitizeDiagnosticText(entry.description.trim()).slice(
              0,
              400
            ),
          }
        : {}),
      ...(typeof entry.publisher === "string" && entry.publisher.trim()
        ? {
            publisher: sanitizeDiagnosticText(entry.publisher.trim()).slice(0, 160),
          }
        : {}),
      ...(publisherId ? { publisherId } : {}),
      ...(issuedAt ? { issuedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      manifestUrl,
      signatureHash: normalizeSha256Pin(
        entry.signatureHash,
        "Plugin registry package signatureHash"
      ),
      publicKeyFingerprint: normalizeSha256Pin(
        entry.publicKeyFingerprint,
        "Plugin registry package publicKeyFingerprint"
      ),
    });
  }
  const revokedSigners: PluginRegistryRevocationReference[] = [];
  if (Array.isArray(value.revokedSigners)) {
    for (const entry of value.revokedSigners.slice(0, MAX_DISCOVERY_FILES)) {
      if (!isRecord(entry)) {
        continue;
      }
      try {
        revokedSigners.push({
          publicKeyFingerprint: normalizeSha256Pin(
            entry.publicKeyFingerprint,
            "Plugin registry revoked signer publicKeyFingerprint"
          ),
          revokedAt:
            typeof entry.revokedAt === "string" && entry.revokedAt.trim()
              ? sanitizeDiagnosticText(entry.revokedAt.trim()).slice(0, 80)
              : new Date().toISOString(),
          ...(typeof entry.reason === "string" && entry.reason.trim()
            ? {
                reason: sanitizeDiagnosticText(entry.reason.trim()).slice(0, 240),
              }
            : {}),
        });
      } catch {
        continue;
      }
    }
  }
  return {
    schemaVersion: 1,
    name: sanitizeDiagnosticText(value.name.trim()).slice(0, 160),
    packages,
    revokedSigners,
  };
}

async function readSignedPluginPackageFromRegistry(params: {
  rootPath: string;
  registryUrl: string;
  packageId: string;
}): Promise<SignedPluginPackageVerification> {
  const registryUrl = parsePluginDistributionUrl(
    params.registryUrl,
    "Plugin registry URL"
  );
  const packageId = params.packageId.trim();
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(packageId)) {
    throw new Error(
      "Plugin registry packageId may only contain letters, numbers, dots, dashes, and underscores."
    );
  }
  const registryText = await fetchTextWithLimit(
    registryUrl,
    MAX_PLUGIN_REGISTRY_BYTES,
    "Plugin registry"
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(registryText);
  } catch (error) {
    throw new Error(
      `Plugin registry is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const registry = normalizePluginRegistryDocument(parsed, registryUrl);
  const entry = registry.packages.find((item) => item.id === packageId);
  if (!entry) {
    throw new Error(`Plugin registry package not found: ${packageId}`);
  }
  const feedRevocation = registry.revokedSigners.find(
    (item) => item.publicKeyFingerprint === entry.publicKeyFingerprint
  );
  if (feedRevocation) {
    throw new Error(
      `Plugin registry signer is revoked by registry feed: ${
        entry.publicKeyFingerprint
      }${feedRevocation.reason ? ` (${feedRevocation.reason})` : ""}`
    );
  }
  if (
    pluginPackageExpiryStatus({ packageExpiresAt: entry.expiresAt }) === "expired"
  ) {
    throw new Error(`Plugin registry package signature has expired: ${entry.id}`);
  }
  const manifestUrl = parsePluginDistributionUrl(
    entry.manifestUrl,
    "Plugin registry package manifest URL"
  );
  const manifestText = await fetchTextWithLimit(
    manifestUrl,
    MAX_PLUGIN_PACKAGE_BYTES,
    "Plugin registry package manifest"
  );
  const verified = verifySignedPluginPackageManifest({
    rootPath: params.rootPath,
    manifestText,
    manifestReference: manifestUrl.toString(),
    expectedSignatureHash: entry.signatureHash,
    expectedPublicKeyFingerprint: entry.publicKeyFingerprint,
  });
  assertPluginRegistryPackagePinsMatch(entry, verified);
  return {
    ...verified,
    manifestReference: manifestUrl.toString(),
    registry: {
      url: registryUrl.toString(),
      name: registry.name,
      packageId,
    },
  };
}

function pluginRegistryFingerprint(registry: Pick<StoredPluginRegistry, "url">): string {
  const payload = JSON.stringify({
    version: 1,
    url: parsePluginDistributionUrl(registry.url, "Plugin registry URL").toString(),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function pluginRegistryTrustStatus(
  registry: StoredPluginRegistry,
  fingerprint = pluginRegistryFingerprint(registry)
): LocalAdePluginRegistryDescriptor["trustStatus"] {
  if (!registry.trustedFingerprint) {
    return "untrusted";
  }
  return registry.trustedFingerprint === fingerprint ? "trusted" : "changed";
}

function pluginRegistrySignerRevocation(
  registry: StoredPluginRegistry,
  publicKeyFingerprint: string
): StoredPluginRegistryRevocation | undefined {
  return (registry.revokedSigners ?? []).find(
    (entry) => entry.publicKeyFingerprint === publicKeyFingerprint
  );
}

function registryPackageStatus(
  packageRef: StoredPluginRegistryPackage,
  pluginDocument: PluginDocument,
  registry: StoredPluginRegistry
): Pick<
  LocalAdePluginRegistryPackage,
  | "status"
  | "signingStatus"
  | "installedPluginId"
  | "revokedAt"
  | "revocationReason"
  | "revocationSource"
  | "expiryStatus"
  | "diagnostics"
> {
  const installed = pluginDocument.plugins.find((plugin) => plugin.id === packageRef.id);
  const expiryStatus = pluginPackageExpiryStatus({
    packageExpiresAt: packageRef.expiresAt,
  });
  const revocation = pluginRegistrySignerRevocation(
    registry,
    packageRef.publicKeyFingerprint
  );
  if (revocation) {
    return {
      status: "revoked",
      signingStatus: "revoked",
      expiryStatus,
      ...(installed ? { installedPluginId: installed.id } : {}),
      revokedAt: revocation.revokedAt,
      ...(revocation.reason ? { revocationReason: revocation.reason } : {}),
      revocationSource: revocation.source ?? "manual",
      diagnostics: [
        `Registry signer is revoked: ${packageRef.publicKeyFingerprint}.`,
        ...(revocation.reason ? [`Reason: ${revocation.reason}.`] : []),
        `Revocation source: ${revocation.source ?? "manual"}.`,
      ],
    };
  }
  if (expiryStatus === "expired") {
    return {
      status: "invalid",
      signingStatus: "trusted",
      expiryStatus,
      ...(installed ? { installedPluginId: installed.id } : {}),
      diagnostics: [
        `Registry package expiry has passed: ${packageRef.expiresAt}.`,
        "Install and update are blocked until the registry publishes a non-expired signed package.",
      ],
    };
  }
  if (
    installed?.installSource === "signed-package" &&
    installed.packageSignatureHash === packageRef.signatureHash
  ) {
    return {
      status: "installed",
      signingStatus: "trusted",
      expiryStatus,
      installedPluginId: installed.id,
      diagnostics: ["Registry package is installed with the same signature."],
    };
  }
  if (installed) {
    return {
      status: "update-available",
      signingStatus: "trusted",
      expiryStatus,
      installedPluginId: installed.id,
      diagnostics: ["A plugin with this id is installed, but the registry signature differs."],
    };
  }
  return {
    status: "installable",
    signingStatus: "trusted",
    expiryStatus,
    diagnostics: ["Registry package is pinned and ready to install."],
  };
}

async function readPluginRegistryStateDocument(
  rootPath: string
): Promise<PluginRegistryStateDocument> {
  const parsed = await readJsonObject(
    path.join(ensureProjectDataDir(rootPath), PLUGIN_REGISTRIES_FILE)
  );
  if (!parsed || !Array.isArray(parsed.registries)) {
    return { version: 1, registries: [] };
  }
  const registries: StoredPluginRegistry[] = [];
  for (const item of parsed.registries) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.url !== "string"
    ) {
      continue;
    }
    let url: string;
    try {
      url = parsePluginDistributionUrl(item.url, "Plugin registry URL").toString();
    } catch {
      continue;
    }
    const packages: StoredPluginRegistryPackage[] = [];
    if (Array.isArray(item.packages)) {
      for (const packageItem of item.packages.slice(0, MAX_DISCOVERY_FILES)) {
        if (
          !isRecord(packageItem) ||
          typeof packageItem.id !== "string" ||
          typeof packageItem.manifestUrl !== "string"
        ) {
          continue;
        }
        try {
          const publisherId = normalizePluginPackagePublisherId(
            packageItem.publisherId
          );
          const issuedAt = normalizePluginPackageDate(
            packageItem.issuedAt,
            "Plugin registry package issuedAt"
          );
          const expiresAt = normalizePluginPackageDate(
            packageItem.expiresAt,
            "Plugin registry package expiresAt"
          );
          packages.push({
            id: packageItem.id.trim(),
            ...(typeof packageItem.name === "string" && packageItem.name.trim()
              ? {
                  name: sanitizeDiagnosticText(packageItem.name.trim()).slice(
                    0,
                    160
                  ),
                }
              : {}),
            ...(typeof packageItem.description === "string" &&
            packageItem.description.trim()
              ? {
                  description: sanitizeDiagnosticText(
                    packageItem.description.trim()
                  ).slice(0, 400),
                }
              : {}),
            ...(typeof packageItem.publisher === "string" &&
            packageItem.publisher.trim()
              ? {
                  publisher: sanitizeDiagnosticText(
                    packageItem.publisher.trim()
                  ).slice(0, 160),
                }
              : {}),
            ...(publisherId ? { publisherId } : {}),
            ...(issuedAt ? { issuedAt } : {}),
            ...(expiresAt ? { expiresAt } : {}),
            manifestUrl: parsePluginDistributionUrl(
              packageItem.manifestUrl,
              "Plugin registry manifestUrl"
            ).toString(),
            signatureHash: normalizeSha256Pin(
              packageItem.signatureHash,
              "Plugin registry package signatureHash"
            ),
            publicKeyFingerprint: normalizeSha256Pin(
              packageItem.publicKeyFingerprint,
              "Plugin registry package publicKeyFingerprint"
            ),
            ...(Array.isArray(packageItem.diagnostics)
              ? {
                  diagnostics: packageItem.diagnostics
                    .filter((entry): entry is string => typeof entry === "string")
                    .slice(0, 6)
                    .map((entry) => sanitizeDiagnosticText(entry)),
                }
              : {}),
          });
        } catch {
          continue;
        }
      }
    }
    const revokedSigners: StoredPluginRegistryRevocation[] = [];
    if (Array.isArray(item.revokedSigners)) {
      for (const revokedItem of item.revokedSigners.slice(0, MAX_DISCOVERY_FILES)) {
        if (
          !isRecord(revokedItem) ||
          typeof revokedItem.publicKeyFingerprint !== "string"
        ) {
          continue;
        }
        try {
          revokedSigners.push({
            publicKeyFingerprint: normalizeSha256Pin(
              revokedItem.publicKeyFingerprint,
              "Plugin registry revoked signer publicKeyFingerprint"
            ),
            revokedAt:
              typeof revokedItem.revokedAt === "string"
                ? revokedItem.revokedAt
                : new Date(0).toISOString(),
            source: revokedItem.source === "registry" ? "registry" : "manual",
            ...(typeof revokedItem.reason === "string" && revokedItem.reason.trim()
              ? {
                  reason: sanitizeDiagnosticText(revokedItem.reason.trim()).slice(
                    0,
                    240
                  ),
                }
              : {}),
          });
        } catch {
          continue;
        }
      }
    }
    registries.push({
      id: item.id.trim() || `registry-${toHashId(item.name, url)}`,
      name: sanitizeDiagnosticText(item.name.trim() || "Plugin registry").slice(
        0,
        160
      ),
      url,
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      ...(typeof item.trustedFingerprint === "string" &&
      item.trustedFingerprint.startsWith("sha256:")
        ? { trustedFingerprint: item.trustedFingerprint }
        : {}),
      ...(typeof item.trustedAt === "string" ? { trustedAt: item.trustedAt } : {}),
      ...(typeof item.lastRefreshAt === "string"
        ? { lastRefreshAt: item.lastRefreshAt }
        : {}),
      packages,
      revokedSigners,
      ...(Array.isArray(item.diagnostics)
        ? {
            diagnostics: item.diagnostics
              .filter((entry): entry is string => typeof entry === "string")
              .slice(0, 8)
              .map((entry) => sanitizeDiagnosticText(entry)),
          }
        : {}),
      updatedAt:
        typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    });
  }
  return { version: 1, registries };
}

async function writePluginRegistryStateDocument(
  rootPath: string,
  document: PluginRegistryStateDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, PLUGIN_REGISTRIES_FILE),
    `${JSON.stringify(
      {
        version: 1,
        registries: document.registries,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function mergePluginRegistryRevocations(
  existing: StoredPluginRegistryRevocation[] | undefined,
  registryFeed: StoredPluginRegistryRevocation[]
): StoredPluginRegistryRevocation[] {
  const registryKeys = new Set(
    registryFeed.map((entry) => entry.publicKeyFingerprint)
  );
  const manual = (existing ?? []).filter(
    (entry) =>
      (entry.source ?? "manual") !== "registry" &&
      !registryKeys.has(entry.publicKeyFingerprint)
  );
  return [...manual, ...registryFeed].slice(-MAX_DISCOVERY_FILES);
}

async function fetchPluginRegistryPackages(
  registry: StoredPluginRegistry
): Promise<{
  packages: StoredPluginRegistryPackage[];
  revokedSigners: StoredPluginRegistryRevocation[];
}> {
  const registryUrl = parsePluginDistributionUrl(registry.url, "Plugin registry URL");
  const registryText = await fetchTextWithLimit(
    registryUrl,
    MAX_PLUGIN_REGISTRY_BYTES,
    "Plugin registry"
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(registryText);
  } catch (error) {
    throw new Error(
      `Plugin registry is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const document = normalizePluginRegistryDocument(parsed, registryUrl);
  return {
    packages: document.packages.map((item) => ({
      id: item.id,
      ...(item.name ? { name: item.name } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.publisher ? { publisher: item.publisher } : {}),
      ...(item.publisherId ? { publisherId: item.publisherId } : {}),
      ...(item.issuedAt ? { issuedAt: item.issuedAt } : {}),
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      manifestUrl: item.manifestUrl,
      signatureHash: item.signatureHash,
      publicKeyFingerprint: item.publicKeyFingerprint,
      diagnostics: [
        "Registry package pins signature and public key fingerprint.",
        ...(item.publisherId ? ["Registry package pins publisher identity."] : []),
        ...(item.expiresAt ? ["Registry package pins signature expiry."] : []),
      ],
    })),
    revokedSigners: document.revokedSigners.map((item) => ({
      publicKeyFingerprint: item.publicKeyFingerprint,
      revokedAt: item.revokedAt,
      ...(item.reason ? { reason: item.reason } : {}),
      source: "registry",
    })),
  };
}

function toVisiblePluginRegistries(
  registries: StoredPluginRegistry[],
  pluginDocument: PluginDocument
): LocalAdePluginRegistryDescriptor[] {
  return registries.map((registry) => {
    const fingerprint = pluginRegistryFingerprint(registry);
    const trustStatus = pluginRegistryTrustStatus(registry, fingerprint);
    const packages = (registry.packages ?? []).map((packageRef) => {
      const status = registryPackageStatus(packageRef, pluginDocument, registry);
      return {
        id: packageRef.id,
        ...(packageRef.name ? { name: packageRef.name } : {}),
        ...(packageRef.description ? { description: packageRef.description } : {}),
        ...(packageRef.publisher ? { publisher: packageRef.publisher } : {}),
        ...(packageRef.publisherId ? { publisherId: packageRef.publisherId } : {}),
        ...(packageRef.issuedAt ? { issuedAt: packageRef.issuedAt } : {}),
        ...(packageRef.expiresAt ? { expiresAt: packageRef.expiresAt } : {}),
        manifestUrl: packageRef.manifestUrl,
        signatureHash: packageRef.signatureHash,
        publicKeyFingerprint: packageRef.publicKeyFingerprint,
        ...status,
        diagnostics: [
          ...(packageRef.diagnostics ?? []),
          ...status.diagnostics,
        ].slice(0, 6),
      };
    });
    const diagnostics = [...(registry.diagnostics ?? [])];
    let status: LocalAdePluginRegistryDescriptor["status"] = "ready";
    if (!registry.enabled) {
      status = "disabled";
      diagnostics.push("Registry is disabled.");
    } else if (trustStatus !== "trusted") {
      status = "untrusted";
      diagnostics.push("Registry URL must be trusted before refresh or package install.");
    } else if ((registry.diagnostics ?? []).length > 0) {
      status = "failed";
    } else if (packages.length === 0) {
      status = "empty";
      diagnostics.push("Registry has no refreshed packages yet.");
    }
    return {
      id: registry.id,
      name: registry.name,
      url: registry.url,
      enabled: registry.enabled,
      fingerprint,
      trustStatus,
      ...(registry.trustedFingerprint
        ? { trustedFingerprint: registry.trustedFingerprint }
        : {}),
      ...(registry.trustedAt ? { trustedAt: registry.trustedAt } : {}),
      ...(registry.lastRefreshAt ? { lastRefreshAt: registry.lastRefreshAt } : {}),
      status,
      revokedSigners: (registry.revokedSigners ?? []).map((entry) => ({
        publicKeyFingerprint: entry.publicKeyFingerprint,
        revokedAt: entry.revokedAt,
        ...(entry.reason ? { reason: entry.reason } : {}),
        source: entry.source ?? "manual",
      })),
      packages,
      updatedAt: registry.updatedAt,
      diagnostics: diagnostics.slice(0, 8),
    };
  });
}

async function listPluginPackageManifestPaths(rootPath: string): Promise<string[]> {
  const packageDir = path.join(
    ensureProjectDataDir(rootPath),
    PLUGIN_PACKAGE_CATALOG_DIR
  );
  const manifests: string[] = [];

  async function visit(dirPath: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (manifests.length >= MAX_DISCOVERY_FILES) {
        return;
      }
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2) {
          await visit(entryPath, depth + 1);
        }
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        manifests.push(normalizeSlash(path.relative(rootPath, entryPath)));
      }
    }
  }

  await visit(packageDir, 0);
  return manifests.sort((left, right) => left.localeCompare(right));
}

async function discoverPluginPackageCatalog(
  rootPath: string,
  document: PluginDocument
): Promise<LocalAdePluginCatalogItem[]> {
  const manifestPaths = await listPluginPackageManifestPaths(rootPath);
  const catalog: LocalAdePluginCatalogItem[] = [];

  for (const manifestPath of manifestPaths.slice(0, MAX_DISCOVERY_FILES)) {
    try {
      const signedPackage = await readSignedPluginPackage({
        rootPath,
        manifestPath,
      });
      const plugin = signedPackage.payload.plugin;
      const installed = document.plugins.find((item) => item.id === plugin.id);
      const status: LocalAdePluginCatalogItem["status"] =
        installed?.installSource === "signed-package" &&
        installed.packageSignatureHash === signedPackage.signatureHash
          ? "installed"
          : installed
            ? "update-available"
            : "installable";
      catalog.push({
        manifestPath: signedPackage.manifestRelativePath,
        status,
        id: plugin.id,
        name: plugin.name,
        ...(plugin.description ? { description: plugin.description } : {}),
        publisher: signedPackage.payload.publisher,
        ...(signedPackage.payload.publisherId
          ? { publisherId: signedPackage.payload.publisherId }
          : {}),
        ...(signedPackage.payload.issuedAt
          ? { issuedAt: signedPackage.payload.issuedAt }
          : {}),
        ...(signedPackage.payload.expiresAt
          ? { expiresAt: signedPackage.payload.expiresAt }
          : {}),
        expiryStatus: signedPackage.expiryStatus,
        scopes: plugin.scopes,
        envKeys: plugin.envKeys,
        command: plugin.command,
        args: plugin.args,
        timeoutMs: plugin.timeoutMs,
        workspaceAccess: plugin.scopes.includes("project-root")
          ? "project-root"
          : "sandbox",
        signatureHash: signedPackage.signatureHash,
        publicKeyFingerprint: signedPackage.publicKeyFingerprint,
        ...(installed ? { installedPluginId: installed.id } : {}),
        diagnostics: [
          status === "installed"
            ? "Signed plugin package is installed with the same signature."
            : status === "update-available"
              ? "A plugin with this id is installed, but the signed package differs."
              : "Signed plugin package is verified and ready to install.",
        ],
      });
    } catch (error) {
      catalog.push({
        manifestPath,
        status: "invalid",
        expiryStatus: "not-declared",
        scopes: [],
        envKeys: [],
        args: [],
        workspaceAccess: "sandbox",
        diagnostics: [
          sanitizeDiagnosticText(
            error instanceof Error ? error.message : String(error)
          ),
        ],
      });
    }
  }

  return catalog;
}

function pluginTrustStatus(
  plugin: StoredPlugin,
  fingerprint = pluginExecutionFingerprint(plugin)
): LocalAdePluginDescriptor["trustStatus"] {
  if (!plugin.trustedFingerprint) {
    return "untrusted";
  }
  return plugin.trustedFingerprint === fingerprint ? "trusted" : "changed";
}

function pluginRunConfirmationToken(plugin: Pick<StoredPlugin, "id">): string {
  return `RUN PLUGIN ${plugin.id}`;
}

function pluginWorkspaceAccess(plugin: StoredPlugin): "project-root" | "sandbox" {
  return effectivePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
    policyPreset: plugin.policyPreset,
  }).scopes.includes("project-root")
    ? "project-root"
    : "sandbox";
}

function pluginRunOperationFingerprint(plugin: StoredPlugin): string {
  const policy = effectivePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
    policyPreset: plugin.policyPreset,
  });
  const payload = JSON.stringify({
    version: 1,
    operation: "manual-run",
    pluginId: plugin.id,
    policyPreset: normalizeExecutionPolicyPreset(plugin.policyPreset),
    executionFingerprint: pluginExecutionFingerprint(plugin),
    permissionFingerprint: pluginPermissionFingerprint(plugin),
    workspaceAccess: policy.scopes.includes("project-root")
      ? "project-root"
      : "sandbox",
    scopes: policy.scopes,
    envKeys: policy.envKeys,
    command: plugin.command,
    args: plugin.args ?? [],
    workingDirectory: plugin.workingDirectory ?? null,
    installSource: plugin.installSource ?? "manual",
    packageSignatureHash: plugin.packageSignatureHash ?? null,
    packagePublicKeyFingerprint: plugin.packagePublicKeyFingerprint ?? null,
    packageExpiresAt: plugin.packageExpiresAt ?? null,
    dependencyIds: normalizePluginDependencyIds(plugin.dependencyIds, plugin.id),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function prunePluginRunApprovals(
  approvals: StoredPluginRunApproval[]
): StoredPluginRunApproval[] {
  return approvals.slice(-MAX_PLUGIN_RUN_APPROVALS);
}

function pluginRunOperationApprovalStatus(
  plugin: StoredPlugin,
  approvals: StoredPluginRunApproval[],
  fingerprint = pluginRunOperationFingerprint(plugin),
  nowMs = Date.now()
): Pick<
  LocalAdePluginRunOperation,
  "approvalStatus" | "approvalId" | "approvedAt" | "expiresAt" | "consumedAt"
> {
  const pluginApprovals = approvals
    .filter((approval) => approval.pluginId === plugin.id)
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
  const matching = pluginApprovals.find(
    (approval) => approval.fingerprint === fingerprint
  );
  if (matching?.consumedAt) {
    return {
      approvalStatus: "consumed",
      approvalId: matching.id,
      approvedAt: matching.approvedAt,
      expiresAt: matching.expiresAt,
      consumedAt: matching.consumedAt,
    };
  }
  if (matching) {
    const expiresMs = Date.parse(matching.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
      return {
        approvalStatus: "approved",
        approvalId: matching.id,
        approvedAt: matching.approvedAt,
        expiresAt: matching.expiresAt,
      };
    }
    return {
      approvalStatus: "expired",
      approvalId: matching.id,
      approvedAt: matching.approvedAt,
      expiresAt: matching.expiresAt,
    };
  }
  const latestUnconsumed = pluginApprovals.find((approval) => !approval.consumedAt);
  if (latestUnconsumed) {
    return {
      approvalStatus: "changed",
      approvalId: latestUnconsumed.id,
      approvedAt: latestUnconsumed.approvedAt,
      expiresAt: latestUnconsumed.expiresAt,
    };
  }
  return { approvalStatus: "missing" };
}

function pluginRunOperationPreview(
  rootPath: string,
  plugin: StoredPlugin,
  approvals: StoredPluginRunApproval[]
): LocalAdePluginRunOperation {
  const policy = effectivePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
    policyPreset: plugin.policyPreset,
  });
  const workspaceAccess = pluginWorkspaceAccess(plugin);
  const fingerprint = pluginRunOperationFingerprint(plugin);
  const status = pluginRunOperationApprovalStatus(plugin, approvals, fingerprint);
  const cwd =
    workspaceAccess === "project-root"
      ? normalizeSlash(
          plugin.workingDirectory
            ? path.relative(rootPath, resolvePluginWorkingDirectory(rootPath, plugin))
            : "."
        )
      : "[temporary sandbox cwd]";
  const isolation = createLocalProcessIsolation({
    cwdScope: workspaceAccess === "project-root" ? "project-root" : "temporary-sandbox",
    projectRootExposed: workspaceAccess === "project-root",
    timeoutMs: clampPluginTimeout(plugin.timeoutMs),
  });
  return {
    operation: "manual-run",
    fingerprint,
    ...status,
    workspaceAccess,
    cwd,
    command: plugin.command,
    args: plugin.args ?? [],
    scopes: policy.scopes,
    envKeys: policy.envKeys,
    executionFingerprint: pluginExecutionFingerprint(plugin),
    permissionFingerprint: pluginPermissionFingerprint(plugin),
    isolation,
    diagnostics: [
      "Manual plugin run requires one-shot operation approval for the current command, permissions, workspace access, and package identity.",
      `Operation approval expires after ${Math.round(
        PLUGIN_RUN_APPROVAL_TTL_MS / 1000
      )} seconds and is consumed by the next run attempt.`,
      workspaceAccess === "project-root"
        ? "This operation can access the project root and will use checkpoint-backed workspace audit."
        : "This operation runs in a temporary sandbox cwd with project root hidden.",
      ...isolation.diagnostics,
    ],
  };
}

function assertPluginReadyForManualRun(plugin: StoredPlugin): void {
  if (!plugin.enabled) {
    throw new Error(`Plugin is disabled: ${plugin.name}`);
  }
  if (!plugin.command.trim()) {
    throw new Error(`Plugin command is empty: ${plugin.name}`);
  }
  assertLocalProcessExecutionAllowed({
    kind: "plugin",
    name: plugin.name,
    command: plugin.command,
    args: plugin.args,
    preset: plugin.policyPreset,
    context: "manual-run",
  });
  const fingerprint = pluginExecutionFingerprint(plugin);
  if (pluginTrustStatus(plugin, fingerprint) !== "trusted") {
    throw new Error(
      `Plugin must be trusted before execution: ${plugin.name} (${fingerprint})`
    );
  }
  const permissionFingerprint = pluginPermissionFingerprint(plugin);
  if (pluginPermissionStatus(plugin, permissionFingerprint) !== "granted") {
    throw new Error(
      `Plugin permissions must be granted before execution: ${plugin.name} (${permissionFingerprint})`
    );
  }
  if (
    plugin.installSource === "signed-package" &&
    pluginPackageExpiryStatus(plugin) === "expired"
  ) {
    throw new Error(`Plugin package signature has expired: ${plugin.name}`);
  }
  if (
    plugin.installSource === "signed-package" &&
    plugin.packageGovernanceStatus === "verification-failed"
  ) {
    throw new Error(
      `Plugin package governance check failed: ${plugin.name}. Reinstall or revalidate the signed package before running.`
    );
  }
}

function assertPluginRunConfirmation(plugin: StoredPlugin, confirmation: string): void {
  const expected = pluginRunConfirmationToken(plugin);
  if (confirmation.trim() !== expected) {
    throw new Error(`Plugin run confirmation mismatch. Type ${expected} to execute.`);
  }
}

function assertPluginBatchConfirmation(confirmation: string): void {
  if (confirmation.trim() !== PLUGIN_BATCH_CONFIRMATION_TOKEN) {
    throw new Error(
      `Plugin batch confirmation mismatch. Type ${PLUGIN_BATCH_CONFIRMATION_TOKEN} to execute.`
    );
  }
}

function normalizePluginDependencyIds(
  value: unknown,
  pluginId?: string
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const self = pluginId?.trim();
  const seen = new Set<string>();
  const dependencyIds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const dependencyId = item.trim();
    if (
      !dependencyId ||
      dependencyId === self ||
      seen.has(dependencyId)
    ) {
      continue;
    }
    seen.add(dependencyId);
    dependencyIds.push(dependencyId);
    if (dependencyIds.length >= MAX_PLUGIN_DEPENDENCIES) {
      break;
    }
  }
  return dependencyIds;
}

async function readPluginDocument(rootPath: string): Promise<PluginDocument> {
  const parsed = await readJsonObject(path.join(ensureProjectDataDir(rootPath), PLUGINS_FILE));
  if (!parsed || !Array.isArray(parsed.plugins)) {
    return {
      version: 1,
      plugins: [],
      runs: [],
      approvals: [],
      batches: [],
      batchPresets: [],
      batchSchedules: [],
      schedulingPolicy: normalizeAutomationSchedulingPolicy(undefined),
    };
  }

  const plugins: StoredPlugin[] = [];
  for (const item of parsed.plugins) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.command !== "string"
    ) {
      continue;
    }
    const description =
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : undefined;
    const workingDirectory =
      typeof item.workingDirectory === "string" && item.workingDirectory.trim()
        ? normalizeSlash(item.workingDirectory.trim())
        : undefined;
    const policy = normalizePluginPolicy({
      scopes: Array.isArray(item.scopes)
        ? item.scopes.filter(
            (scope): scope is LocalAdePluginScope =>
              typeof scope === "string" &&
              PLUGIN_SCOPE_VALUES.includes(scope as LocalAdePluginScope)
          )
        : undefined,
      envKeys: Array.isArray(item.envKeys)
        ? item.envKeys.filter((key): key is string => typeof key === "string")
        : undefined,
    });
    const pluginId = item.id.trim() || `plugin-${toHashId(item.name, item.command)}`;
    const dependencyIds = normalizePluginDependencyIds(
      item.dependencyIds,
      pluginId
    );
    const packagePublisherId = normalizePluginPackagePublisherId(
      item.packagePublisherId
    );
    const packageIssuedAt = normalizePluginPackageDate(
      item.packageIssuedAt,
      "Plugin package issuedAt"
    );
    const packageExpiresAt = normalizePluginPackageDate(
      item.packageExpiresAt,
      "Plugin package expiresAt"
    );
    plugins.push({
      id: pluginId,
      name: item.name.trim() || "Local plugin",
      ...(description ? { description } : {}),
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      policyPreset: normalizeExecutionPolicyPreset(item.policyPreset),
      ...(item.installSource === "signed-package"
        ? { installSource: "signed-package" as const }
        : item.installSource === "manual"
          ? { installSource: "manual" as const }
          : {}),
      ...(typeof item.publisher === "string" && item.publisher.trim()
        ? { publisher: sanitizeDiagnosticText(item.publisher.trim()).slice(0, 160) }
        : {}),
      ...(packagePublisherId ? { packagePublisherId } : {}),
      ...(typeof item.packageManifestPath === "string" &&
      item.packageManifestPath.trim()
        ? {
            packageManifestPath: normalizePluginPackageReference(
              item.packageManifestPath.trim()
            ),
          }
        : {}),
      ...(typeof item.packageRegistryUrl === "string" &&
      item.packageRegistryUrl.trim()
        ? {
            packageRegistryUrl: normalizePluginPackageReference(
              item.packageRegistryUrl.trim()
            ),
          }
        : {}),
      ...(typeof item.packageRegistryName === "string" &&
      item.packageRegistryName.trim()
        ? {
            packageRegistryName: sanitizeDiagnosticText(
              item.packageRegistryName.trim()
            ).slice(0, 160),
          }
        : {}),
      ...(typeof item.packageRegistryPackageId === "string" &&
      item.packageRegistryPackageId.trim()
        ? {
            packageRegistryPackageId: sanitizeDiagnosticText(
              item.packageRegistryPackageId.trim()
            ).slice(0, 96),
          }
        : {}),
      ...(typeof item.packageSignatureHash === "string" &&
      item.packageSignatureHash.startsWith("sha256:")
        ? { packageSignatureHash: item.packageSignatureHash }
        : {}),
      ...(typeof item.packagePublicKeyFingerprint === "string" &&
      item.packagePublicKeyFingerprint.startsWith("sha256:")
        ? { packagePublicKeyFingerprint: item.packagePublicKeyFingerprint }
        : {}),
      ...(packageIssuedAt ? { packageIssuedAt } : {}),
      ...(packageExpiresAt ? { packageExpiresAt } : {}),
      ...(typeof item.packageVerifiedAt === "string"
        ? { packageVerifiedAt: item.packageVerifiedAt }
        : {}),
      ...(item.packageGovernanceStatus === "verification-failed"
        ? { packageGovernanceStatus: "verification-failed" as const }
        : item.packageGovernanceStatus === "verified"
          ? { packageGovernanceStatus: "verified" as const }
          : {}),
      ...(Array.isArray(item.packageGovernanceDiagnostics)
        ? {
            packageGovernanceDiagnostics: item.packageGovernanceDiagnostics
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => sanitizeDiagnosticText(entry))
              .slice(0, 12),
          }
        : {}),
      scopes: policy.scopes,
      dependencyIds,
      envKeys: policy.envKeys,
      ...(typeof item.trustedFingerprint === "string" &&
      item.trustedFingerprint.startsWith("sha256:")
        ? { trustedFingerprint: item.trustedFingerprint }
        : {}),
      ...(typeof item.trustedAt === "string" ? { trustedAt: item.trustedAt } : {}),
      ...(typeof item.grantedPermissionFingerprint === "string" &&
      item.grantedPermissionFingerprint.startsWith("sha256:")
        ? { grantedPermissionFingerprint: item.grantedPermissionFingerprint }
        : {}),
      ...(typeof item.permissionGrantedAt === "string"
        ? { permissionGrantedAt: item.permissionGrantedAt }
        : {}),
      command: item.command.trim(),
      args: Array.isArray(item.args)
        ? item.args.map((arg) => String(arg).trim()).filter(Boolean)
        : [],
      timeoutMs: clampPluginTimeout(
        typeof item.timeoutMs === "number" ? item.timeoutMs : undefined
      ),
      ...(workingDirectory ? { workingDirectory } : {}),
      updatedAt:
        typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    });
  }

  const runs: LocalAdePluginRun[] = [];
  if (Array.isArray(parsed.runs)) {
    for (const item of parsed.runs) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.pluginId !== "string" ||
        typeof item.pluginName !== "string" ||
        typeof item.startedAt !== "string" ||
        typeof item.finishedAt !== "string" ||
        typeof item.durationMs !== "number" ||
        typeof item.status !== "string" ||
        typeof item.stdout !== "string" ||
        typeof item.stderr !== "string"
      ) {
        continue;
      }
      const status =
        item.status === "success" ||
        item.status === "failed" ||
        item.status === "timeout" ||
        item.status === "disabled"
          ? item.status
          : "failed";
      runs.push({
        id: item.id,
        pluginId: item.pluginId,
        pluginName: item.pluginName,
        ...(typeof item.batchId === "string" ? { batchId: item.batchId } : {}),
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: Math.max(0, Math.floor(item.durationMs)),
        status,
        ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
        ...(typeof item.signal === "string" ? { signal: item.signal } : {}),
        stdout: sanitizeDiagnosticText(item.stdout),
        stderr: sanitizeDiagnosticText(item.stderr),
        ...(readLocalProcessIsolation(item.isolation)
          ? { isolation: readLocalProcessIsolation(item.isolation) }
          : {}),
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
          : [],
        ...(typeof item.preRunCheckpointId === "string"
          ? { preRunCheckpointId: item.preRunCheckpointId }
          : {}),
        ...(typeof item.postRunCheckpointId === "string"
          ? { postRunCheckpointId: item.postRunCheckpointId }
          : {}),
        ...(Array.isArray(item.workspaceStatusBefore)
          ? {
              workspaceStatusBefore: item.workspaceStatusBefore
                .filter((line): line is string => typeof line === "string")
                .slice(0, MAX_PLUGIN_WORKSPACE_STATUS_LINES),
            }
          : {}),
        ...(Array.isArray(item.workspaceStatusAfter)
          ? {
              workspaceStatusAfter: item.workspaceStatusAfter
                .filter((line): line is string => typeof line === "string")
                .slice(0, MAX_PLUGIN_WORKSPACE_STATUS_LINES),
            }
          : {}),
        ...(Array.isArray(item.workspaceChangedFiles)
          ? {
              workspaceChangedFiles: item.workspaceChangedFiles
                .filter((line): line is string => typeof line === "string")
                .slice(0, MAX_PLUGIN_WORKSPACE_CHANGED_FILES),
            }
          : {}),
        ...(typeof item.reviewedAt === "string" ? { reviewedAt: item.reviewedAt } : {}),
      });
    }
  }

  const approvals: StoredPluginRunApproval[] = [];
  if (Array.isArray(parsed.approvals)) {
    for (const item of parsed.approvals.slice(-MAX_PLUGIN_RUN_APPROVALS)) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.pluginId !== "string" ||
        item.operation !== "manual-run" ||
        typeof item.fingerprint !== "string" ||
        typeof item.approvedAt !== "string" ||
        typeof item.expiresAt !== "string"
      ) {
        continue;
      }
      if (!item.fingerprint.startsWith("sha256:")) {
        continue;
      }
      approvals.push({
        id: item.id,
        pluginId: item.pluginId,
        operation: "manual-run",
        fingerprint: item.fingerprint,
        approvedAt: item.approvedAt,
        expiresAt: item.expiresAt,
        ...(typeof item.consumedAt === "string"
          ? { consumedAt: item.consumedAt }
          : {}),
      });
    }
  }

  const batches: LocalAdePluginBatch[] = [];
  if (Array.isArray(parsed.batches)) {
    for (const item of parsed.batches) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.startedAt !== "string" ||
        typeof item.finishedAt !== "string" ||
        typeof item.durationMs !== "number" ||
        typeof item.status !== "string"
      ) {
        continue;
      }
      const status =
        item.status === "success" ||
        item.status === "partial" ||
        item.status === "failed" ||
        item.status === "blocked"
          ? item.status
          : "failed";
      const failureMode =
        item.failureMode === "stop-on-failure" ? "stop-on-failure" : "continue";
      const counts = createRunStatusCounts();
      if (isRecord(item.counts)) {
        for (const statusKey of RUN_STATUS_VALUES) {
          const value = item.counts[statusKey];
          counts[statusKey] =
            typeof value === "number" && Number.isFinite(value)
              ? Math.max(0, Math.floor(value))
              : 0;
        }
      }
      batches.push({
        id: item.id,
        pluginIds: Array.isArray(item.pluginIds)
          ? item.pluginIds.filter((value): value is string => typeof value === "string")
          : [],
        pluginNames: Array.isArray(item.pluginNames)
          ? item.pluginNames.filter((value): value is string => typeof value === "string")
          : [],
        runIds: Array.isArray(item.runIds)
          ? item.runIds.filter((value): value is string => typeof value === "string")
          : [],
        failureMode,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: Math.max(0, Math.floor(item.durationMs)),
        status,
        counts,
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
          : [],
      });
    }
  }

  const batchPresets: LocalAdePluginBatchPreset[] = [];
  if (Array.isArray(parsed.batchPresets)) {
    for (const item of parsed.batchPresets) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.createdAt !== "string" ||
        typeof item.updatedAt !== "string"
      ) {
        continue;
      }
      const pluginIds = Array.isArray(item.pluginIds)
        ? [
            ...new Set(
              item.pluginIds
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter(Boolean)
            ),
          ].slice(0, MAX_PLUGIN_BATCH_RUN_ITEMS)
        : [];
      if (pluginIds.length === 0) {
        continue;
      }
      const failureMode =
        item.failureMode === "stop-on-failure" ? "stop-on-failure" : "continue";
      const diagnostics: string[] = [];
      const pluginNames = pluginIds.map((pluginId) => {
        const plugin = plugins.find((storedPlugin) => storedPlugin.id === pluginId);
        if (!plugin) {
          diagnostics.push(`Preset references missing plugin: ${pluginId}.`);
          return pluginId;
        }
        return plugin.name;
      });
      batchPresets.push({
        id: item.id,
        name: item.name,
        pluginIds,
        pluginNames,
        failureMode,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(typeof item.lastRunBatchId === "string"
          ? { lastRunBatchId: item.lastRunBatchId }
          : {}),
        diagnostics: [
          ...diagnostics,
          ...(Array.isArray(item.diagnostics)
            ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
            : []),
        ].map((diagnostic) => sanitizeDiagnosticText(diagnostic)),
      });
    }
  }

  const batchSchedules: StoredPluginBatchSchedule[] = [];
  if (Array.isArray(parsed.batchSchedules)) {
    for (const item of parsed.batchSchedules) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.presetId !== "string" ||
        typeof item.createdAt !== "string" ||
        typeof item.updatedAt !== "string"
      ) {
        continue;
      }
      const nowIso = new Date().toISOString();
      const lastRunStatus =
        item.lastRunStatus === "success" ||
        item.lastRunStatus === "partial" ||
        item.lastRunStatus === "failed" ||
        item.lastRunStatus === "blocked"
          ? item.lastRunStatus
          : undefined;
      batchSchedules.push({
        id: item.id.trim() || `plugin-batch-schedule-${randomUUID()}`,
        name: sanitizeDiagnosticText(item.name.trim() || "Plugin batch schedule").slice(0, 120),
        presetId: item.presetId.trim(),
        enabled: typeof item.enabled === "boolean" ? item.enabled : true,
        intervalMs: clampPluginBatchScheduleIntervalMs(item.intervalMs),
        nextRunAt: normalizePluginBatchScheduleNextRunAt(item.nextRunAt, nowIso),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(typeof item.lastRunAt === "string"
          ? { lastRunAt: item.lastRunAt }
          : {}),
        ...(typeof item.lastRunBatchId === "string"
          ? { lastRunBatchId: item.lastRunBatchId }
          : {}),
        ...(lastRunStatus ? { lastRunStatus } : {}),
        operationFingerprints: sanitizePluginBatchOperationFingerprints(
          item.operationFingerprints
        ),
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => sanitizeDiagnosticText(entry))
              .slice(0, 8)
          : [],
      });
    }
  }

  return {
    version: 1,
    plugins,
    runs: runs.slice(0, MAX_PLUGIN_RUNS),
    approvals: prunePluginRunApprovals(approvals),
    batches: batches.slice(0, MAX_PLUGIN_BATCHES),
    batchPresets: batchPresets.slice(0, MAX_PLUGIN_BATCH_PRESETS),
    batchSchedules: batchSchedules.slice(0, MAX_PLUGIN_BATCH_SCHEDULES),
    schedulingPolicy: normalizeAutomationSchedulingPolicy(parsed.schedulingPolicy),
  };
}

async function writePluginDocument(
  rootPath: string,
  document: PluginDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, PLUGINS_FILE),
    `${JSON.stringify(
      {
        version: 1,
        plugins: document.plugins,
        runs: document.runs.slice(0, MAX_PLUGIN_RUNS),
        approvals: prunePluginRunApprovals(document.approvals),
        batches: document.batches.slice(0, MAX_PLUGIN_BATCHES),
        batchPresets: document.batchPresets.slice(0, MAX_PLUGIN_BATCH_PRESETS),
        batchSchedules: document.batchSchedules.slice(0, MAX_PLUGIN_BATCH_SCHEDULES),
        schedulingPolicy: normalizeAutomationSchedulingPolicy(
          document.schedulingPolicy
        ),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function createStoredPluginFromSignedPackage(
  signedPackage: SignedPluginPackageVerification,
  now: string
): StoredPlugin {
  const next: StoredPlugin = {
    ...signedPackage.payload.plugin,
    policyPreset: "standard",
    installSource: "signed-package",
    publisher: signedPackage.payload.publisher,
    ...(signedPackage.payload.publisherId
      ? { packagePublisherId: signedPackage.payload.publisherId }
      : {}),
    packageManifestPath: signedPackage.manifestReference,
    ...(signedPackage.registry
      ? {
          packageRegistryUrl: signedPackage.registry.url,
          packageRegistryName: signedPackage.registry.name,
          packageRegistryPackageId: signedPackage.registry.packageId,
        }
      : {}),
    packageSignatureHash: signedPackage.signatureHash,
    packagePublicKeyFingerprint: signedPackage.publicKeyFingerprint,
    ...(signedPackage.payload.issuedAt
      ? { packageIssuedAt: signedPackage.payload.issuedAt }
      : {}),
    ...(signedPackage.payload.expiresAt
      ? { packageExpiresAt: signedPackage.payload.expiresAt }
      : {}),
    packageVerifiedAt: now,
    packageGovernanceStatus: "verified",
    packageGovernanceDiagnostics: [
      `Signed package pins verified at install: ${signedPackage.signatureHash}.`,
      `Package public key fingerprint: ${signedPackage.publicKeyFingerprint}.`,
    ],
    updatedAt: now,
  };
  next.trustedFingerprint = pluginExecutionFingerprint(next);
  next.trustedAt = now;
  next.grantedPermissionFingerprint = pluginPermissionFingerprint(next);
  next.permissionGrantedAt = now;
  return next;
}

async function readSignedPluginPackageFromSavedRegistry(params: {
  rootPath: string;
  registry: StoredPluginRegistry;
  packageRef: StoredPluginRegistryPackage;
}): Promise<SignedPluginPackageVerification> {
  const manifestUrl = parsePluginDistributionUrl(
    params.packageRef.manifestUrl,
    "Plugin registry package manifest URL"
  );
  const manifestText = await fetchTextWithLimit(
    manifestUrl,
    MAX_PLUGIN_PACKAGE_BYTES,
    "Plugin registry package manifest"
  );
  const verified = verifySignedPluginPackageManifest({
    rootPath: params.rootPath,
    manifestText,
    manifestReference: manifestUrl.toString(),
    expectedSignatureHash: params.packageRef.signatureHash,
    expectedPublicKeyFingerprint: params.packageRef.publicKeyFingerprint,
  });
  assertPluginRegistryPackagePinsMatch(params.packageRef, verified);
  return {
    ...verified,
    manifestReference: manifestUrl.toString(),
    registry: {
      url: params.registry.url,
      name: params.registry.name,
      packageId: params.packageRef.id,
    },
  };
}

function assertStoredPluginPackageMatchesVerification(
  plugin: StoredPlugin,
  signedPackage: SignedPluginPackageVerification
): void {
  const mismatches: string[] = [];
  if (signedPackage.payload.plugin.id !== plugin.id) {
    mismatches.push(
      `plugin id ${signedPackage.payload.plugin.id} does not match installed plugin ${plugin.id}`
    );
  }
  if (plugin.packageSignatureHash !== signedPackage.signatureHash) {
    mismatches.push("signatureHash pin changed");
  }
  if (plugin.packagePublicKeyFingerprint !== signedPackage.publicKeyFingerprint) {
    mismatches.push("publicKeyFingerprint pin changed");
  }
  if (
    (plugin.packagePublisherId ?? "") !==
    (signedPackage.payload.publisherId ?? "")
  ) {
    mismatches.push("publisherId pin changed");
  }
  if ((plugin.packageIssuedAt ?? "") !== (signedPackage.payload.issuedAt ?? "")) {
    mismatches.push("issuedAt pin changed");
  }
  if ((plugin.packageExpiresAt ?? "") !== (signedPackage.payload.expiresAt ?? "")) {
    mismatches.push("expiresAt pin changed");
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Signed plugin package governance check failed: ${mismatches.join(", ")}.`
    );
  }
}

async function readInstalledSignedPluginPackage(params: {
  rootPath: string;
  plugin: StoredPlugin;
  registryDocument: PluginRegistryStateDocument;
}): Promise<SignedPluginPackageVerification> {
  if (!params.plugin.packageManifestPath) {
    throw new Error("Installed signed plugin is missing package manifest path.");
  }
  if (params.plugin.packageRegistryUrl && params.plugin.packageRegistryPackageId) {
    const savedRegistry = params.registryDocument.registries.find(
      (registry) => registry.url === params.plugin.packageRegistryUrl
    );
    if (savedRegistry) {
      if (!savedRegistry.enabled) {
        throw new Error(`Plugin registry is disabled: ${savedRegistry.name}`);
      }
      const fingerprint = pluginRegistryFingerprint(savedRegistry);
      if (pluginRegistryTrustStatus(savedRegistry, fingerprint) !== "trusted") {
        throw new Error(
          `Plugin registry must be trusted before package revalidation: ${savedRegistry.name} (${fingerprint})`
        );
      }
      const packageRef = (savedRegistry.packages ?? []).find(
        (item) => item.id === params.plugin.packageRegistryPackageId
      );
      if (!packageRef) {
        throw new Error(
          `Plugin registry package not found during revalidation: ${params.plugin.packageRegistryPackageId}`
        );
      }
      const revocation = pluginRegistrySignerRevocation(
        savedRegistry,
        packageRef.publicKeyFingerprint
      );
      if (revocation) {
        throw new Error(
          `Plugin registry signer is revoked: ${packageRef.publicKeyFingerprint}${
            revocation.reason ? ` (${revocation.reason})` : ""
          }`
        );
      }
      return await readSignedPluginPackageFromSavedRegistry({
        rootPath: params.rootPath,
        registry: savedRegistry,
        packageRef,
      });
    }
    return await readSignedPluginPackageFromRegistry({
      rootPath: params.rootPath,
      registryUrl: params.plugin.packageRegistryUrl,
      packageId: params.plugin.packageRegistryPackageId,
    });
  }
  return await readSignedPluginPackage({
    rootPath: params.rootPath,
    manifestPath: params.plugin.packageManifestPath,
  });
}

function resolvePluginWorkingDirectory(rootPath: string, plugin: StoredPlugin): string {
  if (!plugin.workingDirectory) {
    return rootPath;
  }
  const resolved = path.resolve(rootPath, plugin.workingDirectory);
  if (!isPathInside(rootPath, resolved)) {
    throw new Error(
      `Plugin working directory must stay inside the project root: ${plugin.workingDirectory}`
    );
  }
  return resolved;
}

function pluginExecutionEnv(
  rootPath: string,
  plugin: StoredPlugin
): Record<string, string> {
  const policy = effectivePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
    policyPreset: plugin.policyPreset,
  });
  const env: Record<string, string> = {};
  for (const key of PLUGIN_BASE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  if (policy.scopes.includes("env")) {
    for (const key of policy.envKeys) {
      const value = process.env[key];
      if (typeof value === "string") {
        env[key] = value;
      }
    }
  }
  env.ERAGEAR_PLUGIN_ID = plugin.id;
  env.ERAGEAR_PLUGIN_NAME = plugin.name;
  env.ERAGEAR_PLUGIN_SCOPES = policy.scopes.join(",");
  env.ERAGEAR_PLUGIN_POLICY_PRESET = normalizeExecutionPolicyPreset(
    plugin.policyPreset
  );
  env.ERAGEAR_PLUGIN_WORKSPACE_ACCESS = policy.scopes.includes("project-root")
    ? "project-root"
    : "sandbox";
  if (policy.scopes.includes("project-root")) {
    env.ERAGEAR_PROJECT_ROOT = rootPath;
  }
  return env;
}

function toVisiblePlugins(
  rootPath: string,
  document: PluginDocument
): LocalAdePluginDescriptor[] {
  const sourcePath = path.join(ensureProjectDataDir(rootPath), PLUGINS_FILE);
  return document.plugins.map((plugin) => {
    const lastRun = document.runs.find((run) => run.pluginId === plugin.id);
    const policy = effectivePluginPolicy({
      scopes: plugin.scopes,
      envKeys: plugin.envKeys,
      policyPreset: plugin.policyPreset,
    });
    const fingerprint = pluginExecutionFingerprint(plugin);
    const trustStatus = pluginTrustStatus(plugin, fingerprint);
    const permissionFingerprint = pluginPermissionFingerprint(plugin);
    const permissionStatus = pluginPermissionStatus(plugin, permissionFingerprint);
    const executionPolicy = localProcessExecutionPolicy({
      kind: "plugin",
      command: plugin.command,
      args: plugin.args,
      preset: plugin.policyPreset,
      context: "manual-run",
      isolation: {
        cwdScope: policy.scopes.includes("project-root")
          ? "project-root"
          : "temporary-sandbox",
        projectRootExposed: policy.scopes.includes("project-root"),
        timeoutMs: clampPluginTimeout(plugin.timeoutMs),
      },
    });
    const runOperation = pluginRunOperationPreview(
      rootPath,
      plugin,
      document.approvals
    );
    const scheduling = automationSchedulingState({
      rootPath,
      kind: "plugin",
      itemId: plugin.id,
      policy: document.schedulingPolicy,
      runs: document.runs,
    });
    const packageExpiryStatus =
      plugin.installSource === "signed-package"
        ? pluginPackageExpiryStatus(plugin)
        : undefined;
    const dependencyIds = normalizePluginDependencyIds(
      plugin.dependencyIds,
      plugin.id
    );
    const diagnostics = [
      "Project-local plugin execution is available from Settings > Automation.",
      policy.scopes.includes("project-root")
        ? "Plugins run without shell expansion and are constrained to the project root for cwd."
        : "Plugin lacks project-root scope; manual runs use a temporary sandbox cwd and hide ERAGEAR_PROJECT_ROOT.",
      "Plugin environment is isolated; only base runtime env and approved env keys are exposed.",
      `Plugin execution fingerprint: ${fingerprint}.`,
      `Plugin policy preset: ${normalizeExecutionPolicyPreset(plugin.policyPreset)}.`,
      `Plugin permission fingerprint: ${permissionFingerprint}.`,
      `Plugin run operation fingerprint: ${runOperation.fingerprint}.`,
      `Manual plugin runs require confirmation token: ${pluginRunConfirmationToken(plugin)}.`,
      `Manual plugin run operation approval status: ${runOperation.approvalStatus}.`,
      `Plugin sandbox policy: ${executionPolicy.status}.`,
      `Plugin scheduling status: ${scheduling.status}.`,
      dependencyIds.length > 0
        ? `Plugin dependency ids: ${dependencyIds.join(", ")}.`
        : "Plugin has no batch dependencies.",
    ];
    if (plugin.installSource === "signed-package") {
      diagnostics.push(
        `Plugin package signature was verified for publisher ${plugin.publisher ?? "unknown"}.`
      );
      if (plugin.packageSignatureHash) {
        diagnostics.push(`Plugin package signature hash: ${plugin.packageSignatureHash}.`);
      }
      if (plugin.packagePublicKeyFingerprint) {
        diagnostics.push(
          `Plugin package public key fingerprint: ${plugin.packagePublicKeyFingerprint}.`
        );
      }
      if (plugin.packagePublisherId) {
        diagnostics.push(`Plugin package publisher identity: ${plugin.packagePublisherId}.`);
      }
      if (plugin.packageIssuedAt) {
        diagnostics.push(`Plugin package issued at: ${plugin.packageIssuedAt}.`);
      }
      if (plugin.packageExpiresAt) {
        diagnostics.push(`Plugin package expires at: ${plugin.packageExpiresAt}.`);
      }
      diagnostics.push(
        `Plugin package governance status: ${plugin.packageGovernanceStatus ?? "verified"}.`
      );
      if (plugin.packageGovernanceDiagnostics?.length) {
        diagnostics.push(...plugin.packageGovernanceDiagnostics);
      }
      diagnostics.push(
        `Plugin package expiry status: ${packageExpiryStatus ?? "not-declared"}.`
      );
      if (packageExpiryStatus === "expired") {
        diagnostics.push(
          "Plugin package signature has expired; install an updated signed package before running."
        );
      }
    }
    diagnostics.push(
      ...executionPolicy.blockers,
      ...executionPolicy.warnings,
      ...scheduling.diagnostics
    );
    if (policy.envKeys.length > 0) {
      diagnostics.push(
        `Approved plugin env keys: ${policy.envKeys.join(", ")}. Values are never shown in the UI.`
      );
    }
    if (trustStatus === "trusted") {
      diagnostics.push("Plugin trust is approved for the current command fingerprint.");
    } else if (trustStatus === "changed") {
      diagnostics.push(
        "Plugin command, args, or working directory changed after trust approval; review and trust the current fingerprint before running."
      );
    } else {
      diagnostics.push("Plugin is untrusted; review and trust this fingerprint before running.");
    }
    if (permissionStatus === "granted") {
      diagnostics.push("Plugin permissions are granted for the current scope/env/workspace fingerprint.");
    } else if (permissionStatus === "changed") {
      diagnostics.push(
        "Plugin scopes, env allowlist, or workspace access changed after permission approval; review and grant the current permission fingerprint before running."
      );
    } else {
      diagnostics.push("Plugin permissions are not granted for the current scope/env/workspace fingerprint.");
    }
    if (!plugin.command.trim()) {
      diagnostics.push("Plugin command is empty.");
    }
    if (plugin.workingDirectory) {
      const resolved = path.resolve(rootPath, plugin.workingDirectory);
      if (!isPathInside(rootPath, resolved)) {
        diagnostics.push("Working directory is outside the project root.");
      } else if (!policy.scopes.includes("project-root")) {
        diagnostics.push(
          "Configured working directory is ignored until project-root scope is granted."
        );
      }
    }
    if (
      normalizeExecutionPolicyPreset(plugin.policyPreset) === "restricted" &&
      normalizePluginPolicy({ scopes: plugin.scopes, envKeys: plugin.envKeys }).scopes.includes(
        "project-root"
      )
    ) {
      diagnostics.push(
        "Restricted plugin policy ignores requested project-root scope and forces sandbox workspace access."
      );
    }
    return {
      id: plugin.id,
      name: plugin.name,
      ...(plugin.description ? { description: plugin.description } : {}),
      enabled: plugin.enabled,
      policyPreset: normalizeExecutionPolicyPreset(plugin.policyPreset),
      ...(plugin.installSource ? { installSource: plugin.installSource } : {}),
      ...(plugin.publisher ? { publisher: plugin.publisher } : {}),
      ...(plugin.packagePublisherId
        ? { packagePublisherId: plugin.packagePublisherId }
        : {}),
      ...(plugin.packageManifestPath
        ? { packageManifestPath: plugin.packageManifestPath }
        : {}),
      ...(plugin.packageRegistryUrl
        ? { packageRegistryUrl: plugin.packageRegistryUrl }
        : {}),
      ...(plugin.packageRegistryName
        ? { packageRegistryName: plugin.packageRegistryName }
        : {}),
      ...(plugin.packageRegistryPackageId
        ? { packageRegistryPackageId: plugin.packageRegistryPackageId }
        : {}),
      ...(plugin.packageSignatureHash
        ? { packageSignatureHash: plugin.packageSignatureHash }
        : {}),
      ...(plugin.packagePublicKeyFingerprint
        ? { packagePublicKeyFingerprint: plugin.packagePublicKeyFingerprint }
        : {}),
      ...(plugin.packageIssuedAt ? { packageIssuedAt: plugin.packageIssuedAt } : {}),
      ...(plugin.packageExpiresAt
        ? { packageExpiresAt: plugin.packageExpiresAt }
        : {}),
      ...(packageExpiryStatus ? { packageExpiryStatus } : {}),
      ...(plugin.packageVerifiedAt ? { packageVerifiedAt: plugin.packageVerifiedAt } : {}),
      ...(plugin.packageGovernanceStatus
        ? { packageGovernanceStatus: plugin.packageGovernanceStatus }
        : plugin.installSource === "signed-package"
          ? { packageGovernanceStatus: "verified" as const }
          : {}),
      ...(plugin.packageGovernanceDiagnostics
        ? { packageGovernanceDiagnostics: plugin.packageGovernanceDiagnostics }
        : {}),
      scopes: policy.scopes,
      dependencyIds,
      envKeys: policy.envKeys,
      fingerprint,
      trustStatus,
      ...(plugin.trustedFingerprint
        ? { trustedFingerprint: plugin.trustedFingerprint }
        : {}),
      ...(plugin.trustedAt ? { trustedAt: plugin.trustedAt } : {}),
      permissionFingerprint,
      permissionStatus,
      ...(plugin.grantedPermissionFingerprint
        ? { grantedPermissionFingerprint: plugin.grantedPermissionFingerprint }
        : {}),
      ...(plugin.permissionGrantedAt
        ? { permissionGrantedAt: plugin.permissionGrantedAt }
        : {}),
      command: plugin.command,
      args: plugin.args ?? [],
      timeoutMs: plugin.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
      ...(plugin.workingDirectory ? { workingDirectory: plugin.workingDirectory } : {}),
      sourcePath,
      updatedAt: plugin.updatedAt,
      runConfirmationToken: pluginRunConfirmationToken(plugin),
      runOperation,
      executionPolicy,
      scheduling,
      ...(lastRun ? { lastRun } : {}),
      diagnostics,
    };
  });
}

function pluginCapabilities(
  plugins: LocalAdePluginDescriptor[]
): CapabilityDescriptor[] {
  return plugins.map((plugin) => ({
    id: `plugin.project.${plugin.id}`,
    kind: "plugin",
    name: plugin.name,
    description:
      plugin.description ??
      "Project-local plugin runnable from Settings > Automation.",
    scope: "project",
    enabled:
      plugin.enabled &&
      plugin.trustStatus === "trusted" &&
      plugin.permissionStatus === "granted" &&
      plugin.executionPolicy.status === "allowed" &&
      plugin.packageExpiryStatus !== "expired" &&
      plugin.packageGovernanceStatus !== "verification-failed" &&
      plugin.scheduling.status === "ready",
    sourcePath: plugin.sourcePath,
    storage: "filesystem-discovery",
    tags: [
      "project-plugin",
      "manual-plugin",
      `policy:${plugin.policyPreset}`,
      plugin.installSource === "signed-package" ? "signed-package" : "manual-package",
      plugin.trustStatus === "trusted" ? "trusted" : "requires-trust",
      plugin.permissionStatus === "granted"
        ? "permissions:granted"
        : "permissions:review-required",
      plugin.executionPolicy.status === "allowed"
        ? "sandbox:allowed"
        : "sandbox:blocked",
      `schedule:${plugin.scheduling.status}`,
      plugin.packageExpiryStatus
        ? `package-expiry:${plugin.packageExpiryStatus}`
        : "package-expiry:not-applicable",
      plugin.packageGovernanceStatus
        ? `package-governance:${plugin.packageGovernanceStatus}`
        : plugin.installSource === "signed-package"
          ? "package-governance:verified"
          : "package-governance:not-applicable",
      plugin.scopes.includes("project-root")
        ? "workspace:project-root"
        : "workspace:sandbox",
      ...plugin.scopes.map((scope) => `scope:${scope}`),
      plugin.envKeys.length > 0 ? "env-allowlist" : "isolated-env",
    ],
    diagnostics: plugin.diagnostics,
  }));
}

async function runPluginProcess(params: {
  rootPath: string;
  plugin: StoredPlugin;
  batchId?: string;
}): Promise<LocalAdePluginRun> {
  if (!params.plugin.enabled) {
    throw new Error(`Plugin is disabled: ${params.plugin.name}`);
  }
  if (!params.plugin.command.trim()) {
    throw new Error(`Plugin command is empty: ${params.plugin.name}`);
  }
  assertLocalProcessExecutionAllowed({
    kind: "plugin",
    name: params.plugin.name,
    command: params.plugin.command,
    args: params.plugin.args,
    preset: params.plugin.policyPreset,
    context: "manual-run",
  });
  const fingerprint = pluginExecutionFingerprint(params.plugin);
  if (pluginTrustStatus(params.plugin, fingerprint) !== "trusted") {
    throw new Error(
      `Plugin must be trusted before execution: ${params.plugin.name} (${fingerprint})`
    );
  }
  const permissionFingerprint = pluginPermissionFingerprint(params.plugin);
  if (pluginPermissionStatus(params.plugin, permissionFingerprint) !== "granted") {
    throw new Error(
      `Plugin permissions must be granted before execution: ${params.plugin.name} (${permissionFingerprint})`
    );
  }
  if (
    params.plugin.installSource === "signed-package" &&
    pluginPackageExpiryStatus(params.plugin) === "expired"
  ) {
    throw new Error(`Plugin package signature has expired: ${params.plugin.name}`);
  }

  const policy = effectivePluginPolicy({
    scopes: params.plugin.scopes,
    envKeys: params.plugin.envKeys,
    policyPreset: params.plugin.policyPreset,
  });
  const workspaceAccess = policy.scopes.includes("project-root")
    ? "project-root"
    : "sandbox";
  const sandboxDir =
    workspaceAccess === "sandbox"
      ? await mkdtemp(path.join(os.tmpdir(), PLUGIN_SANDBOX_DIR_PREFIX))
      : undefined;
  const cwd =
    workspaceAccess === "project-root"
      ? resolvePluginWorkingDirectory(params.rootPath, params.plugin)
      : sandboxDir!;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const timeoutMs = clampPluginTimeout(params.plugin.timeoutMs);
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;
  let processTreeTerminated = false;
  const terminationDiagnostics: string[] = [];

  function appendOutput(current: string, chunk: Buffer, stream: "stdout" | "stderr") {
    if (Buffer.byteLength(current, "utf8") >= MAX_HOOK_OUTPUT_BYTES) {
      if (stream === "stdout") {
        stdoutTruncated = true;
      } else {
        stderrTruncated = true;
      }
      return current;
    }
    const next = current + chunk.toString("utf8");
    if (Buffer.byteLength(next, "utf8") <= MAX_HOOK_OUTPUT_BYTES) {
      return next;
    }
    const limited = Buffer.from(next, "utf8")
      .subarray(0, MAX_HOOK_OUTPUT_BYTES)
      .toString("utf8");
    if (stream === "stdout") {
      stdoutTruncated = true;
    } else {
      stderrTruncated = true;
    }
    return limited;
  }

  const result = await new Promise<{
    exitCode?: number;
    signal?: string;
    error?: Error;
  }>((resolve) => {
    let settled = false;
    let terminationPromise: Promise<void> | undefined;
    const child = spawn(params.plugin.command, params.plugin.args ?? [], {
      cwd,
      env: pluginExecutionEnv(params.rootPath, params.plugin),
      shell: false,
      windowsHide: true,
      detached: localProcessDetachedProcessGroup(),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminationPromise = terminateLocalProcessTree({
        child,
        diagnostics: terminationDiagnostics,
      }).then((terminated) => {
        processTreeTerminated = terminated;
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk, "stderr");
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void (async () => {
        await terminationPromise;
        resolve({ error });
      })();
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void (async () => {
        await terminationPromise;
        resolve({
          ...(typeof code === "number" ? { exitCode: code } : {}),
          ...(signal ? { signal } : {}),
        });
      })();
    });
  });

  const finishedAt = new Date().toISOString();
  const exitCode = result.exitCode;
  const status: LocalAdePluginRun["status"] = timedOut
    ? "timeout"
    : result.error
      ? "failed"
      : exitCode === 0
        ? "success"
        : "failed";
  const diagnostics = [
    `Executed ${commandLabel(params.plugin.command, params.plugin.args)} without shell expansion.`,
    `Working directory: ${cwd}.`,
    `Plugin scopes: ${policy.scopes.join(", ")}.`,
    `Plugin env isolation: ${policy.envKeys.length > 0 ? policy.envKeys.join(", ") : "no extra env keys"}.`,
    `Trusted plugin fingerprint: ${fingerprint}.`,
  ];
  const isolation = createLocalProcessIsolation({
    cwdScope: workspaceAccess === "project-root" ? "project-root" : "temporary-sandbox",
    projectRootExposed: workspaceAccess === "project-root",
    timeoutMs,
    processTreeTerminated,
  });
  diagnostics.push(...isolation.diagnostics, ...terminationDiagnostics);
  if (result.error) {
    diagnostics.push(`Plugin process error: ${errorMessage(result.error)}`);
  }
  if (timedOut) {
    diagnostics.push(`Plugin timed out after ${timeoutMs}ms.`);
  }
  if (stdoutTruncated || stderrTruncated) {
    diagnostics.push(`Plugin output was truncated to ${MAX_HOOK_OUTPUT_BYTES} bytes per stream.`);
  }
  if (workspaceAccess === "sandbox") {
    diagnostics.push(
      `Plugin workspace access: sandbox cwd ${cwd}; ERAGEAR_PROJECT_ROOT was not exposed.`
    );
  } else {
    diagnostics.push("Plugin workspace access: project-root scope granted.");
  }
  if (sandboxDir) {
    try {
      await rm(sandboxDir, { recursive: true, force: true });
      diagnostics.push("Plugin sandbox cwd was removed after execution.");
    } catch (error) {
      diagnostics.push(
        `Plugin sandbox cleanup failed: ${errorMessage(error)}`
      );
    }
  }

  return {
    id: `plugin-run-${randomUUID()}`,
    pluginId: params.plugin.id,
    pluginName: params.plugin.name,
    ...(params.batchId ? { batchId: params.batchId } : {}),
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    status,
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    ...(result.signal ? { signal: result.signal } : {}),
    stdout: sanitizeDiagnosticText(stdout),
    stderr: sanitizeDiagnosticText(stderr),
    isolation,
    diagnostics,
  };
}

function sanitizeRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.trim()) {
      continue;
    }
    result[key.trim()] = String(value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isValidMcpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function isValidMcpHeaderEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function sanitizeMcpHeaderEnvRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [rawHeader, rawEnvKey] of Object.entries(input)) {
    const header = rawHeader.trim();
    const envKey = String(rawEnvKey).trim();
    if (!header || !envKey) {
      continue;
    }
    if (!isValidMcpHeaderName(header)) {
      throw new Error(`Invalid MCP header name: ${header}`);
    }
    if (!isValidMcpHeaderEnvKey(envKey)) {
      throw new Error(`Invalid MCP header env key for ${header}: ${envKey}`);
    }
    result[header] = envKey;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeMcpHeaderRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [rawHeader, rawValue] of Object.entries(input)) {
    const header = rawHeader.trim();
    if (!header) {
      continue;
    }
    if (!isValidMcpHeaderName(header)) {
      throw new Error(`Invalid MCP header name: ${header}`);
    }
    result[header] = String(rawValue);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function unsafeLiteralMcpHeaderNames(headers: Record<string, string> | undefined): string[] {
  return Object.keys(headers ?? {}).filter((header) => SECRET_HINT_PATTERN.test(header));
}

function resolveMcpRuntimeHeaders(server: StoredMcpServer): {
  headers: Record<string, string>;
  secretValues: string[];
  diagnostics: string[];
  missingEnvKeys: string[];
  blockedLiteralHeaders: string[];
} {
  const literalHeaders = server.headers ?? {};
  const blockedLiteralHeaders = unsafeLiteralMcpHeaderNames(literalHeaders);
  const headerEnv = server.headerEnv ?? {};
  const resolvedHeaders: Record<string, string> = { ...literalHeaders };
  const diagnostics: string[] = [];
  const missingEnvKeys: string[] = [];
  const secretValues = [
    ...Object.values(server.env ?? {}),
    ...Object.values(literalHeaders),
  ];

  for (const [header, envKey] of Object.entries(headerEnv)) {
    const value = process.env[envKey];
    if (!value) {
      missingEnvKeys.push(envKey);
      continue;
    }
    resolvedHeaders[header] = value;
    secretValues.push(value);
  }

  if (Object.keys(headerEnv).length > 0) {
    diagnostics.push(
      `MCP remote header env policy loaded ${Object.keys(headerEnv).length} headers by env key.`
    );
  }
  if (missingEnvKeys.length > 0) {
    diagnostics.push(
      `MCP remote header env policy is missing env keys: ${missingEnvKeys.join(", ")}.`
    );
  }
  if (blockedLiteralHeaders.length > 0) {
    diagnostics.push(
      `MCP literal secret headers are blocked: ${blockedLiteralHeaders.join(", ")}. Use header env mapping instead.`
    );
  }

  return {
    headers: resolvedHeaders,
    secretValues,
    diagnostics,
    missingEnvKeys,
    blockedLiteralHeaders,
  };
}

function visibleMcpHeaderEnv(
  headerEnv: Record<string, string> | undefined
): LocalAdeMcpServer["headerEnv"] {
  return Object.entries(headerEnv ?? {})
    .map(([header, envKey]) => ({
      header,
      envKey,
      present: Boolean(process.env[envKey]),
    }))
    .sort((left, right) => left.header.localeCompare(right.header));
}

type StoredMcpRemoteControls = NonNullable<StoredMcpServer["remoteControls"]>;

function clampMcpInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeMcpRemoteControls(
  value: unknown
): StoredMcpRemoteControls | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const requestTimeoutMs = clampMcpInteger(
    value.requestTimeoutMs,
    MCP_PROTOCOL_TIMEOUT_MS,
    MIN_MCP_REMOTE_REQUEST_TIMEOUT_MS,
    MAX_MCP_REMOTE_REQUEST_TIMEOUT_MS
  );
  const reconnectAttempts = clampMcpInteger(
    value.reconnectAttempts,
    MCP_SSE_RECONNECT_ATTEMPTS,
    MIN_MCP_REMOTE_RECONNECT_ATTEMPTS,
    MAX_MCP_REMOTE_RECONNECT_ATTEMPTS
  );
  const notificationWatchMs = normalizeMcpNotificationWatchMs(
    value.notificationWatchMs
  );
  const hasCustom =
    requestTimeoutMs !== MCP_PROTOCOL_TIMEOUT_MS ||
    reconnectAttempts !== MCP_SSE_RECONNECT_ATTEMPTS ||
    notificationWatchMs !== DEFAULT_MCP_NOTIFICATION_WATCH_MS;
  return hasCustom
    ? { requestTimeoutMs, reconnectAttempts, notificationWatchMs }
    : undefined;
}

function visibleMcpRemoteControls(
  server: Pick<StoredMcpServer, "remoteControls">
): LocalAdeMcpRemoteControls {
  const controls = normalizeMcpRemoteControls(server.remoteControls);
  return {
    requestTimeoutMs: controls?.requestTimeoutMs ?? MCP_PROTOCOL_TIMEOUT_MS,
    reconnectAttempts: controls?.reconnectAttempts ?? MCP_SSE_RECONNECT_ATTEMPTS,
    notificationWatchMs:
      controls?.notificationWatchMs ?? DEFAULT_MCP_NOTIFICATION_WATCH_MS,
    mode: controls ? "custom" : "default",
    diagnostics: controls
      ? ["MCP remote operational controls are customized for this server."]
      : ["MCP remote operational controls use Eragear defaults."],
  };
}

function mcpRequestTimeoutMs(server: Pick<StoredMcpServer, "remoteControls">): number {
  return visibleMcpRemoteControls(server).requestTimeoutMs;
}

function mcpReconnectAttempts(server: Pick<StoredMcpServer, "remoteControls">): number {
  return visibleMcpRemoteControls(server).reconnectAttempts;
}

function mcpNotificationWatchMs(server: Pick<StoredMcpServer, "remoteControls">): number {
  return visibleMcpRemoteControls(server).notificationWatchMs;
}

function hashSecretMaterial(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sortedMcpRecordHashes(
  record: Record<string, string> | undefined
): Array<{ key: string; valueHash: string }> {
  return Object.entries(record ?? {})
    .map(([key, value]) => ({
      key,
      valueHash: hashSecretMaterial(String(value)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function sortedMcpHeaderEnv(
  record: Record<string, string> | undefined
): Array<{ header: string; envKey: string }> {
  return Object.entries(record ?? {})
    .map(([header, envKey]) => ({ header, envKey }))
    .sort((left, right) => left.header.localeCompare(right.header));
}

function mcpInvocationFingerprint(server: Pick<
  StoredMcpServer,
  | "transport"
  | "command"
  | "args"
  | "url"
  | "messageEndpoint"
  | "env"
  | "headers"
  | "headerEnv"
  | "remoteControls"
>): string {
  const payload = JSON.stringify({
    version: 1,
    transport: server.transport,
    command: server.command?.trim() ?? "",
    args: (server.args ?? []).map((arg) => String(arg)),
    url: server.url?.trim() ?? "",
    messageEndpoint: server.messageEndpoint?.trim() ?? "",
    env: sortedMcpRecordHashes(server.env),
    headers: sortedMcpRecordHashes(server.headers),
    headerEnv: sortedMcpHeaderEnv(server.headerEnv),
    remoteControls: visibleMcpRemoteControls(server),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function mcpTrustStatus(
  server: StoredMcpServer,
  fingerprint = mcpInvocationFingerprint(server)
): LocalAdeMcpServer["trustStatus"] {
  if (!server.trustedFingerprint) {
    return "untrusted";
  }
  return server.trustedFingerprint === fingerprint ? "trusted" : "changed";
}

const MCP_PROBE_STEP_NAMES = new Set<LocalAdeMcpProbeStepName>([
  "header-policy",
  "resolve",
  "spawn",
  "stream-open",
  "stream-reconnect",
  "endpoint",
  "initialize",
  "initialized",
  "tools/list",
  "resources/list",
]);

function sanitizeMcpHistoryText(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function parseIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? value : undefined;
}

function parseNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

function parseMcpProbeStep(
  value: unknown,
  fallbackTransport: McpTransport
): LocalAdeMcpProbeStep | null {
  if (!isRecord(value) || !MCP_PROBE_STEP_NAMES.has(value.step as LocalAdeMcpProbeStepName)) {
    return null;
  }
  const status =
    value.status === "success" || value.status === "failed" || value.status === "skipped"
      ? value.status
      : undefined;
  const startedAt = parseIsoTimestamp(value.startedAt);
  const completedAt = parseIsoTimestamp(value.completedAt);
  if (!status || !startedAt || !completedAt) {
    return null;
  }
  const transport =
    value.transport === "sse" || value.transport === "streamable-http" || value.transport === "stdio"
      ? value.transport
      : fallbackTransport;
  return {
    step: value.step as LocalAdeMcpProbeStepName,
    transport,
    status,
    startedAt,
    completedAt,
    latencyMs:
      typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs)
        ? Math.max(0, Math.round(value.latencyMs))
        : 0,
    ...(sanitizeMcpHistoryText(value.detail) ? { detail: sanitizeMcpHistoryText(value.detail) } : {}),
    ...(sanitizeMcpHistoryText(value.error) ? { error: sanitizeMcpHistoryText(value.error) } : {}),
  };
}

function parseMcpProbeHistory(
  value: unknown,
  fallbackServer: Pick<StoredMcpServer, "id" | "name" | "transport">
): LocalAdeMcpProbeRun[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const runs: LocalAdeMcpProbeRun[] = [];
  for (const item of value.slice(0, MAX_MCP_PROBE_HISTORY)) {
    if (!isRecord(item)) {
      continue;
    }
    const startedAt = parseIsoTimestamp(item.startedAt);
    const finishedAt = parseIsoTimestamp(item.finishedAt);
    const status =
      item.status === "success" ||
      item.status === "failed" ||
      item.status === "skipped" ||
      item.status === "not-run"
        ? item.status
        : undefined;
    const health =
      item.health === "available" ||
      item.health === "unavailable" ||
      item.health === "invalid-config" ||
      item.health === "disabled" ||
      item.health === "not-probed"
        ? item.health
        : undefined;
    const protocolStatus =
      item.protocolStatus === "initialized" ||
      item.protocolStatus === "failed" ||
      item.protocolStatus === "unsupported" ||
      item.protocolStatus === "not-run"
        ? item.protocolStatus
        : undefined;
    if (!startedAt || !finishedAt || !status || !health || !protocolStatus) {
      continue;
    }
    const transport =
      item.transport === "sse" || item.transport === "streamable-http" || item.transport === "stdio"
        ? item.transport
        : fallbackServer.transport;
    const steps = Array.isArray(item.steps)
      ? item.steps
          .map((step) => parseMcpProbeStep(step, transport))
          .filter((step): step is LocalAdeMcpProbeStep => Boolean(step))
          .slice(0, 24)
      : [];
    runs.push({
      id: sanitizeMcpHistoryText(item.id, 120) ?? `mcp-probe-${randomUUID()}`,
      serverId: sanitizeMcpHistoryText(item.serverId, 120) ?? fallbackServer.id,
      serverName: sanitizeMcpHistoryText(item.serverName, 160) ?? fallbackServer.name,
      transport,
      status,
      health,
      protocolStatus,
      startedAt,
      finishedAt,
      durationMs:
        typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
          ? Math.max(0, Math.round(item.durationMs))
          : Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      stepCount:
        typeof item.stepCount === "number" && Number.isFinite(item.stepCount)
          ? Math.max(0, Math.round(item.stepCount))
          : steps.length,
      failedStepCount:
        typeof item.failedStepCount === "number" && Number.isFinite(item.failedStepCount)
          ? Math.max(0, Math.round(item.failedStepCount))
          : steps.filter((step) => step.status === "failed").length,
      toolsDiscovered:
        typeof item.toolsDiscovered === "number" && Number.isFinite(item.toolsDiscovered)
          ? Math.max(0, Math.round(item.toolsDiscovered))
          : 0,
      resourcesDiscovered:
        typeof item.resourcesDiscovered === "number" &&
        Number.isFinite(item.resourcesDiscovered)
          ? Math.max(0, Math.round(item.resourcesDiscovered))
          : 0,
      steps,
      diagnostics: Array.isArray(item.diagnostics)
        ? item.diagnostics
            .map((diagnostic) => sanitizeMcpHistoryText(diagnostic))
            .filter((diagnostic): diagnostic is string => Boolean(diagnostic))
            .slice(0, 12)
        : [],
    });
  }
  return runs;
}

function parseMcpInvocationContentItem(
  value: unknown
): LocalAdeMcpInvocationContent | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = sanitizeMcpHistoryText(value.type, 80) ?? "unknown";
  const text =
    typeof value.text === "string"
      ? sanitizeMcpInvocationOutput(value.text).value
      : undefined;
  const uri = sanitizeMcpHistoryText(value.uri, 500);
  const mimeType = sanitizeMcpHistoryText(value.mimeType, 160);
  const byteLength =
    typeof value.byteLength === "number" && Number.isFinite(value.byteLength)
      ? Math.max(0, Math.round(value.byteLength))
      : undefined;
  return {
    type,
    ...(text ? { text } : {}),
    ...(uri ? { uri } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(byteLength !== undefined ? { byteLength } : {}),
  };
}

function parseMcpInvocationHistory(
  value: unknown,
  fallbackServer: Pick<StoredMcpServer, "id" | "name" | "transport">
): LocalAdeMcpInvocationResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const runs: LocalAdeMcpInvocationResult[] = [];
  for (const item of value.slice(0, MAX_MCP_INVOCATION_HISTORY)) {
    if (!isRecord(item)) {
      continue;
    }
    const startedAt = parseIsoTimestamp(item.startedAt);
    const finishedAt = parseIsoTimestamp(item.finishedAt);
    const method =
      item.method === "tools/call" || item.method === "resources/read"
        ? item.method
        : undefined;
    const status =
      item.status === "success" || item.status === "failed"
        ? item.status
        : undefined;
    if (!startedAt || !finishedAt || !method || !status) {
      continue;
    }
    const transport =
      item.transport === "sse" ||
      item.transport === "streamable-http" ||
      item.transport === "stdio"
        ? item.transport
        : fallbackServer.transport;
    const resultText =
      typeof item.resultText === "string"
        ? sanitizeMcpInvocationOutput(item.resultText).value
        : "";
    const resultJson =
      typeof item.resultJson === "string"
        ? sanitizeMcpInvocationOutput(item.resultJson).value
        : "";
    runs.push({
      serverId: sanitizeMcpHistoryText(item.serverId, 120) ?? fallbackServer.id,
      serverName:
        sanitizeMcpHistoryText(item.serverName, 160) ?? fallbackServer.name,
      transport,
      method,
      target: sanitizeMcpHistoryText(item.target, 500) ?? "unknown",
      status,
      startedAt,
      finishedAt,
      durationMs:
        typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
          ? Math.max(0, Math.round(item.durationMs))
          : Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      isError: item.isError === true,
      resultText,
      resultJson,
      truncated: item.truncated === true,
      content: Array.isArray(item.content)
        ? item.content
            .map(parseMcpInvocationContentItem)
            .filter((content): content is LocalAdeMcpInvocationContent =>
              Boolean(content)
            )
            .slice(0, MAX_MCP_DISCOVERY_ITEMS)
        : [],
      notifications: [],
      diagnostics: Array.isArray(item.diagnostics)
        ? item.diagnostics
            .map((diagnostic) => sanitizeMcpHistoryText(diagnostic))
            .filter((diagnostic): diagnostic is string => Boolean(diagnostic))
            .slice(0, 12)
        : [],
    });
  }
  return runs;
}

function parseMcpAgentInvocation(value: unknown): LocalAdeMcpAgentInvocation | null {
  if (!isRecord(value)) {
    return null;
  }
  const startedAt = parseIsoTimestamp(value.startedAt);
  const finishedAt = parseIsoTimestamp(value.finishedAt);
  const method =
    value.method === "tools/call" || value.method === "resources/read"
      ? value.method
      : undefined;
  const status =
    value.status === "success" || value.status === "failed"
      ? value.status
      : undefined;
  if (!startedAt || !finishedAt || !method || !status) {
    return null;
  }
  return {
    id: sanitizeMcpHistoryText(value.id, 160) ?? `mcp-agent-${randomUUID()}`,
    serverId: sanitizeMcpHistoryText(value.serverId, 160) ?? "unknown",
    serverName: sanitizeMcpHistoryText(value.serverName, 180) ?? "Unknown MCP",
    method,
    target: sanitizeMcpHistoryText(value.target, 500) ?? "unknown",
    status,
    startedAt,
    finishedAt,
    durationMs:
      typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
        ? Math.max(0, Math.round(value.durationMs))
        : Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    ...(typeof value.resultText === "string"
      ? { resultText: sanitizeMcpInvocationOutput(value.resultText).value }
      : {}),
    ...(typeof value.error === "string"
      ? { error: sanitizeMcpInvocationOutput(value.error).value }
      : {}),
    source: "agent-broker",
  };
}

async function readMcpAgentInvocations(
  rootPath: string
): Promise<LocalAdeMcpAgentInvocation[]> {
  let text = "";
  try {
    text = await readFile(
      path.join(ensureProjectDataDir(rootPath), MCP_AGENT_AUDIT_FILE),
      "utf8"
    );
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-MAX_MCP_AGENT_INVOCATION_HISTORY)
    .map((line) => {
      try {
        return parseMcpAgentInvocation(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((item): item is LocalAdeMcpAgentInvocation => Boolean(item))
    .reverse();
}

function parseMcpNotificationHistory(
  value: unknown,
  fallbackServer: Pick<StoredMcpServer, "id" | "name" | "transport">
): LocalAdeMcpNotification[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const notifications: LocalAdeMcpNotification[] = [];
  for (const item of value.slice(0, MAX_MCP_NOTIFICATION_HISTORY)) {
    if (!isRecord(item)) {
      continue;
    }
    const receivedAt = parseIsoTimestamp(item.receivedAt);
    const source =
      item.source === "probe" ||
      item.source === "invocation" ||
      item.source === "monitor"
        ? item.source
        : undefined;
    const method = sanitizeMcpHistoryText(item.method, 180);
    if (!receivedAt || !source || !method) {
      continue;
    }
    const transport =
      item.transport === "sse" ||
      item.transport === "streamable-http" ||
      item.transport === "stdio"
        ? item.transport
        : fallbackServer.transport;
    const payload =
      typeof item.payloadText === "string"
        ? sanitizeMcpStoredNotificationPayload(item.payloadText)
        : sanitizeMcpNotificationPayload(item.payloadText);
    notifications.push({
      id:
        sanitizeMcpHistoryText(item.id, 140) ??
        `mcp-notification-${toHashId(method, receivedAt)}`,
      serverId: sanitizeMcpHistoryText(item.serverId, 120) ?? fallbackServer.id,
      serverName:
        sanitizeMcpHistoryText(item.serverName, 160) ?? fallbackServer.name,
      transport,
      source,
      method,
      receivedAt,
      payloadText: payload.value,
      truncated: item.truncated === true || payload.truncated,
    });
  }
  return notifications;
}

function parseMcpNotificationMonitorHistory(
  value: unknown,
  fallbackServer: Pick<StoredMcpServer, "id" | "name" | "transport">
): LocalAdeMcpNotificationMonitorRun[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const runs: LocalAdeMcpNotificationMonitorRun[] = [];
  for (const item of value.slice(0, MAX_MCP_NOTIFICATION_MONITOR_HISTORY)) {
    if (!isRecord(item)) {
      continue;
    }
    const status =
      item.status === "success" ||
      item.status === "failed" ||
      item.status === "unsupported"
        ? item.status
        : undefined;
    const startedAt = parseIsoTimestamp(item.startedAt);
    const finishedAt = parseIsoTimestamp(item.finishedAt);
    if (!status || !startedAt || !finishedAt) {
      continue;
    }
    const transport =
      item.transport === "sse" ||
      item.transport === "streamable-http" ||
      item.transport === "stdio"
        ? item.transport
        : fallbackServer.transport;
    const diagnostics = Array.isArray(item.diagnostics)
      ? item.diagnostics
          .map((diagnostic) => sanitizeDiagnosticText(String(diagnostic)))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const notifications = parseMcpNotificationHistory(
      item.notifications,
      fallbackServer
    ).filter((notification) => notification.source === "monitor");
    const durationMs =
      typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
        ? Math.max(0, Math.round(item.durationMs))
        : Math.max(
            0,
            new Date(finishedAt).getTime() - new Date(startedAt).getTime()
          );
    const requestedDurationMs = parseNonNegativeInteger(item.requestedDurationMs, DEFAULT_MCP_NOTIFICATION_WATCH_MS);
    const reconnectCount = parseNonNegativeInteger(item.reconnectCount);
    const streamOpenCount = parseNonNegativeInteger(item.streamOpenCount);
    const notificationCount = parseNonNegativeInteger(item.notificationCount, notifications.length);
    runs.push({
      id: sanitizeMcpHistoryText(item.id, 140) ?? `mcp-notification-monitor-${toHashId(fallbackServer.id, finishedAt)}`,
      serverId: sanitizeMcpHistoryText(item.serverId, 120) ?? fallbackServer.id,
      serverName: sanitizeMcpHistoryText(item.serverName, 160) ?? fallbackServer.name,
      transport,
      status,
      startedAt,
      finishedAt,
      durationMs,
      requestedDurationMs,
      reconnectCount,
      streamOpenCount,
      notificationCount,
      notifications,
      diagnostics,
    });
  }
  return runs;
}

async function readMcpDocument(rootPath: string): Promise<McpDocument> {
  const parsed = await readJsonObject(path.join(ensureProjectDataDir(rootPath), MCP_FILE));
  if (!parsed || !Array.isArray(parsed.servers)) {
    return { version: 1, servers: [] };
  }
  const servers: StoredMcpServer[] = [];
  for (const item of parsed.servers) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
      continue;
    }
    const transport =
      item.transport === "sse" || item.transport === "streamable-http"
        ? item.transport
        : "stdio";
    let headers: Record<string, string> | undefined;
    let headerEnv: Record<string, string> | undefined;
    try {
      headers = sanitizeMcpHeaderRecord(item.headers);
      headerEnv = sanitizeMcpHeaderEnvRecord(item.headerEnv);
    } catch {
      continue;
    }
    const stored: StoredMcpServer = {
      id: item.id,
      name: item.name,
      transport,
      enabled: typeof item.enabled === "boolean" ? item.enabled : false,
      ...(typeof item.command === "string" ? { command: item.command } : {}),
      ...(Array.isArray(item.args)
        ? { args: item.args.filter((arg): arg is string => typeof arg === "string") }
        : {}),
      ...(typeof item.url === "string" ? { url: item.url } : {}),
      ...(typeof item.messageEndpoint === "string"
        ? { messageEndpoint: item.messageEndpoint }
        : {}),
      ...(sanitizeRecord(item.env) ? { env: sanitizeRecord(item.env) } : {}),
      ...(headers ? { headers } : {}),
      ...(headerEnv ? { headerEnv } : {}),
      ...(normalizeMcpRemoteControls(item.remoteControls)
        ? { remoteControls: normalizeMcpRemoteControls(item.remoteControls) }
        : {}),
      ...(typeof item.trustedFingerprint === "string" &&
      item.trustedFingerprint.startsWith("sha256:")
        ? { trustedFingerprint: item.trustedFingerprint }
        : {}),
      ...(typeof item.trustedAt === "string" && parseIsoTimestamp(item.trustedAt)
        ? { trustedAt: item.trustedAt }
        : {}),
      updatedAt:
        typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    };
    const probeHistory = parseMcpProbeHistory(item.probeHistory, stored);
    if (probeHistory.length > 0) {
      stored.probeHistory = probeHistory;
    }
    const invocationHistory = parseMcpInvocationHistory(
      item.invocationHistory,
      stored
    );
    if (invocationHistory.length > 0) {
      stored.invocationHistory = invocationHistory;
    }
    const notificationHistory = parseMcpNotificationHistory(
      item.notificationHistory,
      stored
    );
    if (notificationHistory.length > 0) {
      stored.notificationHistory = notificationHistory;
    }
    const notificationMonitorHistory = parseMcpNotificationMonitorHistory(
      item.notificationMonitorHistory,
      stored
    );
    if (notificationMonitorHistory.length > 0) {
      stored.notificationMonitorHistory = notificationMonitorHistory;
    }
    servers.push(stored);
  }
  return { version: 1, servers };
}

async function writeMcpDocument(rootPath: string, document: McpDocument): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, MCP_FILE),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8"
  );
}

async function resolveExecutable(command: string): Promise<{
  available: boolean;
  executablePath?: string;
  diagnostics: string[];
}> {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      available: false,
      diagnostics: ["Command is empty."],
    };
  }

  const hasPathSeparator = /[\\/]/.test(trimmed);
  if (path.isAbsolute(trimmed) || hasPathSeparator) {
    const resolved = path.resolve(trimmed);
    return existsSync(resolved)
      ? {
          available: true,
          executablePath: resolved,
          diagnostics: [`Executable exists at ${resolved}.`],
        }
      : {
          available: false,
          diagnostics: [`Executable was not found at ${resolved}.`],
        };
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(lookupCommand, [trimmed], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const firstPath = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return {
      available: true,
      ...(firstPath ? { executablePath: firstPath } : {}),
      diagnostics: firstPath
        ? [`Resolved ${trimmed} to ${firstPath}.`]
        : [`Resolved ${trimmed} on PATH.`],
    };
  } catch (error) {
    return {
      available: false,
      diagnostics: [
        `Could not resolve ${trimmed}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
}

interface McpDiscoveryResult {
  available: boolean;
  latencyMs: number;
  protocol: LocalAdeMcpServer["protocol"];
  tools: LocalAdeMcpTool[];
  resources: LocalAdeMcpResource[];
  probeSteps: LocalAdeMcpProbeStep[];
  notifications: LocalAdeMcpNotification[];
  diagnostics: string[];
}

function createMcpProbeRecorder(transport: McpTransport): {
  steps: LocalAdeMcpProbeStep[];
  record: (
    step: LocalAdeMcpProbeStepName,
    status: LocalAdeMcpProbeStep["status"],
    params?: { detail?: string; error?: string }
  ) => void;
  start: (
    step: LocalAdeMcpProbeStepName,
    detail?: string
  ) => (
    status: LocalAdeMcpProbeStep["status"],
    params?: { detail?: string; error?: string }
  ) => void;
} {
  const steps: LocalAdeMcpProbeStep[] = [];
  const pushStep = (
    step: LocalAdeMcpProbeStepName,
    status: LocalAdeMcpProbeStep["status"],
    startedAtMs: number,
    params?: { detail?: string; error?: string }
  ) => {
    const completedAtMs = Date.now();
    steps.push({
      step,
      transport,
      status,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      latencyMs: Math.max(0, completedAtMs - startedAtMs),
      ...(params?.detail ? { detail: params.detail } : {}),
      ...(params?.error ? { error: params.error } : {}),
    });
  };
  return {
    steps,
    record: (step, status, params) => pushStep(step, status, Date.now(), params),
    start: (step, detail) => {
      const startedAtMs = Date.now();
      let settled = false;
      return (status, params) => {
        if (settled) {
          return;
        }
        settled = true;
        pushStep(step, status, startedAtMs, {
          ...(detail ? { detail } : {}),
          ...(params ?? {}),
        });
      };
    },
  };
}

function createMcpProbeSummary(
  status: LocalAdeMcpServer["probe"]["status"],
  steps: LocalAdeMcpProbeStep[]
): LocalAdeMcpServer["probe"] {
  const failedStepCount = steps.filter((step) => step.status === "failed").length;
  return {
    status,
    retryable: status === "success" || status === "failed",
    stepCount: steps.length,
    failedStepCount,
    steps,
  };
}

function failedMcpDiscovery(params: {
  latencyMs: number;
  diagnostics: string[];
  error: string;
  probeSteps: LocalAdeMcpProbeStep[];
  notifications?: LocalAdeMcpNotification[];
  unsupported?: boolean;
}): McpDiscoveryResult {
  return {
    available: false,
    latencyMs: params.latencyMs,
    protocol: {
      status: params.unsupported ? "unsupported" : "failed",
      toolsDiscovered: 0,
      resourcesDiscovered: 0,
      error: params.error,
    },
    tools: [],
    resources: [],
    probeSteps: params.probeSteps,
    notifications: params.notifications ?? [],
    diagnostics: params.diagnostics,
  };
}

function initializedMcpDiscovery(params: {
  latencyMs: number;
  diagnostics: string[];
  initializeResult: unknown;
  tools: LocalAdeMcpTool[];
  resources: LocalAdeMcpResource[];
  probeSteps: LocalAdeMcpProbeStep[];
  notifications?: LocalAdeMcpNotification[];
}): McpDiscoveryResult {
  const result = isRecord(params.initializeResult) ? params.initializeResult : {};
  const serverInfo = isRecord(result.serverInfo) ? result.serverInfo : {};
  return {
    available: true,
    latencyMs: params.latencyMs,
    protocol: {
      status: "initialized",
      protocolVersion:
        optionalString(result.protocolVersion) ?? MCP_PROTOCOL_VERSION,
      ...(optionalString(serverInfo.name)
        ? { serverName: optionalString(serverInfo.name) }
        : {}),
      ...(optionalString(serverInfo.version)
        ? { serverVersion: optionalString(serverInfo.version) }
        : {}),
      toolsDiscovered: params.tools.length,
      resourcesDiscovered: params.resources.length,
    },
    tools: params.tools,
    resources: params.resources,
    probeSteps: params.probeSteps,
    notifications: params.notifications ?? [],
    diagnostics: params.diagnostics,
  };
}

function normalizeMcpNotificationWatchMs(value: unknown): number {
  const requested =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : DEFAULT_MCP_NOTIFICATION_WATCH_MS;
  return Math.min(
    MAX_MCP_NOTIFICATION_WATCH_MS,
    Math.max(MIN_MCP_NOTIFICATION_WATCH_MS, requested)
  );
}

function createMcpNotificationMonitorRun(params: {
  server: StoredMcpServer;
  status: LocalAdeMcpNotificationMonitorRun["status"];
  startedAtMs: number;
  requestedDurationMs: number;
  reconnectCount: number;
  streamOpenCount: number;
  notifications: LocalAdeMcpNotification[];
  diagnostics: string[];
}): LocalAdeMcpNotificationMonitorRun {
  const finishedAtMs = Date.now();
  return {
    id: `mcp-notification-monitor-${randomUUID()}`,
    serverId: params.server.id,
    serverName: params.server.name,
    transport: params.server.transport,
    status: params.status,
    startedAt: new Date(params.startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - params.startedAtMs),
    requestedDurationMs: params.requestedDurationMs,
    reconnectCount: params.reconnectCount,
    streamOpenCount: params.streamOpenCount,
    notificationCount: params.notifications.length,
    notifications: params.notifications.slice(0, MAX_MCP_NOTIFICATION_HISTORY),
    diagnostics: params.diagnostics
      .map((diagnostic) => sanitizeDiagnosticText(diagnostic))
      .filter(Boolean)
      .slice(0, 12),
  };
}

async function discoverStdioMcpProtocol(
  rootPath: string,
  server: StoredMcpServer
): Promise<McpDiscoveryResult> {
  const startedAt = Date.now();
  const secretValues = Object.values(server.env ?? {});
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const recorder = createMcpProbeRecorder(server.transport);
  const finishResolve = recorder.start(
    "resolve",
    commandLabel(server.command ?? "", server.args)
  );
  const resolved = await resolveExecutable(server.command ?? "");
  diagnostics.push(...resolved.diagnostics);
  if (!resolved.available) {
    const error = resolved.diagnostics.join(" ");
    finishResolve("failed", { error });
    return failedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      error,
      probeSteps: recorder.steps,
      diagnostics,
    });
  }
  finishResolve("success", { detail: resolved.executablePath ?? server.command });

  let nextId = 1;
  const pending = new Map<
    string,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const finishSpawn = recorder.start(
    "spawn",
    commandLabel(server.command ?? "", server.args)
  );
  const child = spawn(server.command ?? "", server.args ?? [], {
    cwd: rootPath,
    env: {
      ...process.env,
      ...(server.env ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  finishSpawn("success", { detail: `pid ${child.pid ?? "unknown"}` });
  let stdoutBuffer = "";
  let processExited = false;
  let processClosed = false;

  const rejectPending = (message: string) => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} failed: ${message}`));
      pending.delete(id);
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        diagnostics.push(
          `MCP stdout parse error: ${sanitizeDiagnosticText(line, secretValues)}`
        );
        continue;
      }
      if (!isRecord(message)) {
        continue;
      }
      if (message.id === undefined) {
        const notification = createMcpNotification({
          server,
          source: "probe",
          message,
          secretValues,
        });
        if (notification) {
          notifications.push(notification);
          diagnostics.push(`MCP notification received: ${notification.method}.`);
        }
        continue;
      }
      const id = String(message.id);
      const waiter = pending.get(id);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timeout);
      pending.delete(id);
      if (message.error !== undefined) {
        waiter.reject(new Error(parseJsonRpcError(message.error)));
        continue;
      }
      waiter.resolve(message.result);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = sanitizeDiagnosticText(chunk.toString(), secretValues);
    if (text) {
      diagnostics.push(`MCP stderr: ${text}`);
    }
  });
  child.once("error", (error) => {
    const message = errorMessage(error, secretValues);
    diagnostics.push(`MCP process error: ${message}`);
    rejectPending(message);
  });
  child.once("exit", (code, signal) => {
    processExited = true;
    const suffix = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    rejectPending(`MCP process exited with ${suffix}.`);
  });
  child.once("close", () => {
    processClosed = true;
  });

  const request = (
    method: Extract<
      LocalAdeMcpProbeStepName,
      "initialize" | "tools/list" | "resources/list"
    >,
    params?: unknown
  ): Promise<unknown> => {
    const finishRequest = recorder.start(method);
    if (processExited || !child.stdin.writable) {
      const error = "MCP process stdin is not writable.";
      finishRequest("failed", { error });
      return Promise.reject(new Error(error));
    }
    const id = String(nextId++);
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        finishRequest("failed", {
          error: `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for ${method}.`,
        });
        reject(
          new Error(
            `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for ${method}.`
          )
        );
      }, MCP_PROTOCOL_TIMEOUT_MS);
      pending.set(id, { method, resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    }).then(
      (value) => {
        finishRequest("success");
        return value;
      },
      (error) => {
        finishRequest("failed", { error: errorMessage(error, secretValues) });
        throw error;
      }
    );
  };

  try {
    const initializeResult = await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "eragear-code-copilot",
        version: "local-ade",
      },
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      })}\n`
    );
    recorder.record("initialized", "success");

    let tools: LocalAdeMcpTool[] = [];
    let resources: LocalAdeMcpResource[] = [];
    try {
      tools = parseMcpTools(await request("tools/list", {}));
      diagnostics.push(`MCP tools/list returned ${tools.length} tools.`);
    } catch (error) {
      diagnostics.push(`MCP tools/list failed: ${errorMessage(error, secretValues)}`);
    }
    try {
      resources = parseMcpResources(await request("resources/list", {}));
      diagnostics.push(`MCP resources/list returned ${resources.length} resources.`);
    } catch (error) {
      diagnostics.push(
        `MCP resources/list failed: ${errorMessage(error, secretValues)}`
      );
    }

    diagnostics.push(
      `MCP initialize succeeded for ${commandLabel(server.command ?? "", server.args)}.`
    );
    return initializedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      diagnostics,
      initializeResult,
      tools,
      resources,
      probeSteps: recorder.steps,
      notifications,
    });
  } catch (error) {
    const message = errorMessage(error, secretValues);
    diagnostics.push(`MCP initialize failed: ${message}`);
    return failedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      error: message,
      probeSteps: recorder.steps,
      notifications,
      diagnostics,
    });
  } finally {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      pending.delete(id);
    }
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    if (!processClosed) {
      const closed = new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 750);
        child.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      if (!processExited) {
        child.kill();
      }
      await closed;
    }
  }
}

function parseMcpHttpMessage(text: string, contentType: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (contentType.includes("text/event-stream")) {
    const dataLine = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error("SSE response did not contain a data event.");
    }
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(trimmed);
}

async function mcpHttpRequest(params: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  sessionId?: string;
  secretValues?: string[];
  timeoutMs?: number;
}): Promise<{ result: unknown; sessionId?: string; notificationMessages: unknown[] }> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? MCP_PROTOCOL_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...params.headers,
        ...(params.sessionId ? { "mcp-session-id": params.sessionId } : {}),
      },
      body: JSON.stringify(params.body),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for MCP HTTP response.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const sessionId = response.headers.get("mcp-session-id") ?? params.sessionId;
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${sanitizeDiagnosticText(text, params.secretValues)}`
    );
  }
  if (!text.trim()) {
    return {
      result: undefined,
      ...(sessionId ? { sessionId } : {}),
      notificationMessages: [],
    };
  }
  const message = parseMcpHttpMessage(text, contentType);
  const messages = normalizeJsonRpcMessages(message);
  const notificationMessages = messages.filter(
    (item) =>
      isRecord(item) &&
      item.id === undefined &&
      typeof item.method === "string"
  );
  const expectedId = params.body.id;
  const responseMessage = messages.find(
    (item) =>
      isRecord(item) &&
      item.id !== undefined &&
      (expectedId === undefined || String(item.id) === String(expectedId))
  );
  if (isRecord(responseMessage) && responseMessage.error !== undefined) {
    throw new Error(parseJsonRpcError(responseMessage.error));
  }
  if (!responseMessage && expectedId !== undefined) {
    return {
      result: undefined,
      ...(sessionId ? { sessionId } : {}),
      notificationMessages,
    };
  }
  return {
    result: isRecord(responseMessage)
      ? responseMessage.result
      : isRecord(message)
        ? message.result
        : message,
    ...(sessionId ? { sessionId } : {}),
    notificationMessages,
  };
}

async function discoverHttpMcpProtocol(server: StoredMcpServer): Promise<McpDiscoveryResult> {
  const startedAt = Date.now();
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const recorder = createMcpProbeRecorder(server.transport);
  const requestTimeoutMs = mcpRequestTimeoutMs(server);
  const headerPolicy = resolveMcpRuntimeHeaders(server);
  diagnostics.push(...headerPolicy.diagnostics);
  diagnostics.push(`MCP remote request timeout: ${requestTimeoutMs}ms.`);
  const secretValues = headerPolicy.secretValues;
  if (
    headerPolicy.missingEnvKeys.length > 0 ||
    headerPolicy.blockedLiteralHeaders.length > 0
  ) {
    const message =
      headerPolicy.blockedLiteralHeaders.length > 0
        ? "MCP remote header policy blocked literal secret headers."
        : `MCP remote header policy is missing env keys: ${headerPolicy.missingEnvKeys.join(
            ", "
          )}.`;
    recorder.record("header-policy", "failed", { error: message });
    return failedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      error: message,
      probeSteps: recorder.steps,
      diagnostics,
    });
  }
  recorder.record("header-policy", "success", {
    detail: `${Object.keys(headerPolicy.headers).length} runtime headers`,
  });
  let sessionId: string | undefined;
  let nextId = 1;
  const collectNotifications = (messages: unknown[]) => {
    for (const message of messages) {
      const notification = createMcpNotification({
        server,
        source: "probe",
        message,
        secretValues,
      });
      if (notification) {
        notifications.push(notification);
        diagnostics.push(`MCP notification received: ${notification.method}.`);
      }
    }
  };
  const request = async (
    method: Extract<
      LocalAdeMcpProbeStepName,
      "initialize" | "tools/list" | "resources/list"
    >,
    params?: unknown
  ) => {
    const finishRequest = recorder.start(method);
    try {
      const result = await mcpHttpRequest({
        url: server.url ?? "",
        headers: headerPolicy.headers,
        sessionId,
        secretValues,
        body: {
          jsonrpc: "2.0",
          id: nextId++,
          method,
          ...(params === undefined ? {} : { params }),
        },
        timeoutMs: requestTimeoutMs,
      });
      sessionId = result.sessionId;
      collectNotifications(result.notificationMessages);
      finishRequest("success");
      return result.result;
    } catch (error) {
      finishRequest("failed", { error: errorMessage(error, secretValues) });
      throw error;
    }
  };

  try {
    const initializeResult = await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "eragear-code-copilot",
        version: "local-ade",
      },
    });
    const finishInitialized = recorder.start("initialized");
    await mcpHttpRequest({
      url: server.url ?? "",
      headers: headerPolicy.headers,
      sessionId,
      secretValues,
      timeoutMs: requestTimeoutMs,
      body: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
    }).then((result) => {
      collectNotifications(result.notificationMessages);
    }).catch((error) => {
      finishInitialized("failed", { error: errorMessage(error, secretValues) });
      diagnostics.push(
        `MCP initialized notification failed: ${errorMessage(error, secretValues)}`
      );
    });
    finishInitialized("success");

    let tools: LocalAdeMcpTool[] = [];
    let resources: LocalAdeMcpResource[] = [];
    try {
      tools = parseMcpTools(await request("tools/list", {}));
      diagnostics.push(`MCP tools/list returned ${tools.length} tools.`);
    } catch (error) {
      diagnostics.push(`MCP tools/list failed: ${errorMessage(error, secretValues)}`);
    }
    try {
      resources = parseMcpResources(await request("resources/list", {}));
      diagnostics.push(`MCP resources/list returned ${resources.length} resources.`);
    } catch (error) {
      diagnostics.push(
        `MCP resources/list failed: ${errorMessage(error, secretValues)}`
      );
    }
    diagnostics.push("MCP initialize succeeded over streamable HTTP.");
    return initializedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      diagnostics,
      initializeResult,
      tools,
      resources,
      probeSteps: recorder.steps,
      notifications,
    });
  } catch (error) {
    const message = errorMessage(error, secretValues);
    diagnostics.push(`MCP initialize failed: ${message}`);
    return failedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      error: message,
      probeSteps: recorder.steps,
      notifications,
      diagnostics,
    });
  }
}

function resolveMcpEndpoint(baseUrl: string, endpoint: string): string {
  return new URL(endpoint, baseUrl).toString();
}

function parseSseFrames(input: string): { frames: string[]; remainder: string } {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split(/\n\n/);
  return {
    frames: parts.slice(0, -1),
    remainder: parts.at(-1) ?? "",
  };
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const rawLine of frame.split(/\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) {
    return null;
  }
  return { event, data: data.join("\n") };
}

function normalizeJsonRpcMessages(message: unknown): unknown[] {
  return Array.isArray(message) ? message : [message];
}

async function watchSseMcpNotifications(
  server: StoredMcpServer,
  requestedDurationMs: number
): Promise<LocalAdeMcpNotificationMonitorRun> {
  const startedAtMs = Date.now();
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  let reconnectCount = 0;
  let streamOpenCount = 0;
  const requestTimeoutMs = mcpRequestTimeoutMs(server);
  const reconnectLimit = mcpReconnectAttempts(server);
  const headerPolicy = resolveMcpRuntimeHeaders(server);
  diagnostics.push(...headerPolicy.diagnostics);
  diagnostics.push(
    `MCP remote controls: timeout ${requestTimeoutMs}ms, reconnects ${reconnectLimit}, watch ${requestedDurationMs}ms.`
  );
  const secretValues = headerPolicy.secretValues;
  if (
    headerPolicy.missingEnvKeys.length > 0 ||
    headerPolicy.blockedLiteralHeaders.length > 0
  ) {
    const message =
      headerPolicy.blockedLiteralHeaders.length > 0
        ? "MCP remote header policy blocked literal secret headers."
        : `MCP remote header policy is missing env keys: ${headerPolicy.missingEnvKeys.join(", ")}.`;
    diagnostics.push(message);
    return createMcpNotificationMonitorRun({
      server,
      status: "failed",
      startedAtMs,
      requestedDurationMs,
      reconnectCount,
      streamOpenCount,
      notifications,
      diagnostics,
    });
  }
  const streamUrl = server.url ?? "";
  const endAtMs = startedAtMs + requestedDurationMs;
  let nextId = 1;
  const pending = new Map<
    string,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const rejectPending = (message: string) => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} failed: ${message}`));
      pending.delete(id);
    }
  };
  const settleJsonRpcMessage = (message: unknown) => {
    for (const item of normalizeJsonRpcMessages(message)) {
      if (!isRecord(item)) {
        continue;
      }
      if (item.id === undefined) {
        const notification = createMcpNotification({
          server,
          source: "monitor",
          message: item,
          secretValues,
        });
        if (notification) {
          notifications.push(notification);
          diagnostics.push(`MCP monitor notification received: ${notification.method}.`);
        }
        continue;
      }
      const id = String(item.id);
      const waiter = pending.get(id);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timeout);
      pending.delete(id);
      if (item.error !== undefined) {
        waiter.reject(new Error(parseJsonRpcError(item.error)));
      } else {
        waiter.resolve(item.result);
      }
    }
  };
  const openStream = async (mode: "open" | "reconnect") => {
    const controller = new AbortController();
    const headerTimeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(streamUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "text/event-stream",
          ...headerPolicy.headers,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Timed out after ${requestTimeoutMs}ms waiting for SSE stream response.`
        );
      }
      throw error;
    } finally {
      clearTimeout(headerTimeout);
    }
    if (!response.ok) {
      const text = sanitizeDiagnosticText(await response.text(), secretValues);
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    if (!response.body) {
      throw new Error("SSE response did not include a readable body.");
    }
    streamOpenCount += 1;
    diagnostics.push(
      mode === "reconnect"
        ? `MCP SSE notification monitor reconnected with HTTP ${response.status}.`
        : `MCP SSE notification monitor opened with HTTP ${response.status}.`
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let closedByClient = false;
    let endpointUrl =
      server.messageEndpoint?.trim()
        ? resolveMcpEndpoint(streamUrl, server.messageEndpoint.trim())
        : undefined;
    let resolveEndpoint: (value: string) => void = () => undefined;
    let rejectEndpoint: (error: Error) => void = () => undefined;
    const endpointPromise = new Promise<string>((resolve, reject) => {
      resolveEndpoint = resolve;
      rejectEndpoint = reject;
    });
    if (endpointUrl) {
      resolveEndpoint(endpointUrl);
    }

    const close = async () => {
      closedByClient = true;
      controller.abort();
      rejectEndpoint(new Error("MCP SSE notification monitor closed."));
      await reader.cancel().catch(() => undefined);
    };
    const closed = (async () => {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.remainder;
        for (const frame of parsed.frames) {
          const event = parseSseFrame(frame);
          if (!event) {
            continue;
          }
          if (event.event === "endpoint") {
            endpointUrl = resolveMcpEndpoint(streamUrl, event.data.trim());
            resolveEndpoint(endpointUrl);
            diagnostics.push("MCP SSE monitor endpoint event received.");
            continue;
          }
          try {
            settleJsonRpcMessage(JSON.parse(event.data));
          } catch (error) {
            diagnostics.push(`MCP SSE monitor event parse error: ${errorMessage(error, secretValues)}`);
          }
        }
      }
      const closeMessage = closedByClient
        ? "MCP SSE notification monitor closed by client."
        : "MCP SSE notification monitor stream closed.";
      if (!closedByClient) {
        rejectEndpoint(new Error(closeMessage));
        rejectPending(closeMessage);
      }
      return closeMessage;
    })().catch((error) => {
      const closeMessage = closedByClient
        ? "MCP SSE notification monitor closed by client."
        : `MCP SSE notification monitor stream error: ${errorMessage(error, secretValues)}`;
      if (!closedByClient) {
        rejectEndpoint(new Error(closeMessage));
        rejectPending(closeMessage);
      }
      return closeMessage;
    });
    const getEndpoint = async () => {
      if (endpointUrl) {
        return endpointUrl;
      }
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${requestTimeoutMs}ms waiting for SSE endpoint event.`
              )
            ),
          requestTimeoutMs
        );
      });
      try {
        return await Promise.race([endpointPromise, timeout]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };
    return { close, closed, getEndpoint };
  };
  const post = async (
    endpoint: string,
    body: Record<string, unknown>,
    expectResponse: boolean
  ) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/event-stream, */*",
          "content-type": "application/json",
          ...headerPolicy.headers,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Timed out after ${requestTimeoutMs}ms waiting for ${String(
            body.method ?? "MCP request"
          )}.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${sanitizeDiagnosticText(text, secretValues)}`
      );
    }
    if (text.trim()) {
      settleJsonRpcMessage(
        parseMcpHttpMessage(text, response.headers.get("content-type") ?? "")
      );
    }
    return expectResponse ? undefined : undefined;
  };
  const request = async (
    endpoint: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> => {
    const id = String(nextId++);
    const body = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `Timed out after ${requestTimeoutMs}ms waiting for ${method}.`
          )
        );
      }, requestTimeoutMs);
      pending.set(id, { method, resolve, reject, timeout });
      post(endpoint, body, true).catch((error) => {
        clearTimeout(timeout);
        pending.delete(id);
        reject(error);
      });
    });
  };

  let status: LocalAdeMcpNotificationMonitorRun["status"] = "success";
  let lastCloseMessage = "";
  try {
    while (Date.now() < endAtMs) {
      const mode = streamOpenCount === 0 ? "open" : "reconnect";
      const stream = await openStream(mode);
      try {
        const endpoint = await stream.getEndpoint();
        await request(endpoint, "initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "eragear-code-copilot",
            version: "local-ade",
          },
        });
        await post(
          endpoint,
          {
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          },
          false
        ).catch((error) => {
          diagnostics.push(
            `MCP monitor initialized notification failed: ${errorMessage(error, secretValues)}`
          );
        });
        diagnostics.push("MCP SSE notification monitor initialized.");
        const remainingMs = Math.max(0, endAtMs - Date.now());
        const timer = new Promise<"timer">((resolve) =>
          setTimeout(resolve, remainingMs, "timer")
        );
        const outcome = await Promise.race([stream.closed, timer]);
        if (outcome === "timer") {
          await stream.close();
          break;
        }
        lastCloseMessage = outcome;
        diagnostics.push(outcome);
        await stream.close();
      } catch (error) {
        lastCloseMessage = errorMessage(error, secretValues);
        diagnostics.push(`MCP SSE notification monitor failed: ${lastCloseMessage}`);
        await stream.close();
      }
      rejectPending(lastCloseMessage || "MCP SSE notification monitor stream closed.");
      if (Date.now() >= endAtMs) {
        break;
      }
      if (reconnectCount >= reconnectLimit) {
        status = "failed";
        break;
      }
      reconnectCount += 1;
      diagnostics.push(
        `MCP SSE notification monitor reconnecting (${reconnectCount}/${reconnectLimit}).`
      );
    }
  } catch (error) {
    status = "failed";
    diagnostics.push(
      `MCP SSE notification monitor failed: ${errorMessage(error, secretValues)}`
    );
  } finally {
    rejectPending("MCP SSE notification monitor ended.");
  }
  return createMcpNotificationMonitorRun({
    server,
    status,
    startedAtMs,
    requestedDurationMs,
    reconnectCount,
    streamOpenCount,
    notifications,
    diagnostics,
  });
}

async function discoverSseMcpProtocol(server: StoredMcpServer): Promise<McpDiscoveryResult> {
  const startedAt = Date.now();
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const recorder = createMcpProbeRecorder(server.transport);
  const requestTimeoutMs = mcpRequestTimeoutMs(server);
  const reconnectLimit = mcpReconnectAttempts(server);
  const headerPolicy = resolveMcpRuntimeHeaders(server);
  diagnostics.push(...headerPolicy.diagnostics);
  diagnostics.push(
    `MCP remote controls: timeout ${requestTimeoutMs}ms, reconnects ${reconnectLimit}.`
  );
  const secretValues = headerPolicy.secretValues;
  if (
    headerPolicy.missingEnvKeys.length > 0 ||
    headerPolicy.blockedLiteralHeaders.length > 0
  ) {
    const message =
      headerPolicy.blockedLiteralHeaders.length > 0
        ? "MCP remote header policy blocked literal secret headers."
        : `MCP remote header policy is missing env keys: ${headerPolicy.missingEnvKeys.join(
            ", "
          )}.`;
    recorder.record("header-policy", "failed", { error: message });
    return failedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      error: message,
      probeSteps: recorder.steps,
      diagnostics,
    });
  }
  recorder.record("header-policy", "success", {
    detail: `${Object.keys(headerPolicy.headers).length} runtime headers`,
  });
  const streamUrl = server.url ?? "";
  let nextId = 1;
  let streamClosedByClient = false;
  let reconnectAttempts = 0;
  let reconnecting = false;
  let endpointSettled = false;
  let endpointUrl =
    server.messageEndpoint?.trim()
      ? resolveMcpEndpoint(streamUrl, server.messageEndpoint.trim())
      : undefined;
  const operationController = new AbortController();
  const streamControllers: AbortController[] = [];
  const streamReaders: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const readLoops: Array<Promise<void>> = [];
  const pending = new Map<
    string,
    {
      method: string;
      body: Record<string, unknown>;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  let resolveEndpoint: (value: string) => void = () => undefined;
  let rejectEndpoint: (error: Error) => void = () => undefined;
  const endpointPromise = new Promise<string>((resolve, reject) => {
    resolveEndpoint = (value) => {
      if (!endpointSettled) {
        endpointSettled = true;
        resolve(value);
      }
    };
    rejectEndpoint = (error) => {
      if (!endpointSettled) {
        endpointSettled = true;
        reject(error);
      }
    };
  });

  if (endpointUrl) {
    resolveEndpoint(endpointUrl);
    recorder.record("endpoint", "success", { detail: "configured" });
    diagnostics.push("MCP SSE message endpoint configured explicitly.");
  }

  const rejectPending = (message: string) => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} failed: ${message}`));
      pending.delete(id);
    }
  };

  const settleJsonRpcMessage = (message: unknown) => {
    for (const item of normalizeJsonRpcMessages(message)) {
      if (!isRecord(item)) {
        continue;
      }
      if (item.id === undefined) {
        const notification = createMcpNotification({
          server,
          source: "probe",
          message: item,
          secretValues,
        });
        if (notification) {
          notifications.push(notification);
          diagnostics.push(`MCP notification received: ${notification.method}.`);
        }
        continue;
      }
      const id = String(item.id);
      const waiter = pending.get(id);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timeout);
      pending.delete(id);
      if (item.error !== undefined) {
        waiter.reject(new Error(parseJsonRpcError(item.error)));
        continue;
      }
      waiter.resolve(item.result);
    }
  };

  let postRequest:
    | ((body: Record<string, unknown>, expectResponse: boolean) => Promise<unknown>)
    | null = null;

  const replayPendingRequests = () => {
    if (!postRequest) {
      return;
    }
    for (const waiter of pending.values()) {
      postRequest(waiter.body, true).catch((error) => {
        clearTimeout(waiter.timeout);
        pending.delete(String(waiter.body.id));
        waiter.reject(error);
      });
    }
  };

  const handleUnexpectedStreamClose = (message: string) => {
    if (streamClosedByClient) {
      return;
    }
    if (reconnecting) {
      return;
    }
    if (reconnectAttempts < reconnectLimit) {
      reconnecting = true;
      reconnectAttempts += 1;
      diagnostics.push(
        `MCP SSE stream closed before protocol discovery completed; reconnecting (${reconnectAttempts}/${reconnectLimit}).`
      );
      void openStream("stream-reconnect")
        .then(() => {
          reconnecting = false;
          replayPendingRequests();
        })
        .catch((error) => {
          reconnecting = false;
          const reconnectMessage = errorMessage(error, secretValues);
          diagnostics.push(`MCP SSE stream reconnect failed: ${reconnectMessage}`);
          rejectPending(reconnectMessage);
          rejectEndpoint(new Error(reconnectMessage));
        });
      return;
    }
    rejectPending(message);
    rejectEndpoint(new Error(message));
  };

  const openStream = async (
    step: "stream-open" | "stream-reconnect"
  ): Promise<void> => {
    const controller = new AbortController();
    streamControllers.push(controller);
    const finishStreamOpen = recorder.start(step, streamUrl);
    const headerTimeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let streamResponse: Response;
    try {
      streamResponse = await fetch(streamUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "text/event-stream",
          ...headerPolicy.headers,
        },
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? `Timed out after ${requestTimeoutMs}ms waiting for SSE stream response.`
        : errorMessage(error, secretValues);
      finishStreamOpen("failed", { error: message });
      throw new Error(message);
    } finally {
      clearTimeout(headerTimeout);
    }
    if (!streamResponse.ok) {
      const text = sanitizeDiagnosticText(
        await streamResponse.text(),
        secretValues
      );
      finishStreamOpen("failed", {
        error: `HTTP ${streamResponse.status}: ${text}`,
      });
      throw new Error(`HTTP ${streamResponse.status}: ${text}`);
    }
    if (!streamResponse.body) {
      finishStreamOpen("failed", {
        error: "SSE response did not include a readable body.",
      });
      throw new Error("SSE response did not include a readable body.");
    }
    finishStreamOpen("success", { detail: `HTTP ${streamResponse.status}` });
    diagnostics.push(
      step === "stream-reconnect"
        ? `MCP SSE stream reconnected with HTTP ${streamResponse.status}.`
        : `MCP SSE stream opened with HTTP ${streamResponse.status}.`
    );
    const streamReader = streamResponse.body.getReader();
    streamReaders.push(streamReader);
    const decoder = new TextDecoder();
    let buffer = "";
    const readLoop = (async () => {
      while (true) {
        const chunk = await streamReader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.remainder;
        for (const frame of parsed.frames) {
          const event = parseSseFrame(frame);
          if (!event) {
            continue;
          }
          if (event.event === "endpoint") {
            try {
              endpointUrl = resolveMcpEndpoint(streamUrl, event.data.trim());
              resolveEndpoint(endpointUrl);
              recorder.record("endpoint", "success", { detail: "event" });
              diagnostics.push("MCP SSE endpoint event received.");
            } catch (error) {
              recorder.record("endpoint", "failed", {
                error: errorMessage(error, secretValues),
              });
              rejectEndpoint(
                new Error(
                  `Invalid SSE endpoint event: ${errorMessage(error, secretValues)}`
                )
              );
            }
            continue;
          }
          try {
            settleJsonRpcMessage(JSON.parse(event.data));
          } catch (error) {
            diagnostics.push(
              `MCP SSE event parse error: ${errorMessage(error, secretValues)}`
            );
          }
        }
      }
      handleUnexpectedStreamClose(
        "MCP SSE stream closed before protocol discovery completed."
      );
    })().catch((error) => {
      const message = errorMessage(error, secretValues);
      if (!streamClosedByClient) {
        diagnostics.push(`MCP SSE stream error: ${message}`);
      }
      handleUnexpectedStreamClose(message);
    });
    readLoops.push(readLoop);
  };

  try {
    await openStream("stream-open");

    const getEndpoint = async () => {
      if (endpointUrl) {
        return endpointUrl;
      }
      const finishEndpoint = recorder.start("endpoint", "event");
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => {
            finishEndpoint("failed", {
              error: `Timed out after ${requestTimeoutMs}ms waiting for SSE endpoint event.`,
            });
            reject(
              new Error(
                `Timed out after ${requestTimeoutMs}ms waiting for SSE endpoint event.`
              )
            );
          },
          requestTimeoutMs
        );
      });
      try {
        const target = await Promise.race([endpointPromise, timeout]);
        finishEndpoint("success", { detail: "event" });
        return target;
      } catch (error) {
        finishEndpoint("failed", { error: errorMessage(error, secretValues) });
        throw error;
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };

    const post = async (body: Record<string, unknown>, expectResponse: boolean) => {
      const target = await getEndpoint();
      const postController = new AbortController();
      const abortPost = () => postController.abort();
      const postTimeout = setTimeout(() => postController.abort(), requestTimeoutMs);
      operationController.signal.addEventListener("abort", abortPost, {
        once: true,
      });
      let response: Response;
      try {
        response = await fetch(target, {
          method: "POST",
          signal: postController.signal,
          headers: {
            accept: "application/json, text/event-stream, */*",
            "content-type": "application/json",
            ...headerPolicy.headers,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (postController.signal.aborted && !operationController.signal.aborted) {
          throw new Error(
            `Timed out after ${requestTimeoutMs}ms waiting for ${String(
              body.method ?? "MCP request"
            )}.`
          );
        }
        throw error;
      } finally {
        clearTimeout(postTimeout);
        operationController.signal.removeEventListener("abort", abortPost);
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${sanitizeDiagnosticText(text, secretValues)}`
        );
      }
      if (text.trim()) {
        const contentType = response.headers.get("content-type") ?? "";
        const directMessage = parseMcpHttpMessage(text, contentType);
        settleJsonRpcMessage(directMessage);
        if (!expectResponse) {
          return undefined;
        }
      }
      return undefined;
    };
    postRequest = post;

    const request = (
      method: Extract<
        LocalAdeMcpProbeStepName,
        "initialize" | "tools/list" | "resources/list"
      >,
      params?: unknown
    ): Promise<unknown> => {
      const finishRequest = recorder.start(method);
      const id = String(nextId++);
      const body = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      };
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          finishRequest("failed", {
            error: `Timed out after ${requestTimeoutMs}ms waiting for ${method}.`,
          });
          reject(
            new Error(
              `Timed out after ${requestTimeoutMs}ms waiting for ${method}.`
            )
          );
        }, requestTimeoutMs);
        pending.set(id, { method, body, resolve, reject, timeout });
        post(body, true).catch((error) => {
          clearTimeout(timeout);
          pending.delete(id);
          finishRequest("failed", { error: errorMessage(error, secretValues) });
          reject(error);
        });
      }).then(
        (value) => {
          finishRequest("success");
          return value;
        },
        (error) => {
          finishRequest("failed", { error: errorMessage(error, secretValues) });
          throw error;
        }
      );
    };

    const initializeResult = await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "eragear-code-copilot",
        version: "local-ade",
      },
    });
    const finishInitialized = recorder.start("initialized");
    await post(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      false
    ).catch((error) => {
      finishInitialized("failed", { error: errorMessage(error, secretValues) });
      diagnostics.push(
        `MCP initialized notification failed: ${errorMessage(error, secretValues)}`
      );
    });
    finishInitialized("success");

    let tools: LocalAdeMcpTool[] = [];
    let resources: LocalAdeMcpResource[] = [];
    try {
      tools = parseMcpTools(await request("tools/list", {}));
      diagnostics.push(`MCP tools/list returned ${tools.length} tools.`);
    } catch (error) {
      diagnostics.push(`MCP tools/list failed: ${errorMessage(error, secretValues)}`);
    }
    try {
      resources = parseMcpResources(await request("resources/list", {}));
      diagnostics.push(`MCP resources/list returned ${resources.length} resources.`);
    } catch (error) {
      diagnostics.push(
        `MCP resources/list failed: ${errorMessage(error, secretValues)}`
      );
    }
    diagnostics.push("MCP initialize succeeded over SSE message endpoint.");
    streamClosedByClient = true;
    operationController.abort();
    for (const controller of streamControllers) {
      controller.abort();
    }
    await Promise.all(
      streamReaders.map((streamReader) =>
        streamReader.cancel().catch(() => undefined)
      )
    );
    await Promise.all(readLoops.map((readLoop) => readLoop.catch(() => undefined)));
    return initializedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      diagnostics,
      initializeResult,
      tools,
      resources,
      probeSteps: recorder.steps,
      notifications,
    });
  } catch (error) {
    const message = errorMessage(error, secretValues);
    diagnostics.push(`MCP initialize failed: ${message}`);
    return failedMcpDiscovery({
      latencyMs: Date.now() - startedAt,
      error: message,
      probeSteps: recorder.steps,
      notifications,
      diagnostics,
    });
  } finally {
    streamClosedByClient = true;
    operationController.abort();
    for (const controller of streamControllers) {
      controller.abort();
    }
    rejectEndpoint(new Error("MCP SSE discovery ended."));
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      pending.delete(id);
    }
    await Promise.all(
      streamReaders.map((streamReader) =>
        streamReader.cancel().catch(() => undefined)
      )
    );
    await Promise.all(readLoops.map((readLoop) => readLoop.catch(() => undefined)));
  }
}

async function invokeStdioMcpMethod(params: {
  rootPath: string;
  server: StoredMcpServer;
  method: LocalAdeMcpInvocationResult["method"];
  methodParams: Record<string, unknown>;
  target: string;
}): Promise<LocalAdeMcpInvocationResult> {
  const startedAtMs = Date.now();
  const secretValues = Object.values(params.server.env ?? {});
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const resolved = await resolveExecutable(params.server.command ?? "");
  diagnostics.push(...resolved.diagnostics);
  if (!resolved.available) {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      error: resolved.diagnostics.join(" "),
      diagnostics,
    });
  }

  let nextId = 1;
  const pending = new Map<
    string,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const child = spawn(params.server.command ?? "", params.server.args ?? [], {
    cwd: params.rootPath,
    env: {
      ...process.env,
      ...(params.server.env ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  diagnostics.push(`MCP stdio invocation spawned pid ${child.pid ?? "unknown"}.`);
  let stdoutBuffer = "";
  let processExited = false;
  let processClosed = false;

  const rejectPending = (message: string) => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} failed: ${message}`));
      pending.delete(id);
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        diagnostics.push(
          `MCP stdout parse error: ${sanitizeDiagnosticText(line, secretValues)}`
        );
        continue;
      }
      if (!isRecord(message)) {
        continue;
      }
      if (message.id === undefined) {
        const notification = createMcpNotification({
          server: params.server,
          source: "invocation",
          message,
          secretValues,
        });
        if (notification) {
          notifications.push(notification);
          diagnostics.push(`MCP notification received: ${notification.method}.`);
        }
        continue;
      }
      const id = String(message.id);
      const waiter = pending.get(id);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timeout);
      pending.delete(id);
      if (message.error !== undefined) {
        waiter.reject(new Error(parseJsonRpcError(message.error)));
        continue;
      }
      waiter.resolve(message.result);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = sanitizeDiagnosticText(chunk.toString(), secretValues);
    if (text) {
      diagnostics.push(`MCP stderr: ${text}`);
    }
  });
  child.once("error", (error) => {
    const message = errorMessage(error, secretValues);
    diagnostics.push(`MCP process error: ${message}`);
    rejectPending(message);
  });
  child.once("exit", (code, signal) => {
    processExited = true;
    const suffix = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    rejectPending(`MCP process exited with ${suffix}.`);
  });
  child.once("close", () => {
    processClosed = true;
  });

  const request = (method: string, methodParams?: unknown): Promise<unknown> => {
    if (processExited || !child.stdin.writable) {
      return Promise.reject(new Error("MCP process stdin is not writable."));
    }
    const id = String(nextId++);
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...(methodParams === undefined ? {} : { params: methodParams }),
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for ${method}.`
          )
        );
      }, MCP_PROTOCOL_TIMEOUT_MS);
      pending.set(id, {
        method,
        resolve,
        reject,
        timeout,
      });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  };

  try {
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "eragear-code-copilot",
        version: "local-ade",
      },
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      })}\n`
    );
    const result = await request(params.method, params.methodParams);
    diagnostics.push(`MCP ${params.method} succeeded for ${params.target}.`);
    return mcpInvocationSuccess({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      result,
      secretValues,
      notifications,
      diagnostics,
    });
  } catch (error) {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      error: errorMessage(error, secretValues),
      notifications,
      diagnostics,
    });
  } finally {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      pending.delete(id);
    }
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    if (!processClosed) {
      const closed = new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 750);
        child.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      if (!processExited) {
        child.kill();
      }
      await closed;
    }
  }
}

async function invokeHttpMcpMethod(params: {
  server: StoredMcpServer;
  method: LocalAdeMcpInvocationResult["method"];
  methodParams: Record<string, unknown>;
  target: string;
}): Promise<LocalAdeMcpInvocationResult> {
  const startedAtMs = Date.now();
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const requestTimeoutMs = mcpRequestTimeoutMs(params.server);
  const headerPolicy = resolveMcpRuntimeHeaders(params.server);
  diagnostics.push(...headerPolicy.diagnostics);
  diagnostics.push(`MCP remote request timeout: ${requestTimeoutMs}ms.`);
  const secretValues = headerPolicy.secretValues;
  if (
    headerPolicy.missingEnvKeys.length > 0 ||
    headerPolicy.blockedLiteralHeaders.length > 0
  ) {
    const message =
      headerPolicy.blockedLiteralHeaders.length > 0
        ? "MCP remote header policy blocked literal secret headers."
        : `MCP remote header policy is missing env keys: ${headerPolicy.missingEnvKeys.join(
            ", "
          )}.`;
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      error: message,
      diagnostics,
    });
  }

  let sessionId: string | undefined;
  let nextId = 1;
  const collectNotifications = (messages: unknown[]) => {
    for (const message of messages) {
      const notification = createMcpNotification({
        server: params.server,
        source: "invocation",
        message,
        secretValues,
      });
      if (notification) {
        notifications.push(notification);
        diagnostics.push(`MCP notification received: ${notification.method}.`);
      }
    }
  };
  const request = async (method: string, methodParams?: unknown) => {
    const response = await mcpHttpRequest({
      url: params.server.url ?? "",
      headers: headerPolicy.headers,
      sessionId,
      secretValues,
      timeoutMs: requestTimeoutMs,
      body: {
        jsonrpc: "2.0",
        id: nextId++,
        method,
        ...(methodParams === undefined ? {} : { params: methodParams }),
      },
    });
    sessionId = response.sessionId;
    collectNotifications(response.notificationMessages);
    return response.result;
  };

  try {
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "eragear-code-copilot",
        version: "local-ade",
      },
    });
    await mcpHttpRequest({
      url: params.server.url ?? "",
      headers: headerPolicy.headers,
      sessionId,
      secretValues,
      timeoutMs: requestTimeoutMs,
      body: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
    }).then((response) => {
      collectNotifications(response.notificationMessages);
    }).catch((error) => {
      diagnostics.push(
        `MCP initialized notification failed: ${errorMessage(error, secretValues)}`
      );
    });
    const result = await request(params.method, params.methodParams);
    diagnostics.push(`MCP ${params.method} succeeded for ${params.target}.`);
    return mcpInvocationSuccess({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      result,
      secretValues,
      notifications,
      diagnostics,
    });
  } catch (error) {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      error: errorMessage(error, secretValues),
      notifications,
      diagnostics,
    });
  }
}

async function invokeSseMcpMethod(params: {
  server: StoredMcpServer;
  method: LocalAdeMcpInvocationResult["method"];
  methodParams: Record<string, unknown>;
  target: string;
}): Promise<LocalAdeMcpInvocationResult> {
  const startedAtMs = Date.now();
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const requestTimeoutMs = mcpRequestTimeoutMs(params.server);
  const reconnectLimit = mcpReconnectAttempts(params.server);
  const headerPolicy = resolveMcpRuntimeHeaders(params.server);
  diagnostics.push(...headerPolicy.diagnostics);
  diagnostics.push(
    `MCP remote controls: timeout ${requestTimeoutMs}ms, reconnects ${reconnectLimit}.`
  );
  const secretValues = headerPolicy.secretValues;
  if (
    headerPolicy.missingEnvKeys.length > 0 ||
    headerPolicy.blockedLiteralHeaders.length > 0
  ) {
    const message =
      headerPolicy.blockedLiteralHeaders.length > 0
        ? "MCP remote header policy blocked literal secret headers."
        : `MCP remote header policy is missing env keys: ${headerPolicy.missingEnvKeys.join(
            ", "
          )}.`;
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      error: message,
      diagnostics,
    });
  }

  const streamUrl = params.server.url ?? "";
  let nextId = 1;
  let streamClosedByClient = false;
  let reconnectAttempts = 0;
  let reconnecting = false;
  let endpointSettled = false;
  let endpointUrl =
    params.server.messageEndpoint?.trim()
      ? resolveMcpEndpoint(streamUrl, params.server.messageEndpoint.trim())
      : undefined;
  const operationController = new AbortController();
  const streamControllers: AbortController[] = [];
  const streamReaders: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const readLoops: Array<Promise<void>> = [];
  let reconnectPromise: Promise<void> | null = null;
  const pending = new Map<
    string,
    {
      method: string;
      body: Record<string, unknown>;
      replayPolicy: "safe" | "side-effecting";
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  let resolveEndpoint: (value: string) => void = () => undefined;
  let rejectEndpoint: (error: Error) => void = () => undefined;
  const endpointPromise = new Promise<string>((resolve, reject) => {
    resolveEndpoint = (value) => {
      if (!endpointSettled) {
        endpointSettled = true;
        resolve(value);
      }
    };
    rejectEndpoint = (error) => {
      if (!endpointSettled) {
        endpointSettled = true;
        reject(error);
      }
    };
  });
  if (endpointUrl) {
    resolveEndpoint(endpointUrl);
    diagnostics.push("MCP SSE message endpoint configured explicitly.");
  }

  const rejectPending = (message: string) => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} failed: ${message}`));
      pending.delete(id);
    }
  };

  let postRequest:
    | ((body: Record<string, unknown>, expectResponse: boolean) => Promise<unknown>)
    | null = null;

  const replayPendingRequests = () => {
    if (!postRequest) {
      return;
    }
    for (const [id, waiter] of pending) {
      if (waiter.replayPolicy !== "safe") {
        continue;
      }
      postRequest(waiter.body, true).catch((error) => {
        clearTimeout(waiter.timeout);
        pending.delete(id);
        waiter.reject(error);
      });
    }
  };

  const handleUnexpectedStreamClose = (message: string) => {
    if (streamClosedByClient || reconnecting) {
      return;
    }
    const sideEffectingRequest = Array.from(pending.values()).find(
      (waiter) => waiter.replayPolicy === "side-effecting"
    );
    if (sideEffectingRequest) {
      const policyMessage = `MCP SSE stream closed after side-effecting ${sideEffectingRequest.method} was sent; not replaying automatically.`;
      diagnostics.push(policyMessage);
      rejectPending(policyMessage);
      rejectEndpoint(new Error(policyMessage));
      return;
    }
    if (reconnectAttempts < reconnectLimit) {
      reconnecting = true;
      reconnectAttempts += 1;
      diagnostics.push(
        `MCP SSE invocation stream closed before completion; reconnecting (${reconnectAttempts}/${reconnectLimit}).`
      );
      reconnectPromise = openStream("reconnect")
        .then(() => {
          replayPendingRequests();
        })
        .catch((error) => {
          const reconnectMessage = errorMessage(error, secretValues);
          diagnostics.push(
            `MCP SSE invocation stream reconnect failed: ${reconnectMessage}`
          );
          rejectPending(reconnectMessage);
          rejectEndpoint(new Error(reconnectMessage));
        })
        .finally(() => {
          reconnecting = false;
          reconnectPromise = null;
        });
      void reconnectPromise;
      return;
    }
    rejectPending(message);
    rejectEndpoint(new Error(message));
  };

  const settleJsonRpcMessage = (message: unknown) => {
    for (const item of normalizeJsonRpcMessages(message)) {
      if (!isRecord(item)) {
        continue;
      }
      if (item.id === undefined) {
        const notification = createMcpNotification({
          server: params.server,
          source: "invocation",
          message: item,
          secretValues,
        });
        if (notification) {
          notifications.push(notification);
          diagnostics.push(`MCP notification received: ${notification.method}.`);
        }
        continue;
      }
      const id = String(item.id);
      const waiter = pending.get(id);
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timeout);
      pending.delete(id);
      if (item.error !== undefined) {
        waiter.reject(new Error(parseJsonRpcError(item.error)));
        continue;
      }
      waiter.resolve(item.result);
    }
  };

  const openStream = async (mode: "open" | "reconnect"): Promise<void> => {
    const controller = new AbortController();
    streamControllers.push(controller);
    const headerTimeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let streamResponse: Response;
    try {
      streamResponse = await fetch(streamUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "text/event-stream",
          ...headerPolicy.headers,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Timed out after ${requestTimeoutMs}ms waiting for SSE stream response.`
        );
      }
      throw error;
    } finally {
      clearTimeout(headerTimeout);
    }
    if (!streamResponse.ok) {
      const text = sanitizeDiagnosticText(
        await streamResponse.text(),
        secretValues
      );
      throw new Error(`HTTP ${streamResponse.status}: ${text}`);
    }
    if (!streamResponse.body) {
      throw new Error("SSE response did not include a readable body.");
    }
    diagnostics.push(
      mode === "reconnect"
        ? `MCP SSE invocation stream reconnected with HTTP ${streamResponse.status}.`
        : `MCP SSE stream opened with HTTP ${streamResponse.status}.`
    );
    const streamReader = streamResponse.body.getReader();
    streamReaders.push(streamReader);
    const decoder = new TextDecoder();
    let buffer = "";
    const readLoop = (async () => {
      while (true) {
        const chunk = await streamReader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.remainder;
        for (const frame of parsed.frames) {
          const event = parseSseFrame(frame);
          if (!event) {
            continue;
          }
          if (event.event === "endpoint") {
            try {
              endpointUrl = resolveMcpEndpoint(streamUrl, event.data.trim());
              resolveEndpoint(endpointUrl);
              diagnostics.push("MCP SSE endpoint event received.");
            } catch (error) {
              rejectEndpoint(
                new Error(`Invalid SSE endpoint event: ${errorMessage(error, secretValues)}`)
              );
            }
            continue;
          }
          try {
            settleJsonRpcMessage(JSON.parse(event.data));
          } catch (error) {
            diagnostics.push(
              `MCP SSE event parse error: ${errorMessage(error, secretValues)}`
            );
          }
        }
      }
      handleUnexpectedStreamClose(
        "MCP SSE stream closed before invocation completed."
      );
    })().catch((error) => {
      const message = errorMessage(error, secretValues);
      if (!streamClosedByClient) {
        diagnostics.push(`MCP SSE stream error: ${message}`);
      }
      handleUnexpectedStreamClose(message);
    });
    readLoops.push(readLoop);
  };

  try {
    await openStream("open");

    const getEndpoint = async () => {
      if (endpointUrl) {
        return endpointUrl;
      }
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${requestTimeoutMs}ms waiting for SSE endpoint event.`
              )
            ),
          requestTimeoutMs
        );
      });
      try {
        return await Promise.race([endpointPromise, timeout]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };

    const post = async (body: Record<string, unknown>, expectResponse: boolean) => {
      const target = await getEndpoint();
      const postController = new AbortController();
      const abortPost = () => postController.abort();
      const postTimeout = setTimeout(() => postController.abort(), requestTimeoutMs);
      operationController.signal.addEventListener("abort", abortPost, {
        once: true,
      });
      let response: Response;
      try {
        response = await fetch(target, {
          method: "POST",
          signal: postController.signal,
          headers: {
            accept: "application/json, text/event-stream, */*",
            "content-type": "application/json",
            ...headerPolicy.headers,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (postController.signal.aborted && !operationController.signal.aborted) {
          throw new Error(
            `Timed out after ${requestTimeoutMs}ms waiting for ${String(
              body.method ?? "MCP request"
            )}.`
          );
        }
        throw error;
      } finally {
        clearTimeout(postTimeout);
        operationController.signal.removeEventListener("abort", abortPost);
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${sanitizeDiagnosticText(text, secretValues)}`
        );
      }
      if (text.trim()) {
        const contentType = response.headers.get("content-type") ?? "";
        settleJsonRpcMessage(parseMcpHttpMessage(text, contentType));
        if (!expectResponse) {
          return undefined;
        }
      }
      return undefined;
    };
    postRequest = post;

    const waitForReconnect = async () => {
      const currentReconnect = reconnectPromise;
      if (currentReconnect) {
        await currentReconnect;
      }
    };

    const request = async (
      method: string,
      methodParams?: unknown,
      replayPolicy: "safe" | "side-effecting" = "safe"
    ): Promise<unknown> => {
      await waitForReconnect();
      const id = String(nextId++);
      const body = {
        jsonrpc: "2.0",
        id,
        method,
        ...(methodParams === undefined ? {} : { params: methodParams }),
      };
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              `Timed out after ${requestTimeoutMs}ms waiting for ${method}.`
            )
          );
        }, requestTimeoutMs);
        pending.set(id, { method, body, replayPolicy, resolve, reject, timeout });
        post(body, true).catch((error) => {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        });
      });
    };

    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "eragear-code-copilot",
        version: "local-ade",
      },
    });
    await post(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      false
    ).catch((error) => {
      diagnostics.push(
        `MCP initialized notification failed: ${errorMessage(error, secretValues)}`
      );
    });
    const result = await request(
      params.method,
      params.methodParams,
      params.method === "tools/call" ? "side-effecting" : "safe"
    );
    diagnostics.push(`MCP ${params.method} succeeded for ${params.target}.`);
    streamClosedByClient = true;
    operationController.abort();
    for (const controller of streamControllers) {
      controller.abort();
    }
    await Promise.all(
      streamReaders.map((streamReader) =>
        streamReader.cancel().catch(() => undefined)
      )
    );
    await Promise.all(readLoops.map((readLoop) => readLoop.catch(() => undefined)));
    return mcpInvocationSuccess({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      result,
      secretValues,
      notifications,
      diagnostics,
    });
  } catch (error) {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs,
      error: errorMessage(error, secretValues),
      notifications,
      diagnostics,
    });
  } finally {
    streamClosedByClient = true;
    operationController.abort();
    for (const controller of streamControllers) {
      controller.abort();
    }
    rejectEndpoint(new Error("MCP SSE invocation ended."));
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timeout);
      pending.delete(id);
    }
    await Promise.all(
      streamReaders.map((streamReader) =>
        streamReader.cancel().catch(() => undefined)
      )
    );
    await Promise.all(readLoops.map((readLoop) => readLoop.catch(() => undefined)));
  }
}

async function invokeMcpMethod(params: {
  rootPath: string;
  server: StoredMcpServer;
  method: LocalAdeMcpInvocationResult["method"];
  methodParams: Record<string, unknown>;
  target: string;
}): Promise<LocalAdeMcpInvocationResult> {
  if (!params.server.enabled) {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs: Date.now(),
      error: "MCP server is disabled.",
    });
  }
  const fingerprint = mcpInvocationFingerprint(params.server);
  const trustStatus = mcpTrustStatus(params.server, fingerprint);
  if (trustStatus !== "trusted") {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs: Date.now(),
      error:
        trustStatus === "changed"
          ? `MCP server configuration changed after trust approval. Review and trust fingerprint ${fingerprint} before invoking tools or resources.`
          : `MCP server must be trusted before invoking tools or resources. Review and trust fingerprint ${fingerprint}.`,
      diagnostics: [
        "MCP invocation blocked by trust policy before protocol execution.",
      ],
    });
  }
  if (params.server.transport === "stdio") {
    if (!params.server.command) {
      return mcpInvocationFailure({
        server: params.server,
        method: params.method,
        target: params.target,
        startedAtMs: Date.now(),
        error: "MCP stdio server is missing command.",
      });
    }
    return await invokeStdioMcpMethod(params);
  }
  if (!params.server.url) {
    return mcpInvocationFailure({
      server: params.server,
      method: params.method,
      target: params.target,
      startedAtMs: Date.now(),
      error: "MCP remote server is missing URL.",
    });
  }
  if (params.server.transport === "streamable-http") {
    return await invokeHttpMcpMethod(params);
  }
  return await invokeSseMcpMethod(params);
}

function recordMcpInvocation(
  document: McpDocument,
  serverId: string,
  result: LocalAdeMcpInvocationResult
): void {
  const server = document.servers.find((item) => item.id === serverId);
  if (!server) {
    return;
  }
  const invocationNotifications = result.notifications;
  const storedResult: LocalAdeMcpInvocationResult = {
    ...result,
    notifications: [],
  };
  server.invocationHistory = [
    storedResult,
    ...(server.invocationHistory ?? []),
  ].slice(0, MAX_MCP_INVOCATION_HISTORY);
  recordMcpNotifications(document, serverId, invocationNotifications);
  server.updatedAt = new Date().toISOString();
}

function recordMcpNotifications(
  document: McpDocument,
  serverId: string,
  notifications: LocalAdeMcpNotification[]
): void {
  if (notifications.length === 0) {
    return;
  }
  const server = document.servers.find((item) => item.id === serverId);
  if (!server) {
    return;
  }
  server.notificationHistory = [
    ...notifications,
    ...(server.notificationHistory ?? []),
  ].slice(0, MAX_MCP_NOTIFICATION_HISTORY);
  server.updatedAt = new Date().toISOString();
}

function recordMcpNotificationMonitor(
  document: McpDocument,
  serverId: string,
  run: LocalAdeMcpNotificationMonitorRun
): void {
  const server = document.servers.find((item) => item.id === serverId);
  if (!server) {
    return;
  }
  server.notificationMonitorHistory = [
    run,
    ...(server.notificationMonitorHistory ?? []),
  ].slice(0, MAX_MCP_NOTIFICATION_MONITOR_HISTORY);
  recordMcpNotifications(document, serverId, run.notifications);
  server.updatedAt = new Date().toISOString();
}

async function toVisibleMcpServer(
  rootPath: string,
  server: StoredMcpServer
): Promise<LocalAdeMcpServer> {
  const invalid =
    server.transport === "stdio"
      ? !server.command
      : !server.url;
  const fingerprint = mcpInvocationFingerprint(server);
  const trustStatus = mcpTrustStatus(server, fingerprint);
  const trustDiagnostics = [
    `MCP invocation fingerprint: ${fingerprint}.`,
    trustStatus === "trusted"
      ? "MCP invocation trust is approved for the current server fingerprint."
      : trustStatus === "changed"
        ? "MCP server configuration changed after trust approval; review and trust the current fingerprint before invoking tools or resources."
        : "MCP server invocation is untrusted; review and trust this fingerprint before invoking tools or resources.",
  ];
  const base = {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    ...(server.command ? { command: server.command } : {}),
      ...(server.args ? { args: server.args } : {}),
      ...(server.url ? { url: server.url } : {}),
      ...(server.messageEndpoint ? { messageEndpoint: server.messageEndpoint } : {}),
      envKeys: Object.keys(server.env ?? {}),
      headerKeys: Object.keys(server.headers ?? {}),
      headerEnv: visibleMcpHeaderEnv(server.headerEnv),
      probeHistory: server.probeHistory ?? [],
      fingerprint,
      trustStatus,
      ...(server.trustedFingerprint
        ? { trustedFingerprint: server.trustedFingerprint }
        : {}),
      ...(server.trustedAt ? { trustedAt: server.trustedAt } : {}),
      invocationHistory: server.invocationHistory ?? [],
      notificationHistory: server.notificationHistory ?? [],
      notificationMonitorHistory: server.notificationMonitorHistory ?? [],
      remoteControls: visibleMcpRemoteControls(server),
      updatedAt: server.updatedAt,
  };
  const emptyProtocol = {
    status: "not-run" as const,
    toolsDiscovered: 0,
    resourcesDiscovered: 0,
  };
  const skippedProbe = createMcpProbeSummary("skipped", []);

  if (!server.enabled) {
    return {
      ...base,
      health: "disabled",
      protocol: emptyProtocol,
      tools: [],
      resources: [],
      probe: skippedProbe,
      diagnostics: [...trustDiagnostics, "MCP entry is disabled."],
    };
  }

  if (invalid) {
    return {
      ...base,
      health: "invalid-config",
      protocol: emptyProtocol,
      tools: [],
      resources: [],
      probe: skippedProbe,
      diagnostics: [
        ...trustDiagnostics,
        "MCP entry is missing the command or URL required by its transport.",
      ],
    };
  }

  const probedAt = new Date().toISOString();
  if (server.transport === "stdio") {
    const discovery = await discoverStdioMcpProtocol(rootPath, server);
    return {
      ...base,
      health: discovery.available ? "available" : "unavailable",
      lastProbedAt: probedAt,
      latencyMs: discovery.latencyMs,
      protocol: discovery.protocol,
      tools: discovery.tools,
      resources: discovery.resources,
      notificationHistory: [
        ...discovery.notifications,
        ...base.notificationHistory,
      ].slice(0, MAX_MCP_NOTIFICATION_HISTORY),
      probe: createMcpProbeSummary(
        discovery.available ? "success" : "failed",
        discovery.probeSteps
      ),
      diagnostics: [...trustDiagnostics, ...discovery.diagnostics],
    };
  }

  if (server.transport === "streamable-http") {
    const discovery = await discoverHttpMcpProtocol(server);
    return {
      ...base,
      health: discovery.available ? "available" : "unavailable",
      lastProbedAt: probedAt,
      latencyMs: discovery.latencyMs,
      protocol: discovery.protocol,
      tools: discovery.tools,
      resources: discovery.resources,
      notificationHistory: [
        ...discovery.notifications,
        ...base.notificationHistory,
      ].slice(0, MAX_MCP_NOTIFICATION_HISTORY),
      probe: createMcpProbeSummary(
        discovery.available ? "success" : "failed",
        discovery.probeSteps
      ),
      diagnostics: [...trustDiagnostics, ...discovery.diagnostics],
    };
  }

  const discovery = await discoverSseMcpProtocol(server);
  return {
    ...base,
    health: discovery.available ? "available" : "unavailable",
    lastProbedAt: probedAt,
    latencyMs: discovery.latencyMs,
    protocol: discovery.protocol,
    tools: discovery.tools,
    resources: discovery.resources,
    notificationHistory: [
      ...discovery.notifications,
      ...base.notificationHistory,
    ].slice(0, MAX_MCP_NOTIFICATION_HISTORY),
    probe: createMcpProbeSummary(
      discovery.available ? "success" : "failed",
      discovery.probeSteps
    ),
    diagnostics: [...trustDiagnostics, ...discovery.diagnostics],
  };
}

function createMcpAgentRoute(
  server: StoredMcpServer,
  visibleServer?: LocalAdeMcpServer,
  agentInvocations: LocalAdeMcpAgentInvocation[] = []
): LocalAdeMcpAgentRoute {
  const fingerprint = mcpInvocationFingerprint(server);
  const trustStatus = mcpTrustStatus(server, fingerprint);
  const headerEnv = visibleMcpHeaderEnv(server.headerEnv);
  const missingHeaderEnv = headerEnv
    .filter((item) => !item.present)
    .map((item) => item.envKey);
  const blockedLiteralHeaders = unsafeLiteralMcpHeaderNames(server.headers);
  const missingTarget =
    server.transport === "stdio"
      ? !server.command?.trim()
      : !server.url?.trim();
  const target =
    server.transport === "stdio"
      ? server.command?.trim() || "missing command"
      : server.url?.trim() || "missing URL";
  const diagnostics: string[] = [
    `Route fingerprint ${fingerprint}.`,
    "Secret values are resolved inside the broker and are not exposed in this preview.",
  ];
  const routeAgentInvocations = agentInvocations.filter(
    (item) => item.serverId === server.id
  );

  let status: LocalAdeMcpAgentRoute["status"] = "injectable";
  let reason = "Ready for ACP session MCP broker injection.";

  if (!server.enabled) {
    status = "skipped";
    reason = "Server is disabled.";
  } else if (missingTarget) {
    status = "blocked";
    reason =
      server.transport === "stdio"
        ? "Missing stdio command."
        : "Missing remote MCP URL.";
  } else if (trustStatus !== "trusted") {
    status = "blocked";
    reason =
      trustStatus === "changed"
        ? "Server configuration changed after trust approval."
        : "Server must be trusted before agent session injection.";
  } else if (blockedLiteralHeaders.length > 0) {
    status = "blocked";
    reason = `Literal secret-looking headers are blocked: ${blockedLiteralHeaders.join(", ")}.`;
  } else if (missingHeaderEnv.length > 0) {
    status = "blocked";
    reason = `Missing header env keys: ${missingHeaderEnv.join(", ")}.`;
  }

  if (status === "blocked") {
    diagnostics.push(reason);
  }
  if (status === "injectable") {
    diagnostics.push(
      "Agent receives an Eragear stdio MCP broker that re-checks trust before forwarding tool/resource calls."
    );
    if (server.transport !== "stdio") {
      diagnostics.push(
        "Remote MCP headers are resolved inside the broker and are not exposed in ACP session setup."
      );
    }
  }
  if (routeAgentInvocations.length > 0) {
    diagnostics.push(
      `Broker audit has ${routeAgentInvocations.length} recent agent MCP call(s) for this route.`
    );
  }

  return {
    serverId: server.id,
    serverName: server.name,
    transport: server.transport,
    enabled: server.enabled,
    trustStatus,
    protocolStatus: visibleServer?.protocol.status ?? "not-run",
    status,
    reason,
    target,
    brokerMode: status === "injectable" ? "stdio-proxy" : "none",
    agentSupport: "not-required",
    headerEnv,
    agentInvocationCount: routeAgentInvocations.length,
    ...(routeAgentInvocations[0]
      ? { lastAgentInvocation: routeAgentInvocations[0] }
      : {}),
    diagnostics,
  };
}

function createMcpAgentRouting(
  servers: StoredMcpServer[],
  visibleServers: LocalAdeMcpServer[],
  agentInvocations: LocalAdeMcpAgentInvocation[]
): LocalAdeMcpAgentRouting {
  const visibleById = new Map(visibleServers.map((server) => [server.id, server]));
  const routes = servers.map((server) =>
    createMcpAgentRoute(
      server,
      visibleById.get(server.id),
      agentInvocations
    )
  );
  const injectableCount = routes.filter(
    (route) => route.status === "injectable"
  ).length;
  const conditionalCount = routes.filter(
    (route) => route.status === "conditional"
  ).length;
  const blockedCount = routes.filter((route) => route.status === "blocked").length;
  const skippedCount = routes.filter((route) => route.status === "skipped").length;
  const diagnostics: string[] = [];
  if (routes.length === 0) {
    diagnostics.push("No project-local MCP servers are configured for agent routing.");
  }
  if (conditionalCount > 0) {
    diagnostics.push(
      "Some MCP routes are conditional and require additional session policy before injection."
    );
  }
  if (blockedCount > 0) {
    diagnostics.push(
      `${blockedCount} MCP route(s) are blocked before ACP session injection.`
    );
  }
  if (agentInvocations.length > 0) {
    diagnostics.push(
      `${agentInvocations.length} recent agent-side MCP broker call(s) are visible in routing audit.`
    );
  }

  return {
    status:
      routes.length === 0
        ? "empty"
        : blockedCount > 0
          ? "attention"
          : "ready",
    injectableCount,
    conditionalCount,
    blockedCount,
    skippedCount,
    routes,
    agentInvocationHistory: agentInvocations,
    diagnostics,
  };
}

function createMcpProbeRun(server: LocalAdeMcpServer): LocalAdeMcpProbeRun {
  const firstStep = server.probe.steps[0];
  const lastStep = server.probe.steps.at(-1);
  const startedAt = firstStep?.startedAt ?? server.lastProbedAt ?? new Date().toISOString();
  const finishedAt = lastStep?.completedAt ?? new Date().toISOString();
  return {
    id: `mcp-probe-${randomUUID()}`,
    serverId: server.id,
    serverName: server.name,
    transport: server.transport,
    status: server.probe.status,
    health: server.health,
    protocolStatus: server.protocol.status,
    startedAt,
    finishedAt,
    durationMs:
      server.latencyMs ??
      Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    stepCount: server.probe.stepCount,
    failedStepCount: server.probe.failedStepCount,
    toolsDiscovered: server.protocol.toolsDiscovered,
    resourcesDiscovered: server.protocol.resourcesDiscovered,
    steps: server.probe.steps,
    diagnostics: server.diagnostics.slice(0, 12),
  };
}

function createMcpCapabilities(
  rootPath: string,
  servers: LocalAdeMcpServer[]
): CapabilityDescriptor[] {
  return servers.map((server) => ({
    id: `mcp.project.${server.id}`,
    kind: "mcp-server",
    name: server.name,
    description:
      server.transport === "stdio"
        ? `stdio: ${server.command ?? "missing command"}`
        : `${server.transport}: ${server.url ?? "missing URL"}`,
    scope: "project",
    enabled: server.enabled && server.trustStatus === "trusted",
    sourcePath: path.join(ensureProjectDataDir(rootPath), MCP_FILE),
    storage: "filesystem-discovery",
    diagnostics: server.diagnostics,
    tags: [
      "mcp",
      server.transport,
      server.trustStatus === "trusted" ? "trusted" : "requires-trust",
    ],
  }));
}

async function readProviderHealthDocument(rootPath: string): Promise<ProviderHealthDocument> {
  const parsed = await readJsonObject(
    path.join(ensureProjectDataDir(rootPath), PROVIDER_HEALTH_FILE)
  );
  if (!parsed || !isRecord(parsed.providers)) {
    return { version: 1, providers: {} };
  }
  const providers: ProviderHealthDocument["providers"] = {};
  for (const [id, value] of Object.entries(parsed.providers)) {
    if (!isRecord(value)) {
      continue;
    }
    const legacyStatus =
      value.status === "available"
        ? "ready"
        : value.status === "unavailable"
          ? "unavailable"
          : undefined;
    const status =
      value.status === "configured" ||
      value.status === "missing-config" ||
      value.status === "not-probed" ||
      value.status === "cli-ok" ||
      value.status === "auth-unknown" ||
      value.status === "model-unknown" ||
      value.status === "ready" ||
      value.status === "unavailable"
        ? value.status
        : legacyStatus;
    if (!status || typeof value.checkedAt !== "string") {
      continue;
    }
    const cliStatus =
      value.cliStatus === "missing" ||
      value.cliStatus === "ok" ||
      value.cliStatus === "failed" ||
      value.cliStatus === "unknown"
        ? value.cliStatus
        : status === "unavailable"
          ? "failed"
          : "ok";
    const authStatus =
      value.authStatus === "ok" ||
      value.authStatus === "unknown" ||
      value.authStatus === "failed" ||
      value.authStatus === "unsupported"
        ? value.authStatus
        : "unknown";
    const modelStatus =
      value.modelStatus === "ok" ||
      value.modelStatus === "unknown" ||
      value.modelStatus === "failed" ||
      value.modelStatus === "unsupported"
        ? value.modelStatus
        : "unknown";
    const readiness =
      value.readiness === "missing-config" ||
      value.readiness === "cli-ok" ||
      value.readiness === "auth-unknown" ||
      value.readiness === "model-unknown" ||
      value.readiness === "ready" ||
      value.readiness === "unavailable"
        ? value.readiness
        : status === "ready"
          ? "ready"
          : status === "unavailable"
            ? "unavailable"
            : "cli-ok";
    providers[id] = {
      status,
      cliStatus,
      authStatus,
      modelStatus,
      readiness,
      checkedAt: value.checkedAt,
      diagnostics: Array.isArray(value.diagnostics)
        ? value.diagnostics.filter((item): item is string => typeof item === "string")
        : [],
      remediation: Array.isArray(value.remediation)
        ? value.remediation.filter((item): item is string => typeof item === "string")
        : [],
      ...(typeof value.version === "string" ? { version: value.version } : {}),
      ...(Array.isArray(value.modelList)
        ? { modelList: value.modelList.filter((item): item is string => typeof item === "string") }
        : {}),
      ...(typeof value.latencyMs === "number" ? { latencyMs: value.latencyMs } : {}),
    };
  }
  return { version: 1, providers };
}

async function writeProviderHealthDocument(
  rootPath: string,
  document: ProviderHealthDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, PROVIDER_HEALTH_FILE),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8"
  );
}

interface ProviderProbePlan {
  auth: string[][];
  models: string[][];
  doctor?: {
    args: string[];
    timeoutMs?: number;
  };
}

interface ProviderCommandProbe {
  ok: boolean;
  output: string;
  rawOutput: string;
  diagnostics: string[];
}

interface ProviderReadinessProbe {
  cliStatus: LocalAdeProviderDescriptor["cliStatus"];
  authStatus: LocalAdeProviderDescriptor["authStatus"];
  modelStatus: LocalAdeProviderDescriptor["modelStatus"];
  readiness: LocalAdeProviderDescriptor["readiness"];
  version?: string;
  modelList: string[];
  diagnostics: string[];
  remediation: string[];
}

const PROVIDER_PROBE_PLANS: Record<
  "claude" | "codex" | "gemini" | "opencode",
  ProviderProbePlan
> = {
  opencode: {
    auth: [["auth", "list"], ["auth", "status"]],
    models: [["models"], ["models", "list"]],
  },
  codex: {
    doctor: { args: ["doctor", "--json"], timeoutMs: 20_000 },
    auth: [["auth", "status"], ["login", "status"]],
    models: [["models"], ["models", "list"]],
  },
  claude: {
    doctor: { args: ["doctor", "--json"], timeoutMs: 20_000 },
    auth: [
      ["auth", "status"],
      ["auth", "whoami"],
      ["doctor"],
    ],
    models: [["models"], ["models", "list"], ["model", "list"]],
  },
  gemini: {
    doctor: { args: ["doctor", "--json"], timeoutMs: 20_000 },
    auth: [
      ["auth", "status"],
      ["auth", "list"],
      ["login", "status"],
    ],
    models: [["models"], ["models", "list"], ["model", "list"]],
  },
};

function providerProbePrefixArgs(agent: Awaited<ReturnType<AgentRepositoryPort["findAll"]>>[number]): string[] {
  const args = agent.args ?? [];
  if (args.length === 0) {
    return [];
  }
  const firstArg = args[0]?.toLowerCase() ?? "";
  if (/\.(mjs|cjs|js|ts)$/.test(firstArg)) {
    return args;
  }
  if (agent.type === "other") {
    return args;
  }
  return [];
}

async function runProviderCommandProbe(params: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  secretValues: string[];
  timeoutMs?: number;
}): Promise<ProviderCommandProbe> {
  try {
    const result = await execFileAsync(params.command, params.args, {
      timeout: params.timeoutMs ?? PROBE_TIMEOUT_MS,
      windowsHide: true,
      env: params.env,
      maxBuffer: 512 * 1024,
    });
    const rawOutput = `${result.stdout}\n${result.stderr}`;
    const output = sanitizeDiagnosticText(rawOutput, params.secretValues);
    return {
      ok: true,
      output,
      rawOutput,
      diagnostics: [
        `Executed ${commandLabel(params.command, params.args)} without shell expansion.`,
      ],
    };
  } catch (error) {
    const rawOutput = isRecord(error)
      ? [
          typeof error.message === "string" ? error.message : "",
          typeof error.stdout === "string" ? error.stdout : "",
          typeof error.stderr === "string" ? error.stderr : "",
        ]
          .filter(Boolean)
          .join("\n")
      : String(error);
    const detail = isRecord(error)
      ? sanitizeDiagnosticText(
          [
            typeof error.message === "string" ? error.message : "",
            typeof error.stdout === "string" ? error.stdout : "",
            typeof error.stderr === "string" ? error.stderr : "",
          ]
            .filter(Boolean)
            .join("\n"),
          params.secretValues
        )
      : errorMessage(error, params.secretValues);
    return {
      ok: false,
      output: detail,
      rawOutput,
      diagnostics: [
        `${commandLabel(params.command, params.args)} failed: ${detail}`,
      ],
    };
  }
}

function outputLooksUnauthenticated(output: string): boolean {
  return /(not\s+logged\s+in|not\s+authenticated|unauthenticated|login\s+required|no\s+auth|missing\s+credential)/i.test(
    output
  );
}

function outputLooksAuthenticated(output: string): boolean {
  return /(logged\s+in|authenticated|auth\s+ok|account|signed\s+in|token\s+valid|credential[s]?\s+ok)/i.test(
    output
  );
}

function providerStatusFromText(
  value: unknown,
  output: string
): "ok" | "unknown" | "failed" {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["ok", "ready", "success", "passed", "authenticated"].includes(normalized)) {
      return "ok";
    }
    if (["fail", "failed", "error", "missing", "unauthenticated"].includes(normalized)) {
      return "failed";
    }
    if (["warn", "warning", "skipped", "unknown"].includes(normalized)) {
      return "unknown";
    }
  }
  if (outputLooksUnauthenticated(output)) {
    return "failed";
  }
  return outputLooksAuthenticated(output) ? "ok" : "unknown";
}

function parseProviderModelList(output: string): string[] {
  const trimmed = output.trim();
  const models = new Set<string>();
  const addModel = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const candidate = value.trim();
    if (candidate && candidate.length <= 160) {
      models.add(candidate);
    }
  };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidates = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.models)
          ? parsed.models
          : isRecord(parsed) && Array.isArray(parsed.availableModels)
            ? parsed.availableModels
            : isRecord(parsed) && Array.isArray(parsed.data)
              ? parsed.data
              : [];
      for (const item of candidates) {
        if (typeof item === "string") {
          addModel(item);
        } else if (isRecord(item)) {
          addModel(item.id);
          addModel(item.modelId);
          addModel(item.model);
          addModel(item.name);
        }
      }
    } catch {
      // Fall through to line parsing.
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^[-*\s]+/, "")
      .replace(/\s+\(.+\)$/, "")
      .trim();
    const candidate = cleaned.includes(" ")
      ? cleaned.split(/\s+[-:]\s+|\s+/)[0]?.trim() ?? ""
      : cleaned;
    if (
      candidate &&
      candidate.length <= 120 &&
      !candidate.includes(" ") &&
      !candidate.includes(":") &&
      !["model", "models", "name", "id"].includes(candidate.toLowerCase())
    ) {
      models.add(candidate);
    }
  }
  return [...models].slice(0, 80);
}

function parseJsonObjectFromOutput(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function doctorCheckStatus(
  report: Record<string, unknown>,
  checkId: string
): string | undefined {
  const checks = isRecord(report.checks) ? report.checks : undefined;
  const check = checks && isRecord(checks[checkId]) ? checks[checkId] : undefined;
  return typeof check?.status === "string" ? check.status : undefined;
}

function doctorCheckDetails(
  report: Record<string, unknown>,
  checkId: string
): Record<string, unknown> | undefined {
  const checks = isRecord(report.checks) ? report.checks : undefined;
  const check = checks && isRecord(checks[checkId]) ? checks[checkId] : undefined;
  return isRecord(check?.details) ? check.details : undefined;
}

function statusFromDoctorCheck(
  status: string | undefined,
  output: string
): "ok" | "unknown" | "failed" {
  if (status === "ok") {
    return "ok";
  }
  if (status === "warn" || status === "warning" || status === "skipped") {
    return "unknown";
  }
  if (status) {
    return "failed";
  }
  return outputLooksUnauthenticated(output) ? "failed" : "unknown";
}

function parseCodexDoctorReadiness(output: string): {
  authStatus?: LocalAdeProviderDescriptor["authStatus"];
  modelStatus?: LocalAdeProviderDescriptor["modelStatus"];
  modelList: string[];
  diagnostics: string[];
} {
  const report = parseJsonObjectFromOutput(output);
  if (!report) {
    return {
      modelList: [],
      diagnostics: ["Codex doctor output was not valid JSON."],
    };
  }

  const diagnostics: string[] = [];
  const overallStatus =
    typeof report.overallStatus === "string" ? report.overallStatus : "unknown";
  diagnostics.push(`Codex doctor overall status: ${overallStatus}.`);

  const authCheck = doctorCheckStatus(report, "auth.credentials");
  const authStatus = statusFromDoctorCheck(authCheck, output);
  diagnostics.push(`Codex doctor auth.credentials: ${authCheck ?? "missing"}.`);

  const configDetails = doctorCheckDetails(report, "config.load");
  const configuredModel =
    typeof configDetails?.model === "string" ? configDetails.model.trim() : "";
  const providerReachability = doctorCheckStatus(
    report,
    "network.provider_reachability"
  );
  const websocketReachability = doctorCheckStatus(
    report,
    "network.websocket_reachability"
  );
  const reachabilityOk =
    providerReachability === "ok" || websocketReachability === "ok";
  const modelList = configuredModel ? [configuredModel].slice(0, 1) : [];
  const modelStatus: LocalAdeProviderDescriptor["modelStatus"] =
    configuredModel && reachabilityOk
      ? "ok"
      : configuredModel
        ? "unknown"
        : "failed";
  diagnostics.push(
    `Codex doctor model: ${configuredModel ? "configured" : "missing"}.`
  );
  diagnostics.push(
    `Codex doctor reachability: provider ${providerReachability ?? "missing"}, websocket ${
      websocketReachability ?? "missing"
    }.`
  );

  return {
    authStatus,
    modelStatus,
    modelList,
    diagnostics,
  };
}

function recordStatusFromCandidates(
  report: Record<string, unknown>,
  keys: string[],
  output: string
): "ok" | "unknown" | "failed" {
  for (const key of keys) {
    const value = report[key];
    if (typeof value === "string") {
      return providerStatusFromText(value, output);
    }
    if (isRecord(value)) {
      const status =
        value.status ??
        value.state ??
        value.result ??
        value.health ??
        value.ready;
      const parsed = providerStatusFromText(status, output);
      if (parsed !== "unknown") {
        return parsed;
      }
    }
  }
  return providerStatusFromText(undefined, output);
}

function parseGenericProviderDoctorReadiness(
  providerKind: "claude" | "gemini",
  output: string
): {
  authStatus?: LocalAdeProviderDescriptor["authStatus"];
  modelStatus?: LocalAdeProviderDescriptor["modelStatus"];
  modelList: string[];
  diagnostics: string[];
} {
  const report = parseJsonObjectFromOutput(output);
  if (!report) {
    return {
      modelList: [],
      diagnostics: [`${providerKind} doctor output was not valid JSON.`],
    };
  }

  const diagnostics: string[] = [];
  const overall = providerStatusFromText(
    report.overallStatus ?? report.status ?? report.state,
    output
  );
  diagnostics.push(`${providerKind} doctor overall status: ${overall}.`);

  const authStatus = recordStatusFromCandidates(
    report,
    ["auth", "authentication", "credentials", "login", "account"],
    output
  );
  diagnostics.push(`${providerKind} doctor auth status: ${authStatus}.`);

  const modelList = parseProviderModelList(JSON.stringify(report));
  const modelStatus: LocalAdeProviderDescriptor["modelStatus"] =
    modelList.length > 0 ? "ok" : overall === "failed" ? "failed" : "unknown";
  diagnostics.push(`${providerKind} doctor model identifiers: ${modelList.length}.`);

  return {
    authStatus,
    modelStatus,
    modelList,
    diagnostics,
  };
}

async function runFirstProviderProbe(params: {
  command: string;
  prefixArgs: string[];
  candidates: string[][];
  env: NodeJS.ProcessEnv;
  secretValues: string[];
  timeoutMs?: number;
}): Promise<ProviderCommandProbe | null> {
  if (params.candidates.length === 0) {
    return null;
  }
  const failures: string[] = [];
  for (const candidate of params.candidates) {
    const probe = await runProviderCommandProbe({
      command: params.command,
      args: [...params.prefixArgs, ...candidate],
      env: params.env,
      secretValues: params.secretValues,
      timeoutMs: params.timeoutMs,
    });
    if (probe.ok) {
      return probe;
    }
    failures.push(...probe.diagnostics);
  }
  return {
    ok: false,
    output: failures.join("\n"),
    rawOutput: failures.join("\n"),
    diagnostics: failures,
  };
}

function readinessFromStatuses(params: {
  cliStatus: LocalAdeProviderDescriptor["cliStatus"];
  authStatus: LocalAdeProviderDescriptor["authStatus"];
  modelStatus: LocalAdeProviderDescriptor["modelStatus"];
}): LocalAdeProviderDescriptor["readiness"] {
  if (params.cliStatus !== "ok") {
    return "unavailable";
  }
  if (params.authStatus === "failed") {
    return "auth-unknown";
  }
  if (params.modelStatus === "failed") {
    return "model-unknown";
  }
  if (params.authStatus === "unknown" || params.authStatus === "unsupported") {
    return "auth-unknown";
  }
  if (params.modelStatus === "unknown" || params.modelStatus === "unsupported") {
    return "model-unknown";
  }
  return "ready";
}

function providerReadinessRemediation(params: {
  providerKind: string;
  command: string;
  cliStatus: LocalAdeProviderDescriptor["cliStatus"];
  authStatus: LocalAdeProviderDescriptor["authStatus"];
  modelStatus: LocalAdeProviderDescriptor["modelStatus"];
  modelList: string[];
}): string[] {
  const command = params.command || params.providerKind;
  const items: string[] = [];
  if (params.cliStatus === "missing") {
    items.push(`Install ${params.providerKind} CLI and ensure \`${command}\` is on PATH.`);
  } else if (params.cliStatus === "failed") {
    items.push(`Run \`${command} --version\` outside Eragear and fix the CLI startup error.`);
  }
  if (params.cliStatus === "ok") {
    if (params.authStatus === "failed" || params.authStatus === "unknown") {
      items.push(`Authenticate ${params.providerKind} CLI, then rerun the provider probe.`);
    } else if (params.authStatus === "unsupported") {
      items.push(`No safe auth status command is known for ${params.providerKind}; verify authentication in the CLI.`);
    }
    if (params.modelStatus === "failed" || params.modelStatus === "unknown") {
      items.push(`List or configure a ${params.providerKind} model, then rerun the provider probe.`);
    } else if (params.modelStatus === "unsupported") {
      items.push(`No safe model list command is known for ${params.providerKind}; configure a model in the agent descriptor.`);
    }
    if (params.modelStatus === "ok" && params.modelList.length === 0) {
      items.push("Model probe succeeded but returned no identifiers; configure a default model manually.");
    }
  }
  if (items.length === 0) {
    items.push("Provider is ready; no remediation required.");
  }
  return items.slice(0, 6);
}

async function probeProviderReadiness(
  agent: Awaited<ReturnType<AgentRepositoryPort["findAll"]>>[number]
): Promise<ProviderReadinessProbe> {
  const diagnostics: string[] = [];
  const secretValues = Object.values(agent.env ?? {});
  const command = agent.command.trim();
  const resolved = await resolveExecutable(command);
  diagnostics.push(...resolved.diagnostics);
  if (!resolved.available) {
    const remediation = providerReadinessRemediation({
      providerKind: agent.type,
      command,
      cliStatus: "missing",
      authStatus: "unknown",
      modelStatus: "unknown",
      modelList: [],
    });
    return {
      cliStatus: "missing",
      authStatus: "unknown",
      modelStatus: "unknown",
      readiness: "unavailable",
      modelList: [],
      diagnostics,
      remediation,
    };
  }

  const env = {
    ...process.env,
    ...(agent.env ?? {}),
  };
  const prefixArgs = providerProbePrefixArgs(agent);
  const versionProbe = await runProviderCommandProbe({
    command,
    args: [...prefixArgs, "--version"],
    env,
    secretValues,
    timeoutMs: PROVIDER_VERSION_PROBE_TIMEOUT_MS,
  });
  diagnostics.push(...versionProbe.diagnostics);
  const version = versionProbe.ok
    ? firstOutputLine(versionProbe.output, "")?.slice(0, 160)
    : undefined;
  const cliStatus: LocalAdeProviderDescriptor["cliStatus"] = versionProbe.ok
    ? "ok"
    : "failed";
  if (cliStatus !== "ok") {
    const remediation = providerReadinessRemediation({
      providerKind: agent.type,
      command,
      cliStatus,
      authStatus: "unknown",
      modelStatus: "unknown",
      modelList: [],
    });
    return {
      cliStatus,
      authStatus: "unknown",
      modelStatus: "unknown",
      readiness: "unavailable",
      modelList: [],
      diagnostics,
      remediation,
    };
  }

  const plan =
    agent.type === "claude" ||
    agent.type === "codex" ||
    agent.type === "gemini" ||
    agent.type === "opencode"
      ? PROVIDER_PROBE_PLANS[agent.type]
      : undefined;

  let authStatus: LocalAdeProviderDescriptor["authStatus"] = "unsupported";
  let modelStatus: LocalAdeProviderDescriptor["modelStatus"] = "unsupported";
  let modelList: string[] = [];
  if (plan?.doctor) {
    const doctorProbe = await runProviderCommandProbe({
      command,
      args: [...prefixArgs, ...plan.doctor.args],
      env,
      secretValues,
      timeoutMs: plan.doctor.timeoutMs,
    });
    diagnostics.push(...doctorProbe.diagnostics);
    if (doctorProbe.ok && agent.type === "codex") {
      const codexDoctor = parseCodexDoctorReadiness(doctorProbe.rawOutput);
      diagnostics.push(...codexDoctor.diagnostics);
      authStatus = codexDoctor.authStatus ?? authStatus;
      modelStatus = codexDoctor.modelStatus ?? modelStatus;
      modelList = codexDoctor.modelList;
    } else if (
      doctorProbe.ok &&
      (agent.type === "claude" || agent.type === "gemini")
    ) {
      const doctor = parseGenericProviderDoctorReadiness(
        agent.type,
        doctorProbe.rawOutput
      );
      diagnostics.push(...doctor.diagnostics);
      authStatus = doctor.authStatus ?? authStatus;
      modelStatus = doctor.modelStatus ?? modelStatus;
      modelList = doctor.modelList;
    } else if (!doctorProbe.ok) {
      diagnostics.push("Provider doctor probe failed; falling back to CLI probes.");
    }
  }

  if (plan) {
    if (authStatus !== "ok" && authStatus !== "failed") {
      const authProbe = await runFirstProviderProbe({
        command,
        prefixArgs,
        candidates: plan.auth,
        env,
        secretValues,
      });
      if (authProbe?.ok) {
        authStatus = outputLooksUnauthenticated(authProbe.output) ? "failed" : "ok";
        diagnostics.push(...authProbe.diagnostics);
        diagnostics.push(`Provider auth probe classified as ${authStatus}.`);
      } else {
        authStatus = "unknown";
        diagnostics.push(
          ...(authProbe?.diagnostics ?? ["No provider auth probe is configured."])
        );
        diagnostics.push("Provider auth probe is unknown for this CLI.");
      }
    }
  } else {
    diagnostics.push("No safe provider auth probe is configured for this agent type.");
  }

  if (plan) {
    if (modelStatus !== "ok" && modelStatus !== "failed") {
      const modelProbe = await runFirstProviderProbe({
        command,
        prefixArgs,
        candidates: plan.models,
        env,
        secretValues,
      });
      if (modelProbe?.ok) {
        modelList = parseProviderModelList(modelProbe.output);
        modelStatus = modelList.length > 0 ? "ok" : "unknown";
        diagnostics.push(...modelProbe.diagnostics);
        diagnostics.push(
          `Provider model probe returned ${modelList.length} model identifiers.`
        );
      } else {
        modelStatus = "unknown";
        diagnostics.push(
          ...(modelProbe?.diagnostics ?? ["No provider model probe is configured."])
        );
        diagnostics.push("Provider model probe is unknown for this CLI.");
      }
    }
  } else {
    diagnostics.push("No safe provider model probe is configured for this agent type.");
  }

  const readiness = readinessFromStatuses({
    cliStatus,
    authStatus,
    modelStatus,
  });
  const remediation = providerReadinessRemediation({
    providerKind: agent.type,
    command,
    cliStatus,
    authStatus,
    modelStatus,
    modelList,
  });
  return {
    cliStatus,
    authStatus,
    modelStatus,
    readiness,
    ...(version ? { version } : {}),
    modelList,
    diagnostics,
    remediation,
  };
}

async function providerDescriptorsFromAgents(
  rootPath: string,
  agents: Awaited<ReturnType<AgentRepositoryPort["findAll"]>>,
  healthDocument: ProviderHealthDocument,
  defaultModel: string
): Promise<LocalAdeProviderDescriptor[]> {
  return await Promise.all(agents.map(async (agent) => {
    const envKeys = Object.keys(agent.env ?? {});
    const fallbackModelList = [
      ...(agent.type === "opencode" ? ["agent-configured"] : []),
      ...(agent.type === "codex" ? ["codex-default"] : []),
      ...(agent.type === "claude" ? ["claude-default"] : []),
      ...(agent.type === "gemini" ? ["gemini-default"] : []),
    ];
    const providerId = `provider.agent.${agent.id}`;
    const health = healthDocument.providers[providerId];
    const executable = await resolveExecutable(agent.command.trim());
    const status =
      health?.status ?? (executable.available ? "configured" : "missing-config");
    const readiness =
      health?.readiness ?? (executable.available ? "cli-ok" : "missing-config");
    const probedModelList = health?.modelList?.length ? health.modelList : [];
    const modelListSource =
      probedModelList.length > 0 ? "readiness-probe" : "fallback";
    const modelList =
      modelListSource === "readiness-probe" ? probedModelList : fallbackModelList;
    const cliStatus = health?.cliStatus ?? (executable.available ? "ok" : "missing");
    const authStatus = health?.authStatus ?? "unknown";
    const modelStatus = health?.modelStatus ?? "unknown";
    return {
      id: providerId,
      displayName: agent.name,
      providerKind: agent.type,
      authMode: envKeys.length > 0 ? "env" : "none",
      modelList,
      aliases: [agent.type, agent.name],
      compatibleAgents: [agent.id],
      redactedEnvKeys: envKeys,
      status,
      cliStatus,
      authStatus,
      modelStatus,
      readiness,
      ...(health?.version ? { version: health.version } : {}),
      ...(health?.checkedAt ? { lastProbedAt: health.checkedAt } : {}),
      ...(typeof health?.latencyMs === "number" ? { latencyMs: health.latencyMs } : {}),
      modelListSource,
      ...(defaultModel &&
      modelListSource === "readiness-probe" &&
      modelList.includes(defaultModel)
        ? { selectedModel: defaultModel }
        : {}),
      diagnostics: [
        "Provider state is derived from safe agent config metadata and redacted readiness probes.",
        ...executable.diagnostics,
        envKeys.length > 0
          ? "Secrets are present only as redacted ENV key names."
          : "No agent-specific ENV keys configured.",
        ...(health?.diagnostics ?? []),
        `Provider health is stored at ${path.join(
          ensureProjectDataDir(rootPath),
          PROVIDER_HEALTH_FILE
        )}.`,
      ],
      remediation: health?.remediation?.length
        ? health.remediation.slice(0, 6)
        : providerReadinessRemediation({
            providerKind: agent.type,
            command: agent.command.trim(),
            cliStatus,
            authStatus,
            modelStatus,
            modelList,
          }),
    };
  }));
}

function providerCapabilities(
  providers: LocalAdeProviderDescriptor[]
): CapabilityDescriptor[] {
  return providers.map((provider) => ({
    id: `model-provider.${provider.id}`,
    kind: "model-provider",
    name: provider.displayName,
    description: `${provider.providerKind} provider mapping from agent configuration.`,
    scope: "local",
    enabled: true,
    storage: "runtime-diagnostic",
    tags: ["provider", provider.providerKind],
    diagnostics: provider.diagnostics,
  }));
}

function createActiveSessionModelSnapshot(session: ChatSession): {
  currentModelId: string | null;
  supportsSwitching: boolean;
  source: "config-option" | "models" | "none";
  availableModels: SessionModelState["availableModels"];
  diagnostics: string[];
} {
  const modelOption = findSessionConfigOption(session.configOptions, "model");
  const configCurrentModel = getSessionConfigOptionCurrentValue({
    configOptions: session.configOptions,
    target: "model",
  });
  const optionModels = getSessionConfigOptionValues(modelOption).map(
    (option) => ({
      modelId: option.value,
      name: option.name ?? option.value,
      ...(option.description ? { description: option.description } : {}),
    })
  );
  const modelStateModels = session.models?.availableModels ?? [];
  const currentModelId =
    configCurrentModel ?? session.models?.currentModelId ?? null;
  const source =
    optionModels.length > 0
      ? "config-option"
      : modelStateModels.length > 0
        ? "models"
        : "none";
  const availableModels =
    source === "config-option" ? optionModels : modelStateModels;
  const diagnostics: string[] = [];
  const supportsSwitching = Boolean(session.supportsModelSwitching || modelOption);
  if (!supportsSwitching) {
    diagnostics.push("Agent did not advertise runtime model switching.");
  }
  if (source === "none") {
    diagnostics.push("Session has not exposed selectable model options.");
  }
  if (source === "config-option") {
    diagnostics.push("Model options are derived from session config options.");
  }
  if (source === "models") {
    diagnostics.push("Model options are derived from session model state.");
  }

  return {
    currentModelId,
    supportsSwitching,
    source,
    availableModels,
    diagnostics,
  };
}

async function readGitSnapshot(rootPath: string): Promise<LocalAdeChangeTrustSnapshot> {
  try {
    await execFileAsync("git", ["-C", rootPath, "rev-parse", "--is-inside-work-tree"], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch {
    return {
      rootPath,
      isGitRepo: false,
      changedFiles: [],
      statusLines: [],
      diagnostics: ["Project root is not a Git repository or Git is unavailable."],
    };
  }

  try {
    const [status, names] = await Promise.all([
      execFileAsync("git", ["-C", rootPath, "status", "--short"], {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      }),
      execFileAsync("git", ["-C", rootPath, "diff", "--name-only"], {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      }),
    ]);
    return {
      rootPath,
      isGitRepo: true,
      changedFiles: names.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      statusLines: status.stdout
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean),
      diagnostics: [
        "Git diff fallback is active; checkpoints support preview plus guarded restore with an automatic pre-restore safety checkpoint.",
      ],
    };
  } catch (error) {
    return {
      rootPath,
      isGitRepo: true,
      changedFiles: [],
      statusLines: [],
      diagnostics: [
        `Git status failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

async function runGit(
  rootPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function readGitStatusLines(rootPath: string): Promise<string[]> {
  return (await runGit(rootPath, ["status", "--short"])).stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function cleanCheckpointString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanCheckpointNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanCheckpointMessagePreview(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, MAX_CHECKPOINT_MESSAGE_PREVIEW_CHARS);
}

function checkpointAttributionSource(
  value: unknown
): LocalAdeCheckpointSessionAttribution["source"] {
  return value === "active" || value === "stored" || value === "missing"
    ? value
    : "missing";
}

function checkpointMessageRole(
  value: unknown
): LocalAdeCheckpointSessionAttribution["lastMessageRole"] | undefined {
  return value === "user" || value === "assistant" ? value : undefined;
}

function normalizeCheckpointSessionAttributions(
  value: unknown
): LocalAdeCheckpointSessionAttribution[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attributions: LocalAdeCheckpointSessionAttribution[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.chatId !== "string" || !item.chatId.trim()) {
      continue;
    }
    const source = checkpointAttributionSource(item.source);
    const status = cleanCheckpointString(item.status) ?? source;
    const messageCount = cleanCheckpointNumber(item.messageCount);
    const attribution: LocalAdeCheckpointSessionAttribution = {
      chatId: item.chatId.trim(),
      source,
      status,
      messageCount:
        typeof messageCount === "number" ? Math.max(0, Math.floor(messageCount)) : 0,
    };
    const projectId = cleanCheckpointString(item.projectId);
    const sessionId = cleanCheckpointString(item.sessionId);
    const agentName = cleanCheckpointString(item.agentName);
    const lastMessageRole = checkpointMessageRole(item.lastMessageRole);
    const lastMessagePreview = cleanCheckpointMessagePreview(item.lastMessagePreview);
    const lastMessageAt = cleanCheckpointNumber(item.lastMessageAt);
    const activeTurnId = cleanCheckpointString(item.activeTurnId);
    const lastCompletedTurnId = cleanCheckpointString(item.lastCompletedTurnId);
    const subscriberCount = cleanCheckpointNumber(item.subscriberCount);
    const pendingPermissions = cleanCheckpointNumber(item.pendingPermissions);
    const activeToolCalls = cleanCheckpointNumber(item.activeToolCalls);
    if (projectId) {
      attribution.projectId = projectId;
    }
    if (sessionId) {
      attribution.sessionId = sessionId;
    }
    if (agentName) {
      attribution.agentName = agentName;
    }
    if (lastMessageRole) {
      attribution.lastMessageRole = lastMessageRole;
    }
    if (lastMessagePreview) {
      attribution.lastMessagePreview = lastMessagePreview;
    }
    if (typeof lastMessageAt === "number") {
      attribution.lastMessageAt = lastMessageAt;
    }
    if (activeTurnId) {
      attribution.activeTurnId = activeTurnId;
    }
    if (lastCompletedTurnId) {
      attribution.lastCompletedTurnId = lastCompletedTurnId;
    }
    if (typeof subscriberCount === "number") {
      attribution.subscriberCount = Math.max(0, Math.floor(subscriberCount));
    }
    if (typeof pendingPermissions === "number") {
      attribution.pendingPermissions = Math.max(0, Math.floor(pendingPermissions));
    }
    if (typeof activeToolCalls === "number") {
      attribution.activeToolCalls = Math.max(0, Math.floor(activeToolCalls));
    }
    attributions.push(attribution);
    if (attributions.length >= MAX_CHECKPOINT_SESSION_ATTRIBUTIONS) {
      break;
    }
  }
  return attributions;
}

function messageTimestamp(message: unknown): number | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  return cleanCheckpointNumber(message.createdAt) ?? cleanCheckpointNumber(message.timestamp);
}

function messagePreview(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  const content = cleanCheckpointMessagePreview(message.content);
  if (content) {
    return content;
  }
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const partText = parts
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      return (
        cleanCheckpointString(part.text) ??
        cleanCheckpointString(part.content) ??
        ""
      );
    })
    .filter(Boolean)
    .join(" ");
  const preview = cleanCheckpointMessagePreview(partText);
  if (preview) {
    return preview;
  }
  const contentBlocks = Array.isArray(message.contentBlocks)
    ? message.contentBlocks
    : [];
  return cleanCheckpointMessagePreview(
    contentBlocks
      .map((block) =>
        isRecord(block)
          ? cleanCheckpointString(block.text) ?? cleanCheckpointString(block.content) ?? ""
          : ""
      )
      .filter(Boolean)
      .join(" ")
  );
}

function messageSummary(messages: unknown[]): Pick<
  LocalAdeCheckpointSessionAttribution,
  "lastMessageRole" | "lastMessagePreview" | "lastMessageAt"
> {
  let latest: unknown;
  let latestScore = Number.NEGATIVE_INFINITY;
  messages.forEach((message, index) => {
    const timestamp = messageTimestamp(message);
    const score = typeof timestamp === "number" ? timestamp : index;
    if (score >= latestScore) {
      latest = message;
      latestScore = score;
    }
  });
  if (!latest || !isRecord(latest)) {
    return {};
  }
  const role = checkpointMessageRole(latest.role);
  const preview = messagePreview(latest);
  const timestamp = messageTimestamp(latest);
  return {
    ...(role ? { lastMessageRole: role } : {}),
    ...(preview ? { lastMessagePreview: preview } : {}),
    ...(typeof timestamp === "number" ? { lastMessageAt: timestamp } : {}),
  };
}

function runtimeCheckpointAttribution(
  session: RuntimeSession
): LocalAdeCheckpointSessionAttribution {
  const messages =
    session.uiState?.messages instanceof Map
      ? Array.from(session.uiState.messages.values())
      : [];
  const summary = messageSummary(messages);
  return {
    chatId: session.id,
    source: "active",
    status: session.chatStatus,
    messageCount: messages.length,
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.agentInfo?.title || session.agentInfo?.name || session.sessionInfo?.title
      ? {
          agentName:
            session.agentInfo?.title ??
            session.agentInfo?.name ??
            session.sessionInfo?.title ??
            undefined,
        }
      : {}),
    ...summary,
    ...(session.activeTurnId ? { activeTurnId: session.activeTurnId } : {}),
    ...(session.lastCompletedTurnId
      ? { lastCompletedTurnId: session.lastCompletedTurnId }
      : {}),
    subscriberCount: session.subscriberCount,
    pendingPermissions: session.pendingPermissions.size,
    activeToolCalls: session.toolCalls.size,
  };
}

function storedCheckpointAttribution(
  session: StoredSession,
  latestMessage?: StoredMessage
): LocalAdeCheckpointSessionAttribution {
  const messages = latestMessage ? [latestMessage] : session.messages;
  const summary = messageSummary(messages);
  return {
    chatId: session.id,
    source: "stored",
    status: session.status,
    messageCount: session.messageCount ?? session.messages.length,
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.agentInfo?.title || session.agentInfo?.name || session.agentName
      ? {
          agentName:
            session.agentInfo?.title ??
            session.agentInfo?.name ??
            session.agentName ??
            undefined,
        }
      : {}),
    ...summary,
  };
}

function mergeCheckpointAttribution(
  active: LocalAdeCheckpointSessionAttribution,
  stored?: LocalAdeCheckpointSessionAttribution
): LocalAdeCheckpointSessionAttribution {
  if (!stored) {
    return active;
  }
  const merged: LocalAdeCheckpointSessionAttribution = {
    ...active,
    messageCount: Math.max(active.messageCount, stored.messageCount),
  };
  if (!merged.projectId && stored.projectId) {
    merged.projectId = stored.projectId;
  }
  if (!merged.sessionId && stored.sessionId) {
    merged.sessionId = stored.sessionId;
  }
  if (!merged.agentName && stored.agentName) {
    merged.agentName = stored.agentName;
  }
  if (!merged.lastMessageRole && stored.lastMessageRole) {
    merged.lastMessageRole = stored.lastMessageRole;
  }
  if (!merged.lastMessagePreview && stored.lastMessagePreview) {
    merged.lastMessagePreview = stored.lastMessagePreview;
  }
  if (typeof merged.lastMessageAt !== "number" && typeof stored.lastMessageAt === "number") {
    merged.lastMessageAt = stored.lastMessageAt;
  }
  return merged;
}

async function readCheckpointDocument(rootPath: string): Promise<CheckpointDocument> {
  const parsed = await readJsonObject(
    path.join(ensureProjectDataDir(rootPath), CHECKPOINTS_FILE)
  );
  if (!parsed || !Array.isArray(parsed.checkpoints)) {
    return { version: 1, checkpoints: [] };
  }
  const checkpoints = parsed.checkpoints.filter((item): item is LocalAdeCheckpoint => {
    if (!isRecord(item)) {
      return false;
    }
    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.createdAt === "string" &&
      typeof item.projectRoot === "string" &&
      Array.isArray(item.sessionIds) &&
      (item.sessionAttributions === undefined ||
        Array.isArray(item.sessionAttributions)) &&
      Array.isArray(item.changedFiles) &&
      Array.isArray(item.statusLines) &&
      (item.restoreMode === undefined ||
        item.restoreMode === "reverse-patch" ||
        item.restoreMode === "apply-patch") &&
      (item.restoreStatusLines === undefined ||
        Array.isArray(item.restoreStatusLines)) &&
      (item.safetyForCheckpointId === undefined ||
        typeof item.safetyForCheckpointId === "string") &&
      (item.preRestoreSafetyCheckpointId === undefined ||
        typeof item.preRestoreSafetyCheckpointId === "string") &&
      (item.partialRestores === undefined ||
        Array.isArray(item.partialRestores)) &&
      (item.conflictShelves === undefined ||
        Array.isArray(item.conflictShelves)) &&
      typeof item.patchPath === "string" &&
      typeof item.patchBytes === "number" &&
      typeof item.canRestore === "boolean" &&
      (item.restoredAt === undefined || typeof item.restoredAt === "string") &&
      Array.isArray(item.diagnostics)
    );
  });
  return {
    version: 1,
    checkpoints: checkpoints.slice(0, MAX_CHECKPOINTS).map((checkpoint) => ({
      ...checkpoint,
      sessionIds: checkpoint.sessionIds.filter(
        (sessionId): sessionId is string => typeof sessionId === "string"
      ),
      sessionAttributions: normalizeCheckpointSessionAttributions(
        checkpoint.sessionAttributions
      ),
      partialRestores: Array.isArray(checkpoint.partialRestores)
        ? checkpoint.partialRestores
            .filter(
              (restore): restore is NonNullable<LocalAdeCheckpoint["partialRestores"]>[number] =>
                isRecord(restore) &&
                typeof restore.restoredAt === "string" &&
                Array.isArray(restore.files) &&
                (restore.safetyCheckpointId === undefined ||
                  typeof restore.safetyCheckpointId === "string")
            )
            .map((restore) => ({
              restoredAt: restore.restoredAt,
              files: restore.files
                .filter((file): file is string => typeof file === "string")
                .map(normalizeSlash),
              ...(restore.resolution === "restore" ||
              restore.resolution === "current" ||
              restore.resolution === "mixed"
                ? { resolution: restore.resolution }
                : {}),
              ...(Array.isArray(restore.hunks)
                ? {
                    hunks: restore.hunks
                      .filter(
                        (
                          hunk
                        ): hunk is NonNullable<
                          NonNullable<LocalAdeCheckpoint["partialRestores"]>[number]["hunks"]
                        >[number] =>
                          isRecord(hunk) &&
                          typeof hunk.file === "string" &&
                          typeof hunk.hunkIndex === "number" &&
                          Number.isInteger(hunk.hunkIndex) &&
                          hunk.hunkIndex >= 0 &&
                          typeof hunk.header === "string"
                      )
                      .map((hunk) => ({
                        file: normalizeSlash(hunk.file),
                        hunkIndex: hunk.hunkIndex,
                        header: hunk.header,
                      })),
                  }
                : {}),
              ...(Array.isArray(restore.hunkChoices)
                ? {
                    hunkChoices: restore.hunkChoices
                      .filter(
                        (
                          hunk
                        ): hunk is NonNullable<
                          NonNullable<
                            LocalAdeCheckpoint["partialRestores"]
                          >[number]["hunkChoices"]
                        >[number] =>
                          isRecord(hunk) &&
                          typeof hunk.file === "string" &&
                          typeof hunk.hunkIndex === "number" &&
                          Number.isInteger(hunk.hunkIndex) &&
                          hunk.hunkIndex >= 0 &&
                          typeof hunk.header === "string" &&
                          (hunk.resolution === "restore" ||
                            hunk.resolution === "current")
                      )
                      .map((hunk) => ({
                        file: normalizeSlash(hunk.file),
                        hunkIndex: hunk.hunkIndex,
                        header: hunk.header,
                        resolution: hunk.resolution,
                      })),
                  }
                : {}),
              ...(restore.safetyCheckpointId
                ? { safetyCheckpointId: restore.safetyCheckpointId }
                : {}),
            }))
        : undefined,
      conflictShelves: Array.isArray(checkpoint.conflictShelves)
        ? checkpoint.conflictShelves
            .filter(
              (
                shelf
              ): shelf is NonNullable<LocalAdeCheckpoint["conflictShelves"]>[number] =>
                isRecord(shelf) &&
                typeof shelf.shelvedAt === "string" &&
                Array.isArray(shelf.files) &&
                typeof shelf.shelfPath === "string" &&
                typeof shelf.reason === "string"
            )
            .map((shelf) => ({
              shelvedAt: shelf.shelvedAt,
              files: shelf.files
                .filter((file): file is string => typeof file === "string")
                .map(normalizeSlash),
              shelfPath: shelf.shelfPath,
              reason: shelf.reason,
            }))
        : undefined,
    })),
  };
}

async function writeCheckpointDocument(
  rootPath: string,
  document: CheckpointDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, CHECKPOINTS_FILE),
    `${JSON.stringify(
      {
        version: 1,
        checkpoints: document.checkpoints.slice(0, MAX_CHECKPOINTS),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function createGitCheckpoint(params: {
  rootPath: string;
  name?: string;
  sessionIds: string[];
  sessionAttributions: LocalAdeCheckpointSessionAttribution[];
  restoreMode?: LocalAdeCheckpoint["restoreMode"];
  safetyForCheckpointId?: string;
  files?: string[];
}): Promise<LocalAdeCheckpoint> {
  const rootPath = params.rootPath;
  const id = `checkpoint-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const patchDir = path.join(ensureProjectDataDir(rootPath), CHECKPOINT_PATCH_DIR);
  await mkdir(patchDir, { recursive: true });
  const patchPath = path.join(patchDir, `${id}.patch`);

  let gitHead: string | undefined;
  let statusLines: string[] = [];
  let changedFiles: string[] = [];
  let patch = "";
  const diagnostics: string[] = [];

  try {
    gitHead = (await runGit(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
    const selectedFiles = params.files?.length
      ? normalizeCheckpointRestoreFiles(params.files)
      : null;
    statusLines = (await runGit(rootPath, ["status", "--short"])).stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .filter((line) => !isCheckpointInternalStatusLine(line));
    if (selectedFiles) {
      statusLines = filterStatusLinesByFiles(statusLines, selectedFiles);
    }
    const trackedChanged = (await runGit(rootPath, ["diff", "--name-only"])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const untracked = statusLines
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    changedFiles = Array.from(new Set([...trackedChanged, ...untracked]));
    if (selectedFiles) {
      const selected = new Set(selectedFiles);
      changedFiles = changedFiles.filter((file) => selected.has(normalizeSlash(file)));
    }
    patch = (await runGit(rootPath, ["diff", "--binary"])).stdout;
    if (selectedFiles) {
      patch = filterCheckpointPatchByFiles(patch, selectedFiles);
    }
    if (untracked.length > 0) {
      diagnostics.push(
        "Untracked files are listed in checkpoint metadata but not embedded in the patch."
      );
    }
    if (!patch.trim()) {
      diagnostics.push("No tracked-file diff was present when the checkpoint was created.");
    }
  } catch (error) {
    diagnostics.push(
      `Git checkpoint capture failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  await writeFile(patchPath, patch, "utf8");
  const patchBytes = Buffer.byteLength(patch, "utf8");
  const name =
    params.name?.trim() ||
    `Checkpoint ${new Date(createdAt).toLocaleString("en-US", {
      hour12: false,
    })}`;

  return {
    id,
    name,
    createdAt,
    projectRoot: rootPath,
    sessionIds: params.sessionIds,
    sessionAttributions: params.sessionAttributions,
    ...(gitHead ? { gitHead } : {}),
    changedFiles,
    statusLines,
    restoreMode: params.restoreMode ?? "reverse-patch",
    ...(params.safetyForCheckpointId
      ? { safetyForCheckpointId: params.safetyForCheckpointId }
      : {}),
    patchPath,
    patchBytes,
    canRestore: patchBytes > 0,
    diagnostics: [
      "Tracked-file patch is captured for review. Restore flow still requires an explicit destructive confirmation step.",
      ...diagnostics,
    ],
  };
}

async function createPatchBackedCheckpoint(params: {
  rootPath: string;
  name: string;
  sessionIds: string[];
  sessionAttributions: LocalAdeCheckpointSessionAttribution[];
  restoreMode: LocalAdeCheckpoint["restoreMode"];
  safetyForCheckpointId: string;
  patch: string;
  changedFiles: string[];
  statusLines: string[];
  diagnostics: string[];
}): Promise<LocalAdeCheckpoint> {
  const rootPath = params.rootPath;
  const id = `checkpoint-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const patchDir = path.join(ensureProjectDataDir(rootPath), CHECKPOINT_PATCH_DIR);
  await mkdir(patchDir, { recursive: true });
  const patchPath = path.join(patchDir, `${id}.patch`);
  let gitHead: string | undefined;
  const diagnostics = [...params.diagnostics];

  try {
    gitHead = (await runGit(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
  } catch (error) {
    diagnostics.push(
      `Git HEAD capture failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  await writeFile(patchPath, params.patch, "utf8");
  const patchBytes = Buffer.byteLength(params.patch, "utf8");

  return {
    id,
    name: params.name.trim() || `Checkpoint ${createdAt}`,
    createdAt,
    projectRoot: rootPath,
    sessionIds: params.sessionIds,
    sessionAttributions: params.sessionAttributions,
    ...(gitHead ? { gitHead } : {}),
    changedFiles: params.changedFiles.map(normalizeSlash),
    statusLines: params.statusLines,
    restoreMode: params.restoreMode,
    safetyForCheckpointId: params.safetyForCheckpointId,
    patchPath,
    patchBytes,
    canRestore: patchBytes > 0,
    diagnostics: [
      "Tracked-file patch is captured for review. Restore flow still requires an explicit destructive confirmation step.",
      ...diagnostics,
    ],
  };
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkpointRestoreToken(checkpoint: LocalAdeCheckpoint): string {
  return `RESTORE ${checkpoint.id.slice(0, 8)}`;
}

function checkpointStatusPath(line: string): string {
  const value = normalizeSlash(line.slice(3).trim());
  if (value.includes(" -> ")) {
    return value.split(" -> ").at(-1)?.trim() ?? value;
  }
  return value;
}

function isCheckpointInternalStatusLine(line: string): boolean {
  const normalized = checkpointStatusPath(line);
  return (
    normalized === ".eragear/" ||
    normalized === ".eragear/checkpoints.json" ||
    normalized.startsWith(".eragear/checkpoints/") ||
    normalized.startsWith(".eragear/checkpoint-shelves/")
  );
}

function normalizedLines(lines: string[]): string[] {
  return lines
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !isCheckpointInternalStatusLine(line))
    .sort();
}

function equalLineSets(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizedLines(left);
  const normalizedRight = normalizedLines(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((line, index) => line === normalizedRight[index]);
}

function statusLinesByFile(lines: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const line of lines.map((item) => item.trimEnd()).filter(Boolean)) {
    if (isCheckpointInternalStatusLine(line)) {
      continue;
    }
    const file = checkpointStatusPath(line);
    const list = result.get(file) ?? [];
    list.push(line);
    result.set(file, list);
  }
  return result;
}

async function readPluginWorkspaceStatus(rootPath: string): Promise<{
  statusLines: string[];
  diagnostics: string[];
}> {
  try {
    return {
      statusLines: normalizedLines(await readGitStatusLines(rootPath)).slice(
        0,
        MAX_PLUGIN_WORKSPACE_STATUS_LINES
      ),
      diagnostics: [],
    };
  } catch (error) {
    return {
      statusLines: [],
      diagnostics: [`Plugin workspace git status failed: ${errorMessage(error)}`],
    };
  }
}

function pluginWorkspaceChangedFiles(before: string[], after: string[]): string[] {
  const beforeByFile = statusLinesByFile(before);
  const afterByFile = statusLinesByFile(after);
  const files = new Set<string>([...beforeByFile.keys(), ...afterByFile.keys()]);
  return [...files]
    .filter((file) => {
      const beforeStatus = statusListText(beforeByFile.get(file)) ?? "";
      const afterStatus = statusListText(afterByFile.get(file)) ?? "";
      return beforeStatus !== afterStatus;
    })
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_PLUGIN_WORKSPACE_CHANGED_FILES);
}

function statusListText(lines: string[] | undefined): string | undefined {
  if (!lines || lines.length === 0) {
    return undefined;
  }
  return lines.join("; ");
}

function normalizeCheckpointRestoreFiles(files: string[]): string[] {
  const normalized = new Set<string>();
  for (const file of files) {
    const value = normalizeSlash(file.trim());
    if (
      !value ||
      value.startsWith("/") ||
      path.isAbsolute(value) ||
      value.split("/").includes("..") ||
      value.includes("\0")
    ) {
      throw new Error(`Invalid checkpoint restore file path: ${file}`);
    }
    normalized.add(value);
  }
  const result = [...normalized].sort();
  if (result.length === 0) {
    throw new Error("Select at least one checkpoint file to restore.");
  }
  if (result.length > MAX_CHECKPOINT_RESTORE_FILES) {
    throw new Error(
      `Select ${MAX_CHECKPOINT_RESTORE_FILES} files or fewer for one restore.`
    );
  }
  return result;
}

function isShelvableCheckpointConflictRisk(
  risk: LocalAdeCheckpointPreview["restoreRisks"][number] | undefined
): boolean {
  if (!risk || risk.level !== "blocked") {
    return false;
  }
  const currentStatusLines = (risk.currentStatus ?? "")
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    risk.patchAction === "unexpected current change" &&
    currentStatusLines.length > 0 &&
    currentStatusLines.every((line) => line.startsWith("?? ")) &&
    risk.reason.includes("not part of the restore precondition")
  );
}

function isResolvableTrackedCheckpointConflictRisk(
  risk: LocalAdeCheckpointPreview["restoreRisks"][number] | undefined
): boolean {
  if (!risk || risk.level !== "blocked") {
    return false;
  }
  const currentStatusLines = (risk.currentStatus ?? "")
    .split(";")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  return (
    risk.reason.includes("Tracked checkpoint patch no longer applies cleanly") &&
    currentStatusLines.length > 0 &&
    currentStatusLines.every((line) => line.startsWith(" M "))
  );
}

async function shelveCheckpointConflictFiles(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  files: string[];
  risks: LocalAdeCheckpointPreview["restoreRisks"];
}): Promise<NonNullable<LocalAdeCheckpoint["conflictShelves"]>[number]> {
  const risksByFile = new Map(params.risks.map((risk) => [risk.file, risk]));
  const files = normalizeCheckpointRestoreFiles(params.files);
  const unsupported = files.filter(
    (file) => !isShelvableCheckpointConflictRisk(risksByFile.get(file))
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Only unexpected untracked checkpoint blockers can be shelved automatically: ${unsupported.join(
        ", "
      )}`
    );
  }

  for (const file of files) {
    if (
      file === ".git" ||
      file.startsWith(".git/") ||
      file === ".eragear" ||
      file.startsWith(".eragear/")
    ) {
      throw new Error(`Checkpoint conflict shelf cannot move internal path: ${file}`);
    }
  }

  const shelfId = `shelf-${params.checkpoint.id.slice(11, 19)}-${randomUUID()}`;
  const shelfRoot = path.join(
    ensureProjectDataDir(params.rootPath),
    CHECKPOINT_SHELF_DIR,
    shelfId
  );
  const moved: Array<{ from: string; to: string }> = [];

  try {
    for (const file of files) {
      const from = path.resolve(params.rootPath, file);
      if (!isPathInside(params.rootPath, from) || !existsSync(from)) {
        throw new Error(`Checkpoint blocker is no longer present: ${file}`);
      }
      const to = path.resolve(shelfRoot, file);
      if (!isPathInside(shelfRoot, to) || existsSync(to)) {
        throw new Error(`Checkpoint shelf destination is not safe for: ${file}`);
      }
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
      moved.push({ from, to });
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        if (!existsSync(item.from) && existsSync(item.to)) {
          await mkdir(path.dirname(item.from), { recursive: true });
          await rename(item.to, item.from);
        }
      } catch {
        // Best-effort rollback; the original error is more useful to surface.
      }
    }
    throw new Error(`Checkpoint conflict shelve failed: ${errorMessage(error)}`);
  }

  await writeFile(
    path.join(shelfRoot, "manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        checkpointId: params.checkpoint.id,
        shelvedAt: new Date().toISOString(),
        files,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    shelvedAt: new Date().toISOString(),
    files,
    shelfPath: shelfRoot,
    reason:
      "Unexpected untracked restore blockers were moved aside before checkpoint restore.",
  };
}

interface NormalizedCheckpointHunkSelection {
  file: string;
  hunkIndex: number;
}

interface SelectedCheckpointHunkPatch {
  files: string[];
  patch: string;
  hunks: Array<{
    file: string;
    hunkIndex: number;
    header: string;
  }>;
}

function checkpointRestoreHunkKey(selection: NormalizedCheckpointHunkSelection): string {
  return `${selection.file}:${selection.hunkIndex}`;
}

function normalizeCheckpointRestoreHunks(
  hunks: RestoreCheckpointHunkInput[]
): NormalizedCheckpointHunkSelection[] {
  const normalized = new Map<string, NormalizedCheckpointHunkSelection>();
  for (const hunk of hunks) {
    const [file] = normalizeCheckpointRestoreFiles([hunk.file]);
    if (!file) {
      throw new Error(`Invalid checkpoint restore file path: ${hunk.file}`);
    }
    if (!Number.isInteger(hunk.hunkIndex) || hunk.hunkIndex < 0) {
      throw new Error(`Invalid checkpoint hunk index for ${hunk.file}: ${hunk.hunkIndex}`);
    }
    const selection = { file, hunkIndex: hunk.hunkIndex };
    normalized.set(checkpointRestoreHunkKey(selection), selection);
  }
  const result = [...normalized.values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.hunkIndex - right.hunkIndex
  );
  if (result.length === 0) {
    throw new Error("Select at least one checkpoint hunk to restore.");
  }
  if (result.length > MAX_CHECKPOINT_RESTORE_HUNKS) {
    throw new Error(
      `Select ${MAX_CHECKPOINT_RESTORE_HUNKS} hunks or fewer for one restore.`
    );
  }
  return result;
}

function filterStatusLinesByFiles(lines: string[], files: string[]): string[] {
  const selected = new Set(files.map(normalizeSlash));
  return lines.filter((line) => selected.has(checkpointStatusPath(line)));
}

function filterStatusLinesExcludingFiles(lines: string[], files: string[]): string[] {
  const excluded = new Set(files.map(normalizeSlash));
  if (excluded.size === 0) {
    return lines;
  }
  return lines.filter((line) => !excluded.has(checkpointStatusPath(line)));
}

function checkpointCurrentResolutionFiles(checkpoint: LocalAdeCheckpoint): string[] {
  const files = new Set<string>();
  for (const restore of checkpoint.partialRestores ?? []) {
    if (restore.resolution !== "current" && restore.resolution !== "mixed") {
      continue;
    }
    for (const file of restore.files) {
      files.add(normalizeSlash(file));
    }
  }
  return [...files].sort();
}

function checkpointPatchAction(
  statusLines: string[] | undefined,
  restoreMode: LocalAdeCheckpoint["restoreMode"]
): string {
  const status = statusLines?.[0] ?? "";
  if (status.startsWith("?? ")) {
    return "untracked metadata only";
  }
  const code = status.slice(0, 2);
  const mode = restoreMode ?? "reverse-patch";
  if (mode === "apply-patch") {
    if (code.includes("A")) {
      return "apply added file";
    }
    if (code.includes("D")) {
      return "apply deletion";
    }
    return "apply tracked changes";
  }
  if (code.includes("A")) {
    return "remove added file";
  }
  if (code.includes("D")) {
    return "restore deleted file";
  }
  return "revert tracked changes";
}

function compareStatusLists(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = [...(left ?? [])].sort();
  const normalizedRight = [...(right ?? [])].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((line, index) => line === normalizedRight[index])
  );
}

async function checkCheckpointPatchForFiles(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  patch: string;
  files: string[];
}): Promise<string | null> {
  let selectedPatch = "";
  try {
    selectedPatch = filterCheckpointPatchByFiles(params.patch, params.files);
  } catch (error) {
    return errorMessage(error);
  }

  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "eragear-checkpoint-check-")
  );
  const patchPath = path.join(tempDir, "selected.patch");
  try {
    await writeFile(patchPath, selectedPatch, "utf8");
    const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
    await runGit(
      params.rootPath,
      restoreMode === "apply-patch"
        ? ["apply", "--check", patchPath]
        : ["apply", "--check", "-R", patchPath]
    );
    return null;
  } catch (error) {
    return errorMessage(error);
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function collectCheckpointRestoreRisks(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  patch: string;
}): Promise<LocalAdeCheckpointPreview["restoreRisks"]> {
  const expectedStatusLines =
    params.checkpoint.restoreStatusLines ?? params.checkpoint.statusLines;
  const expectedByFile = statusLinesByFile(expectedStatusLines);
  let currentByFile = new Map<string, string[]>();
  let currentStatusError: string | null = null;
  try {
    const currentStatusLines = (await runGit(params.rootPath, ["status", "--short"]))
      .stdout.split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    currentByFile = statusLinesByFile(currentStatusLines);
  } catch (error) {
    currentStatusError = error instanceof Error ? error.message : String(error);
  }

  const files = new Set<string>([
    ...params.checkpoint.changedFiles.map(normalizeSlash),
    ...expectedByFile.keys(),
    ...currentByFile.keys(),
    ...checkpointCurrentResolutionFiles(params.checkpoint),
  ]);
  const patchFiles = new Set(
    splitCheckpointPatchSections(params.patch).flatMap((section) =>
      checkpointPatchSectionFiles(section)
    )
  );
  const currentResolutionFiles = new Set(
    checkpointCurrentResolutionFiles(params.checkpoint)
  );
  const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
  const risks: LocalAdeCheckpointPreview["restoreRisks"] = [];
  for (const file of [...files].sort()) {
    const expected = expectedByFile.get(file);
    const current = currentByFile.get(file);
    const patchAction = checkpointPatchAction(expected, restoreMode);
    if (currentResolutionFiles.has(file)) {
      risks.push({
        file,
        level: "warning",
        patchAction: "keep current content",
        ...(statusListText(expected) ? { checkpointStatus: statusListText(expected) } : {}),
        ...(statusListText(current) ? { currentStatus: statusListText(current) } : {}),
        reason:
          "This tracked checkpoint conflict was resolved by keeping the current workspace content; full restore will omit this file.",
      });
      continue;
    }
    if (currentStatusError) {
      risks.push({
        file,
        level: "blocked",
        patchAction,
        ...(statusListText(expected) ? { checkpointStatus: statusListText(expected) } : {}),
        reason: `Could not read current Git status: ${currentStatusError}`,
      });
      continue;
    }
    if (expected?.some((line) => line.startsWith("?? "))) {
      risks.push({
        file,
        level: "warning",
        patchAction,
        checkpointStatus: statusListText(expected),
        ...(statusListText(current) ? { currentStatus: statusListText(current) } : {}),
        reason:
          "This file was untracked metadata at checkpoint time; checkpoint patches do not contain untracked file contents.",
      });
      continue;
    }
    if (!expected && current) {
      risks.push({
        file,
        level: "blocked",
        patchAction: "unexpected current change",
        currentStatus: statusListText(current),
        reason:
          "This file changed after the checkpoint and is not part of the restore precondition.",
      });
      continue;
    }
    if (expected && !current) {
      risks.push({
        file,
        level: "blocked",
        patchAction,
        checkpointStatus: statusListText(expected),
        reason:
          "Current workspace no longer has the checkpoint-time change for this file.",
      });
      continue;
    }
    if (!compareStatusLists(expected, current)) {
      risks.push({
        file,
        level: "blocked",
        patchAction,
        checkpointStatus: statusListText(expected),
        currentStatus: statusListText(current),
        reason:
          "Current file status differs from the checkpoint restore precondition.",
      });
      continue;
    }

    if (patchFiles.has(file)) {
      const patchError = await checkCheckpointPatchForFiles({
        rootPath: params.rootPath,
        checkpoint: params.checkpoint,
        patch: params.patch,
        files: [file],
      });
      if (patchError) {
        risks.push({
          file,
          level: "blocked",
          patchAction,
          ...(statusListText(expected)
            ? { checkpointStatus: statusListText(expected) }
            : {}),
          ...(statusListText(current) ? { currentStatus: statusListText(current) } : {}),
          reason: `Tracked checkpoint patch no longer applies cleanly for this file: ${patchError}`,
        });
        continue;
      }
    }

    risks.push({
      file,
      level: "safe",
      patchAction,
      ...(statusListText(expected) ? { checkpointStatus: statusListText(expected) } : {}),
      ...(statusListText(current) ? { currentStatus: statusListText(current) } : {}),
      reason: "Current status matches the checkpoint restore precondition.",
    });
  }
  return risks;
}

async function collectCheckpointRestoreBlockers(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  patchPath: string;
}): Promise<Array<{ file: string; reason: string }>> {
  const blockers: Array<{ file: string; reason: string }> = [];
  const serviceFile = "apps/server/src/modules/settings/application/local-ade.service.ts";
  const currentResolutionFiles = checkpointCurrentResolutionFiles(params.checkpoint);

  if (!params.checkpoint.canRestore || params.checkpoint.patchBytes <= 0) {
    blockers.push({
      file: serviceFile,
      reason: "Checkpoint has no tracked-file patch to restore.",
    });
  }
  if (params.checkpoint.restoredAt) {
    blockers.push({
      file: serviceFile,
      reason: `Checkpoint was already restored at ${params.checkpoint.restoredAt}.`,
    });
  }

  try {
    const currentHead = (await runGit(params.rootPath, ["rev-parse", "HEAD"])).stdout.trim();
    if (params.checkpoint.gitHead && currentHead !== params.checkpoint.gitHead) {
      blockers.push({
        file: serviceFile,
        reason:
          "Current Git HEAD differs from the checkpoint HEAD; restore is blocked to avoid applying a stale reverse patch.",
      });
    }
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Could not verify Git HEAD: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  try {
    const statusLines = (await runGit(params.rootPath, ["status", "--short"])).stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const expectedStatusLines =
      params.checkpoint.restoreStatusLines ?? params.checkpoint.statusLines;
    const comparableStatusLines = filterStatusLinesExcludingFiles(
      statusLines,
      currentResolutionFiles
    );
    const comparableExpectedStatusLines = filterStatusLinesExcludingFiles(
      expectedStatusLines,
      currentResolutionFiles
    );
    if (!equalLineSets(comparableStatusLines, comparableExpectedStatusLines)) {
      blockers.push({
        file: serviceFile,
        reason:
          "Current workspace status differs from the checkpoint restore precondition; restore is blocked until changes are reviewed or a new checkpoint is created.",
      });
    }
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Could not verify workspace status: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  let checkPatchPath = params.patchPath;
  let tempPatchPath: string | null = null;
  try {
    if (currentResolutionFiles.length > 0) {
      const rawPatch = await readFile(params.patchPath, "utf8");
      const filteredPatch = filterCheckpointPatchExcludingFiles(
        rawPatch,
        currentResolutionFiles
      );
      if (!filteredPatch.trim()) {
        blockers.push({
          file: serviceFile,
          reason:
            "Checkpoint restore has no remaining tracked patch after keeping current conflict files.",
        });
        return blockers;
      }
      tempPatchPath = path.join(
        ensureProjectDataDir(params.rootPath),
        CHECKPOINT_PATCH_DIR,
        `${params.checkpoint.id}.current-resolution-${randomUUID()}.patch`
      );
      await writeFile(tempPatchPath, filteredPatch, "utf8");
      checkPatchPath = tempPatchPath;
    }
    const mode = params.checkpoint.restoreMode ?? "reverse-patch";
    await runGit(
      params.rootPath,
      mode === "apply-patch"
        ? ["apply", "--check", checkPatchPath]
        : ["apply", "--check", "-R", checkPatchPath]
    );
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Reverse patch check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  } finally {
    if (tempPatchPath) {
      await rm(tempPatchPath, { force: true }).catch(() => undefined);
    }
  }

  return blockers;
}

async function collectSelectedCheckpointRestoreBlockers(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  patchPath: string;
  files: string[];
}): Promise<Array<{ file: string; reason: string }>> {
  const blockers: Array<{ file: string; reason: string }> = [];
  const serviceFile = "apps/server/src/modules/settings/application/local-ade.service.ts";
  const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";

  if (!params.checkpoint.canRestore || params.checkpoint.patchBytes <= 0) {
    blockers.push({
      file: serviceFile,
      reason: "Checkpoint has no tracked-file patch to restore.",
    });
  }
  if (params.checkpoint.restoredAt) {
    blockers.push({
      file: serviceFile,
      reason: `Checkpoint was already fully restored at ${params.checkpoint.restoredAt}.`,
    });
  }

  try {
    const currentHead = (await runGit(params.rootPath, ["rev-parse", "HEAD"])).stdout.trim();
    if (params.checkpoint.gitHead && currentHead !== params.checkpoint.gitHead) {
      blockers.push({
        file: serviceFile,
        reason:
          "Current Git HEAD differs from the checkpoint HEAD; selected restore is blocked to avoid applying a stale patch.",
      });
    }
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Could not verify Git HEAD: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  try {
    const currentStatusLines = await readGitStatusLines(params.rootPath);
    const expectedStatusLines =
      params.checkpoint.restoreStatusLines ?? params.checkpoint.statusLines;
    const expectedByFile = statusLinesByFile(expectedStatusLines);
    const currentByFile = statusLinesByFile(currentStatusLines);
    for (const file of params.files) {
      const expected = expectedByFile.get(file);
      const current = currentByFile.get(file);
      if (expected?.some((line) => line.startsWith("?? "))) {
        blockers.push({
          file,
          reason:
            "This file was untracked metadata at checkpoint time; checkpoint patches do not contain untracked file contents.",
        });
        continue;
      }
      if (current && !expected) {
        blockers.push({
          file,
          reason:
            "Current file status differs from the selected checkpoint restore precondition.",
        });
        continue;
      }
      if (expected && !current) {
        blockers.push({
          file,
          reason:
            "Current workspace no longer has the selected checkpoint-time change for this file.",
        });
        continue;
      }
      if (!compareStatusLists(expected, current)) {
        blockers.push({
          file,
          reason:
            "Current file status differs from the selected checkpoint restore precondition.",
        });
      }
    }
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Could not verify selected workspace status: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  try {
    await runGit(
      params.rootPath,
      restoreMode === "apply-patch"
        ? ["apply", "--check", params.patchPath]
        : ["apply", "--check", "-R", params.patchPath]
    );
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Selected patch check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  return blockers;
}

function stripDiffPathPrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") {
    return trimmed;
  }
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return normalizeSlash(trimmed.slice(2));
  }
  return normalizeSlash(trimmed);
}

function diffFileStatus(file: LocalAdeCheckpointDiffFile): LocalAdeCheckpointDiffFile["status"] {
  if (file.isBinary) {
    return "binary";
  }
  if (file.oldPath === "/dev/null") {
    return "added";
  }
  if (file.newPath === "/dev/null") {
    return "deleted";
  }
  if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return "renamed";
  }
  if (file.additions > 0 || file.deletions > 0) {
    return "modified";
  }
  return "unknown";
}

function checkpointPatchSectionFiles(lines: string[]): string[] {
  const files = new Set<string>();
  const firstLine = lines[0] ?? "";
  const diffMatch = /^diff --git\s+(.+?)\s+(.+)$/.exec(firstLine);
  if (diffMatch) {
    files.add(stripDiffPathPrefix(diffMatch[1] ?? ""));
    files.add(stripDiffPathPrefix(diffMatch[2] ?? ""));
  }
  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const file = stripDiffPathPrefix(line.slice(4));
      if (file !== "/dev/null") {
        files.add(file);
      }
    }
  }
  return [...files].filter((file) => file && file !== "/dev/null");
}

function splitCheckpointPatchSections(patch: string): string[][] {
  const sections: string[][] = [];
  let currentSection: string[] = [];

  const finishSection = () => {
    if (currentSection.length > 0) {
      sections.push(currentSection);
    }
    currentSection = [];
  };

  for (const line of patch.split(/\r?\n/)) {
    if (/^diff --git\s+/.test(line)) {
      finishSection();
    }
    if (currentSection.length > 0 || /^diff --git\s+/.test(line)) {
      currentSection.push(line);
    }
  }
  finishSection();
  return sections;
}

function filterCheckpointPatchByFiles(patch: string, files: string[]): string {
  const selected = new Set(files.map(normalizeSlash));
  const filtered = splitCheckpointPatchSections(patch)
    .filter((section) => {
      const sectionFiles = checkpointPatchSectionFiles(section);
      return sectionFiles.some((file) => selected.has(file));
    })
    .map((section) => section.join("\n").trimEnd())
    .filter(Boolean)
    .join("\n");
  if (!filtered) {
    throw new Error(
      `Selected checkpoint files are not present in the tracked patch: ${files.join(
        ", "
      )}`
    );
  }
  return `${filtered}\n`;
}

function filterCheckpointPatchExcludingFiles(patch: string, files: string[]): string {
  const excluded = new Set(files.map(normalizeSlash));
  if (excluded.size === 0) {
    return patch;
  }
  const filtered = splitCheckpointPatchSections(patch)
    .filter((section) => {
      const sectionFiles = checkpointPatchSectionFiles(section);
      return !sectionFiles.some((file) => excluded.has(file));
    })
    .map((section) => section.join("\n").trimEnd())
    .filter(Boolean)
    .join("\n");
  return filtered ? `${filtered}\n` : "";
}

function selectCheckpointPatchHunks(
  patch: string,
  selections: NormalizedCheckpointHunkSelection[]
): SelectedCheckpointHunkPatch {
  const selectionsByFile = new Map<string, NormalizedCheckpointHunkSelection[]>();
  for (const selection of selections) {
    const list = selectionsByFile.get(selection.file) ?? [];
    list.push(selection);
    selectionsByFile.set(selection.file, list);
  }

  const selectedSections: string[] = [];
  const selectedHunks: SelectedCheckpointHunkPatch["hunks"] = [];
  const matchedKeys = new Set<string>();

  for (const section of splitCheckpointPatchSections(patch)) {
    const sectionFiles = checkpointPatchSectionFiles(section);
    const sectionSelections = sectionFiles
      .flatMap((file) => selectionsByFile.get(file) ?? [])
      .sort(
        (left, right) =>
          left.hunkIndex - right.hunkIndex || left.file.localeCompare(right.file)
      );
    if (sectionSelections.length === 0) {
      continue;
    }

    const prelude: string[] = [];
    const hunkBlocks: string[][] = [];
    let currentHunk: string[] | null = null;
    for (const line of section) {
      if (/^@@\s+/.test(line)) {
        if (currentHunk) {
          hunkBlocks.push(currentHunk);
        }
        currentHunk = [line];
        continue;
      }
      if (currentHunk) {
        currentHunk.push(line);
      } else {
        prelude.push(line);
      }
    }
    if (currentHunk) {
      hunkBlocks.push(currentHunk);
    }

    const selectedBlocks: string[][] = [];
    const addedHunkIndexes = new Set<number>();
    for (const selection of sectionSelections) {
      const block = hunkBlocks[selection.hunkIndex];
      if (!block) {
        continue;
      }
      const key = checkpointRestoreHunkKey(selection);
      matchedKeys.add(key);
      selectedHunks.push({
        file: selection.file,
        hunkIndex: selection.hunkIndex,
        header: block[0] ?? "",
      });
      if (!addedHunkIndexes.has(selection.hunkIndex)) {
        selectedBlocks.push(block);
        addedHunkIndexes.add(selection.hunkIndex);
      }
    }

    if (selectedBlocks.length > 0) {
      selectedSections.push(
        [...prelude, ...selectedBlocks.flat()].join("\n").trimEnd()
      );
    }
  }

  const missingSelections = selections.filter(
    (selection) => !matchedKeys.has(checkpointRestoreHunkKey(selection))
  );
  if (missingSelections.length > 0) {
    throw new Error(
      `Selected checkpoint hunks are not present in the tracked patch: ${missingSelections
        .map((selection) => `${selection.file}#${selection.hunkIndex}`)
        .join(", ")}`
    );
  }

  const filteredPatch = selectedSections.filter(Boolean).join("\n");
  if (!filteredPatch) {
    throw new Error("Selected checkpoint hunks did not produce a restorable patch.");
  }

  return {
    files: [...new Set(selectedHunks.map((hunk) => hunk.file))].sort(),
    patch: `${filteredPatch}\n`,
    hunks: selectedHunks.sort(
      (left, right) => left.file.localeCompare(right.file) || left.hunkIndex - right.hunkIndex
    ),
  };
}

function pushDiffRow(
  file: LocalAdeCheckpointDiffFile,
  hunk: LocalAdeCheckpointDiffHunk,
  row: LocalAdeCheckpointDiffRow
): void {
  if (file.truncated || hunk.truncated) {
    return;
  }
  const rowCount = file.hunks.reduce((sum, item) => sum + item.rows.length, 0);
  if (rowCount >= MAX_CHECKPOINT_DIFF_ROWS_PER_FILE) {
    file.truncated = true;
    hunk.truncated = true;
    return;
  }
  hunk.rows.push(row);
}

function parseCheckpointDiff(patch: string): LocalAdeCheckpointDiffFile[] {
  const files: LocalAdeCheckpointDiffFile[] = [];
  let currentFile: LocalAdeCheckpointDiffFile | null = null;
  let currentHunk: LocalAdeCheckpointDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finishFile = () => {
    if (!currentFile) {
      return;
    }
    currentFile.status = diffFileStatus(currentFile);
    currentFile.path =
      currentFile.newPath && currentFile.newPath !== "/dev/null"
        ? currentFile.newPath
        : currentFile.oldPath && currentFile.oldPath !== "/dev/null"
          ? currentFile.oldPath
          : currentFile.path;
    files.push(currentFile);
    currentFile = null;
    currentHunk = null;
  };

  const startFile = (oldPath: string, newPath: string) => {
    finishFile();
    if (files.length >= MAX_CHECKPOINT_DIFF_FILES) {
      return;
    }
    const oldClean = stripDiffPathPrefix(oldPath);
    const newClean = stripDiffPathPrefix(newPath);
    currentFile = {
      path: newClean !== "/dev/null" ? newClean : oldClean,
      oldPath: oldClean,
      newPath: newClean,
      status: "unknown",
      isBinary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
      truncated: false,
    };
    currentHunk = null;
  };

  const lines = patch.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const diffMatch = /^diff --git\s+(.+?)\s+(.+)$/.exec(line);
    if (diffMatch) {
      startFile(diffMatch[1] ?? "", diffMatch[2] ?? "");
      continue;
    }
    const file = currentFile as LocalAdeCheckpointDiffFile | null;
    if (!file) {
      continue;
    }
    if (line.startsWith("--- ")) {
      file.oldPath = stripDiffPathPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      file.newPath = stripDiffPathPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      file.isBinary = true;
      continue;
    }
    const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/.exec(
      line
    );
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      currentHunk = {
        header: line,
        oldStart: oldLine,
        newStart: newLine,
        rows: [],
        truncated: false,
      };
      file.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) {
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      pushDiffRow(file, currentHunk, {
        kind: "meta",
        oldText: line,
        newText: line,
      });
      continue;
    }
    if (line.startsWith(" ")) {
      const text = line.slice(1);
      pushDiffRow(file, currentHunk, {
        kind: "context",
        oldLine,
        newLine,
        oldText: text,
        newText: text,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      const oldText = line.slice(1);
      const next = lines[index + 1] ?? "";
      if (next.startsWith("+") && !next.startsWith("+++ ")) {
        const nextText = next.slice(1);
        pushDiffRow(file, currentHunk, {
          kind: "change",
          oldLine,
          newLine,
          oldText,
          newText: nextText,
        });
        file.deletions += 1;
        file.additions += 1;
        oldLine += 1;
        newLine += 1;
        index += 1;
      } else {
        pushDiffRow(file, currentHunk, {
          kind: "delete",
          oldLine,
          oldText,
        });
        file.deletions += 1;
        oldLine += 1;
      }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      pushDiffRow(file, currentHunk, {
        kind: "add",
        newLine,
        newText: line.slice(1),
      });
      file.additions += 1;
      newLine += 1;
    }
  }

  finishFile();
  return files.slice(0, MAX_CHECKPOINT_DIFF_FILES);
}

async function readCheckpointPreview(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
}): Promise<LocalAdeCheckpointPreview> {
  const patchDir = path.join(ensureProjectDataDir(params.rootPath), CHECKPOINT_PATCH_DIR);
  const resolvedPatchPath = path.resolve(params.checkpoint.patchPath);
  if (!isPathInside(patchDir, resolvedPatchPath)) {
    throw new Error(
      `Checkpoint patch is outside the project checkpoint directory: ${params.checkpoint.patchPath}`
    );
  }

  let rawPatch = "";
  try {
    rawPatch = await readFile(resolvedPatchPath, "utf8");
  } catch (error) {
    throw new Error(
      `Checkpoint patch could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const restoreBlockers = await collectCheckpointRestoreBlockers({
    rootPath: params.rootPath,
    checkpoint: params.checkpoint,
    patchPath: resolvedPatchPath,
  });
  const restoreRisks = await collectCheckpointRestoreRisks({
    rootPath: params.rootPath,
    checkpoint: params.checkpoint,
    patch: rawPatch,
  });

  return {
    checkpointId: params.checkpoint.id,
    name: params.checkpoint.name,
    restoreMode: params.checkpoint.restoreMode ?? "reverse-patch",
    patchPath: resolvedPatchPath,
    patchBytes: params.checkpoint.patchBytes,
    preview: rawPatch.slice(0, MAX_CHECKPOINT_PREVIEW_BYTES),
    truncated: rawPatch.length > MAX_CHECKPOINT_PREVIEW_BYTES,
    restoreToken: checkpointRestoreToken(params.checkpoint),
    canRestore: restoreBlockers.length === 0,
    changedFiles: params.checkpoint.changedFiles,
    statusLines: params.checkpoint.statusLines,
    sessionAttributions: params.checkpoint.sessionAttributions,
    diffFiles: parseCheckpointDiff(rawPatch),
    diagnostics: params.checkpoint.diagnostics,
    restoreBlockers,
    restoreRisks,
  };
}

async function buildSelectedCheckpointHunkPatch(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  hunks: RestoreCheckpointHunkInput[];
}): Promise<SelectedCheckpointHunkPatch> {
  const patchDir = path.join(ensureProjectDataDir(params.rootPath), CHECKPOINT_PATCH_DIR);
  const resolvedPatchPath = path.resolve(params.checkpoint.patchPath);
  if (!isPathInside(patchDir, resolvedPatchPath)) {
    throw new Error(
      `Checkpoint patch is outside the project checkpoint directory: ${params.checkpoint.patchPath}`
    );
  }
  const selections = normalizeCheckpointRestoreHunks(params.hunks);
  const rawPatch = await readFile(resolvedPatchPath, "utf8");
  return selectCheckpointPatchHunks(rawPatch, selections);
}

function buildCheckpointTrackedConflictHunkChoices(params: {
  diffFiles: LocalAdeCheckpointDiffFile[];
  selectedPatch: SelectedCheckpointHunkPatch;
}): NonNullable<
  NonNullable<LocalAdeCheckpoint["partialRestores"]>[number]["hunkChoices"]
> {
  const selected = new Set(
    params.selectedPatch.hunks.map((hunk) =>
      checkpointRestoreHunkKey({
        file: hunk.file,
        hunkIndex: hunk.hunkIndex,
      })
    )
  );
  const files = new Set(params.selectedPatch.files);
  const choices: NonNullable<
    NonNullable<LocalAdeCheckpoint["partialRestores"]>[number]["hunkChoices"]
  > = [];

  for (const file of params.diffFiles) {
    if (!files.has(file.path)) {
      continue;
    }
    file.hunks.forEach((hunk, hunkIndex) => {
      const key = checkpointRestoreHunkKey({ file: file.path, hunkIndex });
      choices.push({
        file: file.path,
        hunkIndex,
        header: hunk.header,
        resolution: selected.has(key) ? "restore" : "current",
      });
    });
  }

  const missingFiles = [...files].filter(
    (file) => !choices.some((choice) => choice.file === file)
  );
  if (missingFiles.length > 0) {
    throw new Error(
      `Selected checkpoint conflict hunks are not present in the preview: ${missingFiles.join(
        ", "
      )}`
    );
  }
  if (!choices.some((choice) => choice.resolution === "current")) {
    throw new Error(
      "Hunk-level conflict resolution requires at least one unselected hunk to keep current."
    );
  }

  return choices.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.hunkIndex - right.hunkIndex
  );
}

async function restoreGitCheckpoint(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  confirmation: string;
}): Promise<LocalAdeCheckpoint> {
  const patchDir = path.join(ensureProjectDataDir(params.rootPath), CHECKPOINT_PATCH_DIR);
  const resolvedPatchPath = path.resolve(params.checkpoint.patchPath);
  if (!isPathInside(patchDir, resolvedPatchPath)) {
    throw new Error(
      `Checkpoint patch is outside the project checkpoint directory: ${params.checkpoint.patchPath}`
    );
  }
  const expectedConfirmation = checkpointRestoreToken(params.checkpoint);
  if (params.confirmation.trim() !== expectedConfirmation) {
    throw new Error(`Type '${expectedConfirmation}' to restore this checkpoint.`);
  }
  const blockers = await collectCheckpointRestoreBlockers({
    rootPath: params.rootPath,
    checkpoint: params.checkpoint,
    patchPath: resolvedPatchPath,
  });
  if (blockers.length > 0) {
    throw new Error(blockers.map((blocker) => blocker.reason).join(" "));
  }

  const currentResolutionFiles = checkpointCurrentResolutionFiles(params.checkpoint);
  let applyPatchPath = resolvedPatchPath;
  let tempPatchPath: string | null = null;
  try {
    if (currentResolutionFiles.length > 0) {
      const rawPatch = await readFile(resolvedPatchPath, "utf8");
      const filteredPatch = filterCheckpointPatchExcludingFiles(
        rawPatch,
        currentResolutionFiles
      );
      if (!filteredPatch.trim()) {
        throw new Error(
          "Checkpoint restore has no remaining tracked patch after keeping current conflict files."
        );
      }
      tempPatchPath = path.join(
        patchDir,
        `${params.checkpoint.id}.current-resolution-${randomUUID()}.patch`
      );
      await writeFile(tempPatchPath, filteredPatch, "utf8");
      applyPatchPath = tempPatchPath;
    }
    const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
    await runGit(
      params.rootPath,
      restoreMode === "apply-patch"
        ? ["apply", "--whitespace=nowarn", applyPatchPath]
        : ["apply", "-R", "--whitespace=nowarn", applyPatchPath]
    );
  } finally {
    if (tempPatchPath) {
      await rm(tempPatchPath, { force: true }).catch(() => undefined);
    }
  }
  return {
    ...params.checkpoint,
    restoredAt: new Date().toISOString(),
    canRestore: false,
    diagnostics: [
      `Checkpoint restored by guarded reverse patch at ${new Date().toISOString()}${
        currentResolutionFiles.length > 0
          ? `; kept current content for ${currentResolutionFiles.join(", ")}`
          : ""
      }.`,
      ...params.checkpoint.diagnostics,
    ],
  };
}

async function restoreGitCheckpointFiles(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  confirmation: string;
  files: string[];
}): Promise<{ checkpoint: LocalAdeCheckpoint; safetyCheckpoint?: LocalAdeCheckpoint }> {
  const patchDir = path.join(ensureProjectDataDir(params.rootPath), CHECKPOINT_PATCH_DIR);
  const resolvedPatchPath = path.resolve(params.checkpoint.patchPath);
  if (!isPathInside(patchDir, resolvedPatchPath)) {
    throw new Error(
      `Checkpoint patch is outside the project checkpoint directory: ${params.checkpoint.patchPath}`
    );
  }
  const expectedConfirmation = checkpointRestoreToken(params.checkpoint);
  if (params.confirmation.trim() !== expectedConfirmation) {
    throw new Error(`Type '${expectedConfirmation}' to restore selected files.`);
  }

  const files = normalizeCheckpointRestoreFiles(params.files);
  const rawPatch = await readFile(resolvedPatchPath, "utf8");
  const diffFiles = parseCheckpointDiff(rawPatch);
  const patchFiles = new Set<string>();
  for (const diffFile of diffFiles) {
    patchFiles.add(diffFile.path);
    if (diffFile.oldPath && diffFile.oldPath !== "/dev/null") {
      patchFiles.add(diffFile.oldPath);
    }
    if (diffFile.newPath && diffFile.newPath !== "/dev/null") {
      patchFiles.add(diffFile.newPath);
    }
  }
  const unknownFiles = files.filter((file) => !patchFiles.has(file));
  if (unknownFiles.length > 0) {
    throw new Error(
      `Selected checkpoint files are not present in the tracked patch: ${unknownFiles.join(
        ", "
      )}`
    );
  }

  const selectedPatch = filterCheckpointPatchByFiles(rawPatch, files);
  const selectedPatchPath = path.join(
    patchDir,
    `${params.checkpoint.id}.selected-${randomUUID()}.patch`
  );
  await writeFile(selectedPatchPath, selectedPatch, "utf8");
  try {
    const blockers = await collectSelectedCheckpointRestoreBlockers({
      rootPath: params.rootPath,
      checkpoint: params.checkpoint,
      patchPath: selectedPatchPath,
      files,
    });
    if (blockers.length > 0) {
      throw new Error(blockers.map((blocker) => blocker.reason).join(" "));
    }

    const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
    await runGit(
      params.rootPath,
      restoreMode === "apply-patch"
        ? ["apply", "--whitespace=nowarn", selectedPatchPath]
        : ["apply", "-R", "--whitespace=nowarn", selectedPatchPath]
    );

    const restoredAt = new Date().toISOString();
    return {
      checkpoint: {
        ...params.checkpoint,
        partialRestores: [
          {
            restoredAt,
            files,
          },
          ...(params.checkpoint.partialRestores ?? []),
        ].slice(0, MAX_CHECKPOINTS),
        diagnostics: [
          `Selected checkpoint files restored at ${restoredAt}: ${files.join(", ")}.`,
          ...params.checkpoint.diagnostics,
        ],
      },
    };
  } finally {
    await rm(selectedPatchPath, { force: true }).catch(() => undefined);
  }
}

async function restoreGitCheckpointHunks(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  confirmation: string;
  selectedPatch: SelectedCheckpointHunkPatch;
  partialRestore?: {
    resolution?: "restore" | "current" | "mixed";
    hunkChoices?: NonNullable<
      NonNullable<LocalAdeCheckpoint["partialRestores"]>[number]["hunkChoices"]
    >;
  };
  diagnosticLabel?: string;
}): Promise<{ checkpoint: LocalAdeCheckpoint }> {
  const patchDir = path.join(ensureProjectDataDir(params.rootPath), CHECKPOINT_PATCH_DIR);
  const expectedConfirmation = checkpointRestoreToken(params.checkpoint);
  if (params.confirmation.trim() !== expectedConfirmation) {
    throw new Error(`Type '${expectedConfirmation}' to restore selected hunks.`);
  }

  const selectedPatchPath = path.join(
    patchDir,
    `${params.checkpoint.id}.selected-hunks-${randomUUID()}.patch`
  );
  await writeFile(selectedPatchPath, params.selectedPatch.patch, "utf8");
  try {
    const blockers = await collectSelectedCheckpointRestoreBlockers({
      rootPath: params.rootPath,
      checkpoint: params.checkpoint,
      patchPath: selectedPatchPath,
      files: params.selectedPatch.files,
    });
    if (blockers.length > 0) {
      throw new Error(blockers.map((blocker) => blocker.reason).join(" "));
    }

    const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
    await runGit(
      params.rootPath,
      restoreMode === "apply-patch"
        ? ["apply", "--whitespace=nowarn", selectedPatchPath]
        : ["apply", "-R", "--whitespace=nowarn", selectedPatchPath]
    );

    const restoredAt = new Date().toISOString();
    const diagnosticLabel = params.diagnosticLabel ?? "Selected checkpoint hunks";
    return {
      checkpoint: {
        ...params.checkpoint,
        partialRestores: [
          {
            restoredAt,
            files: params.selectedPatch.files,
            hunks: params.selectedPatch.hunks,
            ...(params.partialRestore?.resolution
              ? { resolution: params.partialRestore.resolution }
              : {}),
            ...(params.partialRestore?.hunkChoices
              ? { hunkChoices: params.partialRestore.hunkChoices }
              : {}),
          },
          ...(params.checkpoint.partialRestores ?? []),
        ].slice(0, MAX_CHECKPOINTS),
        diagnostics: [
          `${diagnosticLabel} restored at ${restoredAt}: ${params.selectedPatch.hunks
            .map((hunk) => `${hunk.file}#${hunk.hunkIndex}`)
            .join(", ")}.`,
          ...params.checkpoint.diagnostics,
        ],
      },
    };
  } finally {
    await rm(selectedPatchPath, { force: true }).catch(() => undefined);
  }
}

function sessionPid(proc: unknown): number | undefined {
  if (isRecord(proc) && typeof proc.pid === "number") {
    return proc.pid;
  }
  return undefined;
}

function createLogLevelCounts(): Record<LogLevel, number> {
  return {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
}

function safeAcpActivityMetadata(
  meta: LogEntry["meta"] | undefined
): Record<string, string | number | boolean | null> {
  if (!meta) {
    return {};
  }
  const allowedKeys = new Set([
    "step",
    "rawType",
    "protocolVersion",
    "hasAgentCapabilities",
    "loadSessionType",
    "sessionId",
    "code",
    "signal",
    "pid",
    "structuredTag",
    "eventType",
    "method",
    "status",
    "reason",
    "toolCallId",
    "turnId",
  ]);
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!allowedKeys.has(key)) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

function acpActivityKind(entry: LogEntry): string | undefined {
  const meta = entry.meta ?? {};
  const rawType = typeof meta.rawType === "string" ? meta.rawType : undefined;
  const step = typeof meta.step === "string" ? meta.step : undefined;
  const method = typeof meta.method === "string" ? meta.method : undefined;
  const eventType =
    typeof meta.eventType === "string" ? meta.eventType : undefined;
  return rawType ?? step ?? method ?? eventType;
}

function acpPayloadBytes(entry: LogEntry): number | undefined {
  const value = entry.meta?.rawPayloadLength;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : undefined;
}

function toVisibleAcpActivityEntry(entry: LogEntry): LocalAdeAcpActivityEntry {
  const kind = acpActivityKind(entry);
  const payloadBytes = acpPayloadBytes(entry);
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    source: entry.source ?? "acp",
    message: entry.message,
    ...(entry.chatId ? { chatId: entry.chatId } : {}),
    ...(kind ? { kind } : {}),
    ...(payloadBytes !== undefined ? { payloadBytes } : {}),
    metadata: safeAcpActivityMetadata(entry.meta),
  };
}

function normalizeAcpTraceExportLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 200;
  }
  return Math.min(
    MAX_ACP_TRACE_EXPORT_ENTRIES,
    Math.max(1, Math.trunc(value))
  );
}

function normalizeAcpReplayPresetName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw new Error("ACP replay preset name is required.");
  }
  return name.slice(0, MAX_ACP_REPLAY_PRESET_NAME_CHARS);
}

function normalizeOptionalReplayFilter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAcpReplayPreset(item: unknown): LocalAdeAcpReplayPreset | null {
  if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
    return null;
  }
  const id = item.id.trim();
  const name = item.name.trim();
  if (!id || !name) {
    return null;
  }
  const limit = normalizeAcpTraceExportLimit(
    typeof item.limit === "number" ? item.limit : undefined
  );
  const createdAt =
    typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString();
  const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : createdAt;
  return {
    id,
    name: name.slice(0, MAX_ACP_REPLAY_PRESET_NAME_CHARS),
    ...(typeof item.chatId === "string" && item.chatId.trim()
      ? { chatId: item.chatId.trim() }
      : {}),
    ...(typeof item.correlationKey === "string" && item.correlationKey.trim()
      ? { correlationKey: item.correlationKey.trim() }
      : {}),
    ...(typeof item.kind === "string" && item.kind.trim()
      ? { kind: item.kind.trim() }
      : {}),
    limit,
    createdAt,
    updatedAt,
    ...(typeof item.lastReplayedAt === "string"
      ? { lastReplayedAt: item.lastReplayedAt }
      : {}),
  };
}

async function readAcpReplayPresetDocument(
  rootPath: string
): Promise<AcpReplayPresetDocument> {
  const parsed = await readJsonObject(
    path.join(ensureProjectDataDir(rootPath), ACP_REPLAY_PRESETS_FILE)
  );
  if (!parsed || !Array.isArray(parsed.presets)) {
    return { version: 1, presets: [] };
  }
  const presets = parsed.presets
    .map((item) => normalizeAcpReplayPreset(item))
    .filter((item): item is LocalAdeAcpReplayPreset => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_ACP_REPLAY_PRESETS);
  return { version: 1, presets };
}

async function writeAcpReplayPresetDocument(
  rootPath: string,
  document: AcpReplayPresetDocument
): Promise<void> {
  const dir = ensureProjectDataDir(rootPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, ACP_REPLAY_PRESETS_FILE),
    `${JSON.stringify(
      {
        version: 1,
        presets: document.presets
          .slice(0, MAX_ACP_REPLAY_PRESETS)
          .map((preset) => ({
            id: preset.id,
            name: preset.name,
            ...(preset.chatId ? { chatId: preset.chatId } : {}),
            ...(preset.correlationKey
              ? { correlationKey: preset.correlationKey }
              : {}),
            ...(preset.kind ? { kind: preset.kind } : {}),
            limit: normalizeAcpTraceExportLimit(preset.limit),
            createdAt: preset.createdAt,
            updatedAt: preset.updatedAt,
            ...(preset.lastReplayedAt
              ? { lastReplayedAt: preset.lastReplayedAt }
              : {}),
          })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function isOwnedAcpLogEntry(params: {
  entry: LogEntry;
  userId: string;
  ownedChatIds: Set<string>;
}): boolean {
  if (params.entry.userId === params.userId) {
    return true;
  }
  if (params.entry.userId && params.entry.userId !== params.userId) {
    return false;
  }
  if (!params.entry.chatId) {
    return true;
  }
  return params.ownedChatIds.has(params.entry.chatId);
}

function acpCorrelationIdentity(entry: LogEntry): {
  key: string;
  label: string;
  chatId?: string;
  sessionId?: string;
  turnId?: string;
} {
  const meta = entry.meta ?? {};
  const sessionId =
    typeof meta.sessionId === "string" && meta.sessionId
      ? meta.sessionId
      : undefined;
  const turnId =
    typeof meta.turnId === "string" && meta.turnId ? meta.turnId : undefined;
  if (turnId) {
    return {
      key: `turn:${turnId}`,
      label: "turn",
      ...(entry.chatId ? { chatId: entry.chatId } : {}),
      ...(sessionId ? { sessionId } : {}),
      turnId,
    };
  }
  if (sessionId) {
    return {
      key: `agent-session:${sessionId}`,
      label: "agent-session",
      ...(entry.chatId ? { chatId: entry.chatId } : {}),
      sessionId,
    };
  }
  if (entry.chatId) {
    return {
      key: `chat:${entry.chatId}`,
      label: "chat",
      chatId: entry.chatId,
    };
  }
  return {
    key: `source:${entry.source ?? "acp"}`,
    label: entry.source ?? "acp",
  };
}

function createAcpActivityCorrelations(
  entries: LogEntry[]
): LocalAdeAcpActivityCorrelation[] {
  const groups = new Map<string, LocalAdeAcpActivityCorrelation>();

  for (const entry of entries) {
    const identity = acpCorrelationIdentity(entry);
    const kind = acpActivityKind(entry);
    const existing = groups.get(identity.key);
    if (!existing) {
      const levels = createLogLevelCounts();
      levels[entry.level] += 1;
      groups.set(identity.key, {
        key: identity.key,
        label: identity.label,
        eventCount: 1,
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        durationMs: 0,
        latestMessage: entry.message,
        latestLevel: entry.level,
        ...(identity.chatId ? { chatId: identity.chatId } : {}),
        ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
        ...(identity.turnId ? { turnId: identity.turnId } : {}),
        levels,
        kinds: kind ? { [kind]: 1 } : {},
      });
      continue;
    }
    existing.eventCount += 1;
    existing.firstTimestamp = Math.min(existing.firstTimestamp, entry.timestamp);
    if (entry.timestamp >= existing.lastTimestamp) {
      existing.lastTimestamp = entry.timestamp;
      existing.latestMessage = entry.message;
      existing.latestLevel = entry.level;
    }
    existing.durationMs = Math.max(
      0,
      existing.lastTimestamp - existing.firstTimestamp
    );
    existing.levels[entry.level] += 1;
    if (kind) {
      existing.kinds[kind] = (existing.kinds[kind] ?? 0) + 1;
    }
  }

  return [...groups.values()]
    .sort((left, right) => right.lastTimestamp - left.lastTimestamp)
    .slice(0, MAX_ACP_ACTIVITY_CORRELATIONS);
}

function acpTimelineLaneIdentity(entry: LogEntry): {
  key: string;
  label: string;
  source: string;
  chatId?: string;
  sessionId?: string;
} {
  const meta = entry.meta ?? {};
  const source = entry.source ?? "acp";
  const sessionId =
    typeof meta.sessionId === "string" && meta.sessionId
      ? meta.sessionId
      : undefined;
  if (entry.chatId) {
    return {
      key: `chat:${entry.chatId}`,
      label: "chat",
      source,
      chatId: entry.chatId,
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (sessionId) {
    return {
      key: `agent-session:${sessionId}`,
      label: "agent-session",
      source,
      sessionId,
    };
  }
  return {
    key: `source:${source}`,
    label: source,
    source,
  };
}

function updateAcpTimelineLane(
  lane: LocalAdeAcpActivityTimelineLane,
  entry: LogEntry
): void {
  const kind = acpActivityKind(entry);
  lane.eventCount += 1;
  lane.firstTimestamp = Math.min(lane.firstTimestamp, entry.timestamp);
  if (entry.timestamp >= lane.lastTimestamp) {
    lane.lastTimestamp = entry.timestamp;
    lane.latestMessage = entry.message;
    lane.latestLevel = entry.level;
    if (kind) {
      lane.latestKind = kind;
    } else {
      delete lane.latestKind;
    }
  }
  lane.durationMs = Math.max(0, lane.lastTimestamp - lane.firstTimestamp);
  lane.levels[entry.level] += 1;
  if (kind) {
    lane.kinds[kind] = (lane.kinds[kind] ?? 0) + 1;
  }
}

function createAcpActivityTimeline(
  entries: LogEntry[]
): LocalAdeAcpActivityTimeline {
  const chronologicalEntries = [...entries].sort((left, right) => {
    const timestampDelta = left.timestamp - right.timestamp;
    return timestampDelta === 0 ? left.id.localeCompare(right.id) : timestampDelta;
  });
  const lanes = new Map<string, LocalAdeAcpActivityTimelineLane>();
  for (const entry of chronologicalEntries) {
    const identity = acpTimelineLaneIdentity(entry);
    const existing = lanes.get(identity.key);
    if (existing) {
      updateAcpTimelineLane(existing, entry);
      continue;
    }
    const levels = createLogLevelCounts();
    const lane: LocalAdeAcpActivityTimelineLane = {
      key: identity.key,
      label: identity.label,
      eventCount: 0,
      firstTimestamp: entry.timestamp,
      lastTimestamp: entry.timestamp,
      durationMs: 0,
      latestMessage: entry.message,
      latestLevel: entry.level,
      ...(identity.chatId ? { chatId: identity.chatId } : {}),
      ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
      source: identity.source,
      levels,
      kinds: {},
    };
    lanes.set(identity.key, lane);
    updateAcpTimelineLane(lane, entry);
  }

  const frameEntries =
    chronologicalEntries.length > MAX_ACP_ACTIVITY_TIMELINE_FRAMES
      ? chronologicalEntries.slice(-MAX_ACP_ACTIVITY_TIMELINE_FRAMES)
      : chronologicalEntries;
  const firstFrameTimestamp = frameEntries[0]?.timestamp ?? 0;
  let previousFrame: LogEntry | undefined;
  const transitions: LocalAdeAcpActivityTimelineTransition[] = [];
  const frames = frameEntries.map((entry, index) => {
    const identity = acpTimelineLaneIdentity(entry);
    const correlation = acpCorrelationIdentity(entry);
    const previousTimestamp = previousFrame?.timestamp ?? entry.timestamp;
    const visible = toVisibleAcpActivityEntry(entry);
    const frame: LocalAdeAcpActivityTimelineFrame = {
      ...visible,
      sequence: index + 1,
      offsetMs: Math.max(0, entry.timestamp - firstFrameTimestamp),
      deltaMs: index === 0 ? 0 : Math.max(0, entry.timestamp - previousTimestamp),
      laneKey: identity.key,
      laneLabel: identity.label,
      correlationKey: correlation.key,
      correlationLabel: correlation.label,
    };
    if (previousFrame && transitions.length < MAX_ACP_ACTIVITY_TIMELINE_TRANSITIONS) {
      const previousIdentity = acpTimelineLaneIdentity(previousFrame);
      if (previousIdentity.key !== identity.key) {
        const previousKind = acpActivityKind(previousFrame);
        const currentKind = acpActivityKind(entry);
        transitions.push({
          sequence: transitions.length + 1,
          timestamp: entry.timestamp,
          deltaMs: Math.max(0, entry.timestamp - previousFrame.timestamp),
          fromLaneKey: previousIdentity.key,
          fromLaneLabel: previousIdentity.label,
          toLaneKey: identity.key,
          toLaneLabel: identity.label,
          ...(previousKind ? { fromKind: previousKind } : {}),
          ...(currentKind ? { toKind: currentKind } : {}),
          ...(previousIdentity.chatId ? { fromChatId: previousIdentity.chatId } : {}),
          ...(identity.chatId ? { toChatId: identity.chatId } : {}),
        });
      }
    }
    previousFrame = entry;
    return frame;
  });

  return {
    lanes: [...lanes.values()]
      .sort((left, right) => right.lastTimestamp - left.lastTimestamp)
      .slice(0, MAX_ACP_ACTIVITY_TIMELINE_LANES),
    frames,
    transitions,
    spanMs: Math.max(
      0,
      (frameEntries.at(-1)?.timestamp ?? 0) - firstFrameTimestamp
    ),
    omittedFrames: Math.max(0, chronologicalEntries.length - frameEntries.length),
  };
}

function createAcpActivityStreamDiagnostics(
  entries: LogEntry[]
): LocalAdeAcpActivityStreamDiagnostics {
  const chronologicalEntries = [...entries].sort((left, right) => {
    const timestampDelta = left.timestamp - right.timestamp;
    return timestampDelta === 0 ? left.id.localeCompare(right.id) : timestampDelta;
  });
  const now = Date.now();
  const latestEntry = chronologicalEntries.at(-1);

  if (!latestEntry) {
    return {
      status: "idle",
      latestAgeMs: 0,
      staleAfterMs: ACP_ACTIVITY_STREAM_STALE_AFTER_MS,
      heartbeatWindowMs: ACP_ACTIVITY_STREAM_HEARTBEAT_WINDOW_MS,
      retryDelayMs: ACP_ACTIVITY_STREAM_RETRY_DELAY_MS,
      retryMaxAttempts: ACP_ACTIVITY_STREAM_RETRY_MAX_ATTEMPTS,
      retryEligible: false,
      rootCount: 0,
      correlatedFrameCount: 0,
      orphanFrameCount: 0,
      longestChainLength: 0,
      maxSilenceMs: 0,
      averageDeltaMs: 0,
      gapThresholdMs: ACP_ACTIVITY_STREAM_GAP_THRESHOLD_MS,
      gaps: [],
      chains: [],
      diagnostics: ["No ACP stream frames are available for this workspace."],
    };
  }

  const gaps: LocalAdeAcpActivityStreamGap[] = [];
  let previousEntry: LogEntry | undefined;
  let maxSilenceMs = 0;
  let totalDeltaMs = 0;
  let deltaCount = 0;

  for (const [index, entry] of chronologicalEntries.entries()) {
    if (!previousEntry) {
      previousEntry = entry;
      continue;
    }
    const deltaMs = Math.max(0, entry.timestamp - previousEntry.timestamp);
    maxSilenceMs = Math.max(maxSilenceMs, deltaMs);
    totalDeltaMs += deltaMs;
    deltaCount += 1;
    if (
      deltaMs >= ACP_ACTIVITY_STREAM_GAP_THRESHOLD_MS &&
      gaps.length < MAX_ACP_ACTIVITY_STREAM_GAPS
    ) {
      const fromKind = acpActivityKind(previousEntry);
      const toKind = acpActivityKind(entry);
      gaps.push({
        sequence: index,
        deltaMs,
        fromFrameId: previousEntry.id,
        toFrameId: entry.id,
        ...(fromKind ? { fromKind } : {}),
        ...(toKind ? { toKind } : {}),
        ...(previousEntry.chatId ? { fromChatId: previousEntry.chatId } : {}),
        ...(entry.chatId ? { toChatId: entry.chatId } : {}),
      });
    }
    previousEntry = entry;
  }

  const correlations = createAcpActivityCorrelations(entries);
  const correlatedRootKeys = new Set<string>();
  let correlatedFrameCount = 0;
  let orphanFrameCount = 0;
  for (const entry of entries) {
    const identity = acpCorrelationIdentity(entry);
    if (identity.key.startsWith("source:")) {
      orphanFrameCount += 1;
      continue;
    }
    correlatedFrameCount += 1;
    correlatedRootKeys.add(identity.key);
  }

  const latestAgeMs = Math.max(0, now - latestEntry.timestamp);
  const hasWarnOrError = entries.some(
    (entry) => entry.level === "warn" || entry.level === "error"
  );
  const isStale = latestAgeMs > ACP_ACTIVITY_STREAM_STALE_AFTER_MS;
  const hasGaps = gaps.length > 0;
  const retryEligible = isStale || hasGaps || hasWarnOrError;
  const status: LocalAdeAcpActivityStreamDiagnostics["status"] = isStale
    ? "stale"
    : retryEligible
      ? "attention"
      : "healthy";
  const diagnostics: string[] = [];

  if (isStale) {
    diagnostics.push(
      `Latest ACP stream frame is ${latestAgeMs}ms old, above the ${ACP_ACTIVITY_STREAM_STALE_AFTER_MS}ms stale threshold.`
    );
  }
  if (hasGaps) {
    diagnostics.push(
      `${gaps.length} ACP stream gap(s) exceeded ${ACP_ACTIVITY_STREAM_GAP_THRESHOLD_MS}ms.`
    );
  }
  if (orphanFrameCount > 0) {
    diagnostics.push(
      `${orphanFrameCount} ACP frame(s) lack chat/session/turn identity and are grouped by source.`
    );
  }
  if (hasWarnOrError) {
    diagnostics.push(
      "ACP warning or error frames are present in the current stream window."
    );
  }
  if (retryEligible) {
    diagnostics.push(
      `Retry Stream refreshes captured diagnostics after ${ACP_ACTIVITY_STREAM_RETRY_DELAY_MS}ms without replaying side-effecting protocol calls.`
    );
  }

  return {
    status,
    latestTimestamp: latestEntry.timestamp,
    latestAgeMs,
    staleAfterMs: ACP_ACTIVITY_STREAM_STALE_AFTER_MS,
    heartbeatWindowMs: ACP_ACTIVITY_STREAM_HEARTBEAT_WINDOW_MS,
    retryDelayMs: ACP_ACTIVITY_STREAM_RETRY_DELAY_MS,
    retryMaxAttempts: ACP_ACTIVITY_STREAM_RETRY_MAX_ATTEMPTS,
    retryEligible,
    rootCount: correlatedRootKeys.size,
    correlatedFrameCount,
    orphanFrameCount,
    longestChainLength: correlations.reduce(
      (longest, correlation) => Math.max(longest, correlation.eventCount),
      0
    ),
    maxSilenceMs,
    averageDeltaMs:
      deltaCount === 0 ? 0 : Math.round(totalDeltaMs / deltaCount),
    gapThresholdMs: ACP_ACTIVITY_STREAM_GAP_THRESHOLD_MS,
    gaps,
    chains: correlations.slice(0, MAX_ACP_ACTIVITY_CAUSALITY_CHAINS),
    diagnostics,
  };
}

function createAcpActivitySnapshot(params: {
  entries: LogEntry[];
  totalCandidateEntries: number;
  maxEntries?: number;
  replayPresets?: LocalAdeAcpReplayPreset[];
}): LocalAdeAcpActivitySnapshot {
  const levels = createLogLevelCounts();
  const kinds: Record<string, number> = {};
  const chatIds = new Set<string>();
  const visibleEntries: LocalAdeAcpActivityEntry[] = [];
  const maxEntries = params.maxEntries ?? MAX_ACP_ACTIVITY_ENTRIES;

  for (const entry of params.entries) {
    levels[entry.level] += 1;
    if (entry.chatId) {
      chatIds.add(entry.chatId);
    }
    const kind = acpActivityKind(entry);
    if (kind) {
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    if (visibleEntries.length >= maxEntries) {
      continue;
    }
    visibleEntries.push(toVisibleAcpActivityEntry(entry));
  }

  return {
    entries: visibleEntries,
    correlations: createAcpActivityCorrelations(params.entries),
    timeline: createAcpActivityTimeline(params.entries),
    stream: createAcpActivityStreamDiagnostics(params.entries),
    replayPresets: params.replayPresets ?? [],
    stats: {
      total: params.entries.length,
      levels,
      chatCount: chatIds.size,
      kinds,
    },
    diagnostics:
      params.totalCandidateEntries > params.entries.length
        ? [
            `${params.totalCandidateEntries - params.entries.length} ACP log entries were hidden because they were not tied to this user or an owned chat.`,
          ]
        : [],
  };
}

function createAcpReplayFrames(
  entries: LogEntry[]
): LocalAdeAcpActivityReplayFrame[] {
  const firstTimestamp = entries[0]?.timestamp ?? 0;
  let previousTimestamp = firstTimestamp;
  return entries.map((entry, index) => {
    const identity = acpCorrelationIdentity(entry);
    const visible = toVisibleAcpActivityEntry(entry);
    const frame: LocalAdeAcpActivityReplayFrame = {
      ...visible,
      sequence: index + 1,
      elapsedMs: Math.max(0, entry.timestamp - firstTimestamp),
      deltaMs: index === 0 ? 0 : Math.max(0, entry.timestamp - previousTimestamp),
      correlationKey: identity.key,
      correlationLabel: identity.label,
    };
    previousTimestamp = entry.timestamp;
    return frame;
  });
}

function normalizeRunAuditExportLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 40;
  }
  return Math.min(200, Math.max(1, Math.trunc(value)));
}

function createRunStatusCounts(): Record<LocalAdeHookRun["status"], number> {
  return {
    success: 0,
    failed: 0,
    timeout: 0,
    disabled: 0,
  };
}

function assertHookBatchConfirmation(confirmation: string): void {
  if (confirmation.trim() !== HOOK_BATCH_CONFIRMATION_TOKEN) {
    throw new Error(
      `Hook batch confirmation mismatch. Type ${HOOK_BATCH_CONFIRMATION_TOKEN} to execute.`
    );
  }
}

function createHookBatchSummary(params: {
  batchId: string;
  hookIds: string[];
  hookNames: string[];
  failureMode: LocalAdeHookLifecycleFailureMode;
  runs: LocalAdeHookRun[];
  startedAt: string;
  startedMs: number;
  diagnostics: string[];
}): LocalAdeHookBatch {
  const counts = createRunStatusCounts();
  for (const run of params.runs) {
    counts[run.status] += 1;
  }
  const finishedAt = new Date().toISOString();
  const status: LocalAdeHookBatch["status"] =
    params.runs.length === 0 || counts.disabled === params.runs.length
      ? "blocked"
      : counts.failed > 0 || counts.timeout > 0
        ? counts.success > 0 || counts.disabled > 0
          ? "partial"
          : "failed"
        : counts.disabled > 0
          ? "partial"
          : "success";
  return {
    id: params.batchId,
    hookIds: params.hookIds,
    hookNames: params.hookNames,
    failureMode: params.failureMode,
    runIds: params.runs.map((run) => run.id),
    startedAt: params.startedAt,
    finishedAt,
    durationMs: Date.now() - params.startedMs,
    status,
    counts,
    diagnostics: [
      `Hook batch ${params.batchId} processed ${params.runs.length}/${params.hookIds.length} requested hook(s).`,
      `Failure mode: ${params.failureMode}.`,
      ...params.diagnostics,
    ].map((diagnostic) => sanitizeDiagnosticText(diagnostic)),
  };
}

function analyzePluginDependencies(plugins: StoredPlugin[]): {
  graph: LocalAdePluginDependencyGraph;
  cyclePluginIds: Set<string>;
} {
  const pluginById = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const dependentIdsByPluginId = new Map<string, string[]>();
  const diagnostics: string[] = [];
  const edges: LocalAdePluginDependencyGraphEdge[] = [];
  for (const plugin of plugins) {
    const dependencyIds = normalizePluginDependencyIds(
      plugin.dependencyIds,
      plugin.id
    );
    for (const dependencyId of dependencyIds) {
      const dependency = pluginById.get(dependencyId);
      if (dependency) {
        dependentIdsByPluginId.set(dependencyId, [
          ...(dependentIdsByPluginId.get(dependencyId) ?? []),
          plugin.id,
        ]);
      } else {
        diagnostics.push(
          `Plugin ${plugin.name} depends on missing plugin ${dependencyId}.`
        );
      }
      edges.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        dependencyId,
        ...(dependency ? { dependencyName: dependency.name } : {}),
        status: dependency ? "ready" : "missing",
      });
    }
  }

  const cyclePluginIds = new Set<string>();
  const cyclePaths: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (pluginId: string): void => {
    if (visiting.has(pluginId)) {
      const cycleStart = stack.indexOf(pluginId);
      const cycle = (cycleStart >= 0 ? stack.slice(cycleStart) : [pluginId]).concat(
        pluginId
      );
      for (const id of cycle) {
        cyclePluginIds.add(id);
      }
      cyclePaths.push(cycle.join(" -> "));
      return;
    }
    if (visited.has(pluginId)) {
      return;
    }
    const plugin = pluginById.get(pluginId);
    if (!plugin) {
      return;
    }
    visiting.add(pluginId);
    stack.push(pluginId);
    for (const dependencyId of normalizePluginDependencyIds(
      plugin.dependencyIds,
      plugin.id
    )) {
      if (pluginById.has(dependencyId)) {
        visit(dependencyId);
      }
    }
    stack.pop();
    visiting.delete(pluginId);
    visited.add(pluginId);
  };
  for (const plugin of plugins) {
    visit(plugin.id);
  }
  for (const cyclePath of [...new Set(cyclePaths)]) {
    diagnostics.push(`Plugin dependency cycle detected: ${cyclePath}.`);
  }

  const nodes: LocalAdePluginDependencyGraphNode[] = plugins.map((plugin) => {
    const dependencyIds = normalizePluginDependencyIds(
      plugin.dependencyIds,
      plugin.id
    );
    const missingDependencyIds = dependencyIds.filter(
      (dependencyId) => !pluginById.has(dependencyId)
    );
    const dependentIds = dependentIdsByPluginId.get(plugin.id) ?? [];
    const nodeDiagnostics: string[] = [];
    if (missingDependencyIds.length > 0) {
      nodeDiagnostics.push(
        `Missing dependency plugin(s): ${missingDependencyIds.join(", ")}.`
      );
    }
    if (cyclePluginIds.has(plugin.id)) {
      nodeDiagnostics.push("Plugin is part of a dependency cycle.");
    }
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      dependencyIds,
      dependencyNames: dependencyIds.map(
        (dependencyId) => pluginById.get(dependencyId)?.name ?? dependencyId
      ),
      dependentIds,
      dependentNames: dependentIds.map(
        (dependentId) => pluginById.get(dependentId)?.name ?? dependentId
      ),
      status: cyclePluginIds.has(plugin.id)
        ? "cycle"
        : missingDependencyIds.length > 0
          ? "missing-dependency"
          : "ready",
      diagnostics: nodeDiagnostics.map((diagnostic) =>
        sanitizeDiagnosticText(diagnostic)
      ),
    };
  });

  return {
    graph: {
      nodes,
      edges: edges.map((edge) => ({
        ...edge,
        status:
          edge.status === "ready" &&
          cyclePluginIds.has(edge.pluginId) &&
          cyclePluginIds.has(edge.dependencyId)
            ? "cycle"
            : edge.status,
      })),
      diagnostics: diagnostics.map((diagnostic) =>
        sanitizeDiagnosticText(diagnostic)
      ),
    },
    cyclePluginIds,
  };
}

function createPluginBatchExecutionPlan(
  document: PluginDocument,
  pluginIds: string[]
): {
  orderedPluginIds: string[];
  requestedSet: Set<string>;
  missingDependenciesByPluginId: Map<string, string[]>;
  cyclePluginIds: Set<string>;
  diagnostics: string[];
} {
  const pluginById = new Map(document.plugins.map((plugin) => [plugin.id, plugin]));
  const requestedSet = new Set(pluginIds);
  const analysis = analyzePluginDependencies(document.plugins);
  const orderedPluginIds: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (pluginId: string): void => {
    if (visited.has(pluginId)) {
      return;
    }
    if (visiting.has(pluginId)) {
      return;
    }
    visiting.add(pluginId);
    const plugin = pluginById.get(pluginId);
    if (plugin) {
      for (const dependencyId of normalizePluginDependencyIds(
        plugin.dependencyIds,
        plugin.id
      )) {
        if (requestedSet.has(dependencyId)) {
          visit(dependencyId);
        }
      }
    }
    visiting.delete(pluginId);
    visited.add(pluginId);
    orderedPluginIds.push(pluginId);
  };
  for (const pluginId of pluginIds) {
    visit(pluginId);
  }

  const missingDependenciesByPluginId = new Map<string, string[]>();
  const diagnostics: string[] = [];
  for (const pluginId of orderedPluginIds) {
    const plugin = pluginById.get(pluginId);
    if (!plugin) {
      continue;
    }
    const missingDependencyIds = normalizePluginDependencyIds(
      plugin.dependencyIds,
      plugin.id
    ).filter(
      (dependencyId) => !requestedSet.has(dependencyId) || !pluginById.has(dependencyId)
    );
    if (missingDependencyIds.length > 0) {
      missingDependenciesByPluginId.set(plugin.id, missingDependencyIds);
      diagnostics.push(
        `Plugin ${plugin.name} is waiting for dependency plugin(s) in the batch: ${missingDependencyIds.join(", ")}.`
      );
    }
  }
  const cyclePluginIds = new Set(
    [...analysis.cyclePluginIds].filter((pluginId) => requestedSet.has(pluginId))
  );
  if (cyclePluginIds.size > 0) {
    diagnostics.push(
      `Plugin batch contains dependency cycle member(s): ${[...cyclePluginIds].join(", ")}.`
    );
  }
  if (orderedPluginIds.join("\0") !== pluginIds.join("\0")) {
    diagnostics.push(
      `Plugin batch dependency order: ${orderedPluginIds.join(" -> ")}.`
    );
  }
  return {
    orderedPluginIds,
    requestedSet,
    missingDependenciesByPluginId,
    cyclePluginIds,
    diagnostics: diagnostics.map((diagnostic) => sanitizeDiagnosticText(diagnostic)),
  };
}
function createPluginBatchSummary(params: {
  batchId: string;
  pluginIds: string[];
  pluginNames: string[];
  failureMode: LocalAdePluginBatchFailureMode;
  runs: LocalAdePluginRun[];
  startedAt: string;
  startedMs: number;
  diagnostics: string[];
}): LocalAdePluginBatch {
  const counts = createRunStatusCounts();
  for (const run of params.runs) {
    counts[run.status] += 1;
  }
  const finishedAt = new Date().toISOString();
  const status: LocalAdePluginBatch["status"] =
    params.runs.length === 0 || counts.disabled === params.runs.length
      ? "blocked"
      : counts.failed > 0 || counts.timeout > 0
        ? counts.success > 0 || counts.disabled > 0
          ? "partial"
          : "failed"
        : counts.disabled > 0
          ? "partial"
          : "success";
  return {
    id: params.batchId,
    pluginIds: params.pluginIds,
    pluginNames: params.pluginNames,
    failureMode: params.failureMode,
    runIds: params.runs.map((run) => run.id),
    startedAt: params.startedAt,
    finishedAt,
    durationMs: Date.now() - params.startedMs,
    status,
    counts,
    diagnostics: [
      `Plugin batch ${params.batchId} processed ${params.runs.length}/${params.pluginIds.length} requested plugin(s).`,
      `Failure mode: ${params.failureMode}.`,
      ...params.diagnostics,
    ].map((diagnostic) => sanitizeDiagnosticText(diagnostic)),
  };
}

function matchesRunAuditFilters(
  run: Pick<LocalAdeHookRun, "status" | "reviewedAt">,
  input: Pick<ExportHookRunsInput, "reviewState" | "status">
): boolean {
  if (input.status && run.status !== input.status) {
    return false;
  }
  const reviewState = input.reviewState ?? "all";
  if (reviewState === "reviewed") {
    return Boolean(run.reviewedAt);
  }
  if (reviewState === "open") {
    return !run.reviewedAt;
  }
  return true;
}

function createRunAuditStats(
  allRuns: Array<Pick<LocalAdeHookRun, "status" | "reviewedAt">>,
  matchingRuns: Array<Pick<LocalAdeHookRun, "status" | "reviewedAt">>,
  includedCount: number
): LocalAdeRunAuditStats {
  const statuses = createRunStatusCounts();
  let reviewed = 0;
  for (const run of allRuns) {
    statuses[run.status] += 1;
    if (run.reviewedAt) {
      reviewed += 1;
    }
  }
  return {
    total: allRuns.length,
    matching: matchingRuns.length,
    included: includedCount,
    reviewed,
    open: Math.max(0, allRuns.length - reviewed),
    statuses,
  };
}

function sanitizeHookRunForExport(run: LocalAdeHookRun): LocalAdeHookRun {
  return {
    ...run,
    stdout: sanitizeDiagnosticText(run.stdout),
    stderr: sanitizeDiagnosticText(run.stderr),
    diagnostics: run.diagnostics.map((diagnostic) =>
      sanitizeDiagnosticText(diagnostic)
    ),
  };
}

function sanitizePluginRunForExport(run: LocalAdePluginRun): LocalAdePluginRun {
  return {
    ...run,
    stdout: sanitizeDiagnosticText(run.stdout),
    stderr: sanitizeDiagnosticText(run.stderr),
    diagnostics: run.diagnostics.map((diagnostic) =>
      sanitizeDiagnosticText(diagnostic)
    ),
  };
}

export class LocalAdeService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly agentRepo: AgentRepositoryPort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logStore: LogStorePort;
  private readonly settingsRepo: SettingsRepositoryPort;
  private readonly appConfigService: AppConfigService;
  private readonly getBackgroundRunnerState: () => BackgroundRunnerState | null;
  private readonly eventBus?: EventBusPort;

  constructor(params: {
    projectRepo: ProjectRepositoryPort;
    agentRepo: AgentRepositoryPort;
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
    logStore: LogStorePort;
    settingsRepo: SettingsRepositoryPort;
    appConfigService: AppConfigService;
    getBackgroundRunnerState?: () => BackgroundRunnerState | null;
    eventBus?: EventBusPort;
  }) {
    this.projectRepo = params.projectRepo;
    this.agentRepo = params.agentRepo;
    this.sessionRepo = params.sessionRepo;
    this.sessionRuntime = params.sessionRuntime;
    this.logStore = params.logStore;
    this.settingsRepo = params.settingsRepo;
    this.appConfigService = params.appConfigService;
    this.getBackgroundRunnerState = params.getBackgroundRunnerState ?? (() => null);
    this.eventBus = params.eventBus;
  }

  subscribeLifecycleEvents(eventBus: EventBusPort): () => void {
    return eventBus.subscribe((event, context) => {
      if (context.signal.aborted || event.type !== "local_ade_lifecycle") {
        return;
      }
      void this.handleLifecycleEvent(event).catch(() => undefined);
    });
  }

  async handleLifecycleEvent(event: DomainEvent): Promise<void> {
    if (event.type !== "local_ade_lifecycle") {
      return;
    }
    await this.runLifecycleHooksForProject(event.projectRoot, event.event, {
      userId: event.userId,
      projectId: event.projectId,
      chatId: event.chatId,
      agentSessionId: event.agentSessionId,
      turnId: event.turnId,
    });
  }

  async snapshot(userId: string): Promise<LocalAdeSnapshot> {
    const projectContext = await this.resolveProjectContext(userId);
    const state = await readCapabilityState(projectContext.rootPath);
    const [
      agents,
      activeAgentId,
      markdownCapabilities,
      commands,
      skills,
      outputStyles,
      subagents,
      projectMemory,
      projectMemoryPresetDocument,
      repoIndexDocument,
      hookDocument,
      pluginDocument,
      pluginRegistryDocument,
      mcpDocument,
      mcpAgentInvocations,
      providerHealth,
      checkpointDocument,
      changeTrust,
      logs,
      acpLogs,
      acpReplayPresetDocument,
      recentStoredSessions,
      storage,
    ] =
      await Promise.all([
        this.agentRepo.findAll(userId),
        this.agentRepo.getActiveId(userId),
        discoverCapabilityFiles({
          rootPath: projectContext.rootPath,
          state,
          homePath: os.homedir(),
        }),
        discoverCommandFiles({
          rootPath: projectContext.rootPath,
          state,
          homePath: os.homedir(),
        }),
        discoverSkillFiles({
          rootPath: projectContext.rootPath,
          state,
          homePath: os.homedir(),
        }),
        discoverOutputStyleFiles({
          rootPath: projectContext.rootPath,
          state,
          homePath: os.homedir(),
        }),
        discoverSubagentFiles({
          rootPath: projectContext.rootPath,
          state,
          homePath: os.homedir(),
        }),
        readProjectMemory(projectContext.rootPath, state),
        readProjectMemoryPresetDocument(projectContext.rootPath),
        readRepoIndexDocument(projectContext.rootPath),
        readHookDocument(projectContext.rootPath),
        readPluginDocument(projectContext.rootPath),
        readPluginRegistryStateDocument(projectContext.rootPath),
        readMcpDocument(projectContext.rootPath),
        readMcpAgentInvocations(projectContext.rootPath),
        readProviderHealthDocument(projectContext.rootPath),
        readCheckpointDocument(projectContext.rootPath),
        readGitSnapshot(projectContext.rootPath),
        this.logStore.query({ userId, order: "desc", limit: 20 }),
        this.logStore.query({ acpOnly: true, order: "desc", limit: 200 }),
        readAcpReplayPresetDocument(projectContext.rootPath),
        this.sessionRepo.findAll(userId, { limit: 100 }).catch(() => []),
        this.sessionRepo.getStorageStats().catch(() => null),
      ]);

    const defaultModel = this.appConfigService.getConfig().defaultModel.trim();
    const providers = await providerDescriptorsFromAgents(
      projectContext.rootPath,
      agents,
      providerHealth,
      defaultModel
    );
    const defaultModelProvider = defaultModel
      ? providers.find(
          (provider) =>
            provider.modelListSource === "readiness-probe" &&
            provider.modelList.includes(defaultModel)
        )
      : undefined;
    const defaultModelStatus = !defaultModel
      ? "not-set"
      : defaultModelProvider
        ? "selected"
        : "unverified";
    const hooks = toVisibleHooks(projectContext.rootPath, hookDocument);
    const plugins = toVisiblePlugins(projectContext.rootPath, pluginDocument);
    const pluginRegistries = toVisiblePluginRegistries(
      pluginRegistryDocument.registries,
      pluginDocument
    );
    const pluginCatalog = await discoverPluginPackageCatalog(
      projectContext.rootPath,
      pluginDocument
    );
    const mcpServers = await Promise.all(
      mcpDocument.servers.map((server) =>
        toVisibleMcpServer(projectContext.rootPath, server)
      )
    );
    const mcpAgentRouting = createMcpAgentRouting(
      mcpDocument.servers,
      mcpServers,
      mcpAgentInvocations
    );
    const capabilities = createCapabilityRegistrySnapshot(
      [
        ...markdownCapabilities,
        ...subagentCapabilities(subagents),
        ...hookCapabilities(hooks),
        ...pluginCapabilities(plugins),
        ...providerCapabilities(providers),
        ...createMcpCapabilities(projectContext.rootPath, mcpServers),
        ...projectMemory.sources.map((source): CapabilityDescriptor => ({
          id: source.id,
          kind: "skill",
          name: source.label,
          description: `Project memory source: ${source.relativePath}`,
          scope: "project",
          enabled: source.enabled,
          sourcePath: source.sourcePath,
          storage: "filesystem-discovery",
          tags: ["project-memory"],
          diagnostics: source.warnings,
        })),
      ],
      [
        "Filesystem discovery is active for skills, commands, output styles, memory, and MCP descriptors.",
        "Capability enablement uses transitional project-local JSON until the SQLite capability migration lands.",
      ]
    );

    const activeSessions = this.sessionRuntime
      .getAll()
      .filter((session) => session.userId === userId)
      .map((session) => ({
        id: session.id,
        ...(session.projectId ? { projectId: session.projectId } : {}),
        projectRoot: session.projectRoot,
        ...(session.sessionId ? { sessionId: session.sessionId } : {}),
        chatStatus: session.chatStatus,
        subscriberCount: session.subscriberCount,
        pendingPermissions: session.pendingPermissions.size,
        activeToolCalls: session.toolCalls.size,
        ...(session.agentInfo?.title || session.agentInfo?.name
          ? { agentName: session.agentInfo.title ?? session.agentInfo.name }
          : {}),
        ...(sessionPid(session.proc) ? { pid: sessionPid(session.proc) } : {}),
        model: createActiveSessionModelSnapshot(session),
      }));
    const ownedChatIds = new Set<string>([
      ...activeSessions.map((session) => session.id),
      ...recentStoredSessions.map((session) => session.id),
    ]);
    const acpActivity = createAcpActivitySnapshot({
      entries: acpLogs.entries.filter((entry) =>
        isOwnedAcpLogEntry({ entry, userId, ownedChatIds })
      ),
      totalCandidateEntries: acpLogs.entries.length,
      replayPresets: acpReplayPresetDocument.presets,
    });

    const totalStored = await this.sessionRepo.countAll(userId).catch(() => null);
    const background = this.getBackgroundRunnerState();

    return {
      generatedAt: new Date().toISOString(),
      projectRoot: projectContext.rootPath,
      projects: {
        activeProjectId: projectContext.activeProjectId,
        activeProjectPath: projectContext.activeProjectPath,
        items: projectContext.projects,
      },
      sessions: {
        active: activeSessions,
        totalStored,
      },
      agents: {
        activeAgentId,
        items: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          type: agent.type,
          command: agent.command,
          args: agent.args ?? [],
          envKeys: Object.keys(agent.env ?? {}),
          isActive: agent.id === activeAgentId,
        })),
      },
      runtime: {
        defaultModel,
        defaultModelProviderId: defaultModelProvider?.id ?? null,
        defaultModelStatus,
        background,
        diagnostics: [
          defaultModel
            ? defaultModelProvider
              ? `Default model ${defaultModel} is mapped to ${defaultModelProvider.displayName}.`
              : `Default model ${defaultModel} is not in the current discovered provider model lists.`
            : "No default model is configured for new sessions.",
        ],
      },
      providers,
      capabilities,
      projectMemory: {
        ...projectMemory,
        presets: projectMemoryPresetDocument.presets.map((preset) => ({
          ...preset,
          diagnostics: createProjectMemoryPresetDiagnostics(
            preset,
            projectMemory.sources
          ),
        })),
      },
      projectIndex: toRepoIndexSnapshot(projectContext.rootPath, repoIndexDocument),
      hooks: {
        configPath: path.join(ensureProjectDataDir(projectContext.rootPath), HOOKS_FILE),
        lifecyclePolicy: visibleHookLifecyclePolicy(
          hookDocument.lifecyclePolicy
        ),
        schedulingPolicy: visibleAutomationSchedulingPolicy(
          hookDocument.schedulingPolicy
        ),
        items: hooks,
        recentRuns: hookDocument.runs,
        recentBatches: hookDocument.batches,
      },
      plugins: {
        configPath: path.join(ensureProjectDataDir(projectContext.rootPath), PLUGINS_FILE),
        schedulingPolicy: visibleAutomationSchedulingPolicy(
          pluginDocument.schedulingPolicy
        ),
        items: plugins,
        catalog: pluginCatalog,
        registries: pluginRegistries,
        recentRuns: pluginDocument.runs,
        recentBatches: pluginDocument.batches,
        batchPresets: pluginDocument.batchPresets,
        batchSchedules: toVisiblePluginBatchSchedules(pluginDocument),
        dependencyGraph: analyzePluginDependencies(pluginDocument.plugins).graph,
      },
      mcp: {
        configPath: path.join(ensureProjectDataDir(projectContext.rootPath), MCP_FILE),
        servers: mcpServers,
        agentRouting: mcpAgentRouting,
      },
      commands,
      skills,
      outputStyles,
      subagents,
      changeTrust,
      checkpoints: {
        storagePath: path.join(
          ensureProjectDataDir(projectContext.rootPath),
          CHECKPOINTS_FILE
        ),
        patchDir: path.join(
          ensureProjectDataDir(projectContext.rootPath),
          CHECKPOINT_PATCH_DIR
        ),
        items: checkpointDocument.checkpoints,
      },
      logs: {
        entries: logs.entries.map((entry) => ({
          id: entry.id,
          timestamp: entry.timestamp,
          level: entry.level,
          source: entry.source ?? "runtime",
          message: entry.message,
        })),
        stats: {
          total: logs.stats.total,
          levels: logs.stats.levels,
        },
      },
      acpActivity,
      storage: storage
        ? {
            sessionCount: storage.sessionCount,
            messageCount: storage.messageCount,
            dbSizeBytes: storage.dbSizeBytes,
            walSizeBytes: storage.walSizeBytes,
          }
        : null,
      dashboardParity: DASHBOARD_PARITY,
      blockers: DASHBOARD_PARITY.filter((item) => item.status === "blocked"),
    };
  }

  async refreshProjectIndex(
    userId: string,
    input: RefreshProjectIndexInput = {}
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await createRepoIndexDocument(context.rootPath);
    await writeRepoIndexDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-project-index-refresh"
    );
    return await this.snapshot(userId);
  }

  async exportAcpActivity(
    userId: string,
    input: ExportAcpActivityInput = {}
  ): Promise<LocalAdeAcpActivityExport> {
    const projectContext = await this.resolveProjectContext(userId, input.projectId);
    const limit = normalizeAcpTraceExportLimit(input.limit);
    const activeSessions = this.sessionRuntime
      .getAll()
      .filter((session) => session.userId === userId);
    const recentStoredSessions = await this.sessionRepo
      .findAll(userId, { limit: 100 })
      .catch(() => []);
    const ownedChatIds = new Set<string>([
      ...activeSessions.map((session) => session.id),
      ...recentStoredSessions.map((session) => session.id),
    ]);
    const queryLimit = Math.min(
      MAX_ACP_TRACE_EXPORT_ENTRIES * 4,
      Math.max(200, limit * 4)
    );
    const acpLogs = await this.logStore.query({
      acpOnly: true,
      order: "desc",
      limit: queryLimit,
    });
    const ownedEntries = acpLogs.entries.filter((entry) =>
      isOwnedAcpLogEntry({ entry, userId, ownedChatIds })
    );
    const filteredEntries = input.chatId
      ? ownedEntries.filter((entry) => entry.chatId === input.chatId)
      : ownedEntries;
    const snapshot = createAcpActivitySnapshot({
      entries: filteredEntries,
      totalCandidateEntries: input.chatId ? filteredEntries.length : acpLogs.entries.length,
      maxEntries: limit,
    });

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      projectRoot: projectContext.rootPath,
      filters: {
        ...(input.chatId ? { chatId: input.chatId } : {}),
        limit,
      },
      redacted: true,
      entries: snapshot.entries,
      correlations: snapshot.correlations,
      timeline: snapshot.timeline,
      stream: snapshot.stream,
      stats: snapshot.stats,
      diagnostics: snapshot.diagnostics,
    };
  }

  async retryAcpActivityStream(
    userId: string,
    input: RetryAcpActivityStreamInput = {}
  ): Promise<LocalAdeSnapshot> {
    await this.resolveProjectContext(userId, input.projectId);
    this.logStore.append({
      id: `local-ade-stream-retry-${randomUUID()}`,
      timestamp: Date.now(),
      level: "info",
      source: "local-ade",
      userId,
      message: "Activity stream diagnostics refresh requested",
      meta: {
        step: "activity-stream-retry",
        retryDelayMs: ACP_ACTIVITY_STREAM_RETRY_DELAY_MS,
        retryMaxAttempts: ACP_ACTIVITY_STREAM_RETRY_MAX_ATTEMPTS,
      },
    });
    return await this.snapshot(userId);
  }

  async replayAcpActivity(
    userId: string,
    input: ReplayAcpActivityInput = {}
  ): Promise<LocalAdeAcpActivityReplay> {
    const projectContext = await this.resolveProjectContext(userId, input.projectId);
    const limit = normalizeAcpTraceExportLimit(input.limit);
    const activeSessions = this.sessionRuntime
      .getAll()
      .filter((session) => session.userId === userId);
    const recentStoredSessions = await this.sessionRepo
      .findAll(userId, { limit: 100 })
      .catch(() => []);
    const ownedChatIds = new Set<string>([
      ...activeSessions.map((session) => session.id),
      ...recentStoredSessions.map((session) => session.id),
    ]);
    const queryLimit = Math.min(
      MAX_ACP_TRACE_EXPORT_ENTRIES * 4,
      Math.max(200, limit * 4)
    );
    const acpLogs = await this.logStore.query({
      acpOnly: true,
      order: "desc",
      limit: queryLimit,
    });
    const ownedEntries = acpLogs.entries.filter((entry) =>
      isOwnedAcpLogEntry({ entry, userId, ownedChatIds })
    );
    const chatFilteredEntries = input.chatId
      ? ownedEntries.filter((entry) => entry.chatId === input.chatId)
      : ownedEntries;
    const correlationFilteredEntries = input.correlationKey
      ? chatFilteredEntries.filter(
          (entry) => acpCorrelationIdentity(entry).key === input.correlationKey
        )
      : chatFilteredEntries;
    const normalizedKind = input.kind?.trim();
    const filteredEntries = normalizedKind
      ? correlationFilteredEntries.filter(
          (entry) => acpActivityKind(entry) === normalizedKind
        )
      : correlationFilteredEntries;
    const chronologicalEntries = [...filteredEntries].sort(
      (left, right) => left.timestamp - right.timestamp
    );
    const replayEntries =
      chronologicalEntries.length > limit
        ? chronologicalEntries.slice(chronologicalEntries.length - limit)
        : chronologicalEntries;
    const snapshot = createAcpActivitySnapshot({
      entries: filteredEntries,
      totalCandidateEntries: input.chatId ? filteredEntries.length : acpLogs.entries.length,
      maxEntries: limit,
    });
    const diagnostics = [...snapshot.diagnostics];
    if (chronologicalEntries.length > replayEntries.length) {
      diagnostics.push(
        `${chronologicalEntries.length - replayEntries.length} older ACP replay frame(s) were omitted by the replay limit.`
      );
    }

    return {
      schemaVersion: 1,
      replayedAt: new Date().toISOString(),
      projectRoot: projectContext.rootPath,
      filters: {
        ...(input.chatId ? { chatId: input.chatId } : {}),
        ...(input.correlationKey ? { correlationKey: input.correlationKey } : {}),
        ...(normalizedKind ? { kind: normalizedKind } : {}),
        limit,
      },
      redacted: true,
      frames: createAcpReplayFrames(replayEntries),
      correlations: snapshot.correlations,
      stats: snapshot.stats,
      diagnostics,
    };
  }

  async saveAcpReplayPreset(
    userId: string,
    input: SaveAcpReplayPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readAcpReplayPresetDocument(context.rootPath);
    const now = new Date().toISOString();
    const requestedId = normalizeOptionalReplayFilter(input.id);
    const existing = requestedId
      ? document.presets.find((preset) => preset.id === requestedId)
      : undefined;
    const chatId = normalizeOptionalReplayFilter(input.chatId);
    const correlationKey = normalizeOptionalReplayFilter(input.correlationKey);
    const kind = normalizeOptionalReplayFilter(input.kind);
    const preset: LocalAdeAcpReplayPreset = {
      id: existing?.id ?? requestedId ?? `acp-replay-${randomUUID()}`,
      name: normalizeAcpReplayPresetName(input.name),
      ...(chatId ? { chatId } : {}),
      ...(correlationKey ? { correlationKey } : {}),
      ...(kind ? { kind } : {}),
      limit: normalizeAcpTraceExportLimit(input.limit),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.lastReplayedAt ? { lastReplayedAt: existing.lastReplayedAt } : {}),
    };
    const nextPresets = [
      preset,
      ...document.presets.filter((item) => item.id !== preset.id),
    ].slice(0, MAX_ACP_REPLAY_PRESETS);
    await writeAcpReplayPresetDocument(context.rootPath, {
      version: 1,
      presets: nextPresets,
    });
    return await this.snapshot(userId);
  }

  async deleteAcpReplayPreset(
    userId: string,
    input: DeleteAcpReplayPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const id = input.id.trim();
    if (!id) {
      throw new Error("ACP replay preset id is required.");
    }
    const document = await readAcpReplayPresetDocument(context.rootPath);
    await writeAcpReplayPresetDocument(context.rootPath, {
      version: 1,
      presets: document.presets.filter((preset) => preset.id !== id),
    });
    return await this.snapshot(userId);
  }

  async searchProjectIndex(
    userId: string,
    input: SearchProjectIndexInput
  ): Promise<LocalAdeRepoIndexSearchResult> {
    const query = input.query.trim();
    if (!query) {
      throw new Error("Project index search query is required.");
    }
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readRepoIndexDocument(context.rootPath);
    return await buildRepoIndexSearchResult({
      query,
      document,
      limit: input.limit,
    });
  }

  async upsertProjectMemoryPreset(
    userId: string,
    input: UpsertProjectMemoryPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const state = await readCapabilityState(context.rootPath);
    const memory = await readProjectMemory(context.rootPath, state);
    const sourcePaths = normalizeProjectMemoryPresetSourcePaths(
      input.sourcePaths,
      memory.sources
    );
    if (sourcePaths.length === 0) {
      throw new Error(
        "Project memory preset requires at least one available memory source."
      );
    }
    const document = await readProjectMemoryPresetDocument(context.rootPath);
    const id = input.id?.trim() || `memory-preset-${randomUUID()}`;
    const previous = document.presets.find((preset) => preset.id === id);
    const now = new Date().toISOString();
    const defaultQuery = normalizeProjectMemoryPresetDefaultQuery(
      input.defaultQuery
    );
    const preset: LocalAdeProjectMemoryPreset = {
      id,
      name: normalizeProjectMemoryPresetName(input.name),
      sourcePaths,
      ...(defaultQuery ? { defaultQuery } : {}),
      retrievalMode: normalizeProjectMemoryRetrievalMode(input.retrievalMode),
      maxBytes: clampProjectMemoryContextBytes(input.maxBytes),
      maxChunks: clampProjectMemorySemanticChunks(input.maxChunks),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      ...(previous?.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}),
      diagnostics: createProjectMemoryPresetDiagnostics(
        { sourcePaths },
        memory.sources
      ),
    };
    await writeProjectMemoryPresetDocument(context.rootPath, {
      version: 1,
      presets: [
        preset,
        ...document.presets.filter((item) => item.id !== preset.id),
      ].slice(0, MAX_PROJECT_MEMORY_PRESETS),
    });
    return await this.snapshot(userId);
  }

  async deleteProjectMemoryPreset(
    userId: string,
    input: DeleteProjectMemoryPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const id = input.id.trim();
    if (!id) {
      throw new Error("Project memory preset id is required.");
    }
    const document = await readProjectMemoryPresetDocument(context.rootPath);
    await writeProjectMemoryPresetDocument(context.rootPath, {
      version: 1,
      presets: document.presets.filter((preset) => preset.id !== id),
    });
    return await this.snapshot(userId);
  }

  async buildProjectMemoryContext(
    userId: string,
    input: BuildProjectMemoryContextInput
  ): Promise<LocalAdeProjectMemoryContextResult> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const state = await readCapabilityState(context.rootPath);
    const presetId = input.presetId?.trim();
    const preset = presetId
      ? (await readProjectMemoryPresetDocument(context.rootPath)).presets.find(
          (item) => item.id === presetId
        )
      : undefined;
    if (presetId && !preset) {
      throw new Error(`Project memory preset ${presetId} was not found.`);
    }
    const query = input.query?.trim() || preset?.defaultQuery?.trim() || "";
    if (!query) {
      throw new Error("Project memory context query is required.");
    }
    return await buildProjectMemoryContextResult({
      rootPath: context.rootPath,
      state,
      query,
      ...(preset ? { preset } : {}),
      retrievalMode: input.retrievalMode ?? preset?.retrievalMode,
      sourceIds: input.sourceIds,
      sourcePaths:
        input.sourcePaths && input.sourcePaths.length > 0
          ? input.sourcePaths
          : preset?.sourcePaths,
      maxBytes: input.maxBytes ?? preset?.maxBytes,
      maxChunks: input.maxChunks ?? preset?.maxChunks,
    });
  }

  async upsertHook(
    userId: string,
    input: UpsertHookInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const id = input.id?.trim() || `hook-${randomUUID()}`;
    const now = new Date().toISOString();
    const previous = document.hooks.find((hook) => hook.id === id);
    const next: StoredHook = {
      id,
      name: input.name.trim(),
      event: normalizeHookEvent(input.event),
      enabled: input.enabled ?? true,
      policyPreset: normalizeExecutionPolicyPreset(input.policyPreset),
      envKeys: sanitizeHookEnvKeys(input.envKeys),
      ...(previous?.trustedFingerprint
        ? { trustedFingerprint: previous.trustedFingerprint }
        : {}),
      ...(previous?.trustedAt ? { trustedAt: previous.trustedAt } : {}),
      command: input.command.trim(),
      args: sanitizeHookArgs(input.args),
      timeoutMs: clampHookTimeout(input.timeoutMs),
      updatedAt: now,
      ...(input.workingDirectory?.trim()
        ? { workingDirectory: normalizeSlash(input.workingDirectory.trim()) }
        : {}),
    };
    if (!next.command) {
      throw new Error("Hook command is required.");
    }
    if (next.workingDirectory) {
      resolveHookWorkingDirectory(context.rootPath, next);
    }
    const index = document.hooks.findIndex((hook) => hook.id === id);
    if (index >= 0) {
      document.hooks[index] = next;
    } else {
      document.hooks.push(next);
    }
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async trustHook(
    userId: string,
    input: TrustHookInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const hook = document.hooks.find((item) => item.id === input.hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${input.hookId}`);
    }
    const fingerprint = hookExecutionFingerprint(hook);
    if (input.fingerprint.trim() !== fingerprint) {
      throw new Error(
        "Hook fingerprint changed before trust approval; refresh and review the current command."
      );
    }
    hook.trustedFingerprint = fingerprint;
    hook.trustedAt = new Date().toISOString();
    hook.updatedAt = hook.trustedAt;
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async toggleHook(
    userId: string,
    input: ToggleHookInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const hook = document.hooks.find((item) => item.id === input.id);
    if (!hook) {
      throw new Error(`Hook not found: ${input.id}`);
    }
    hook.enabled = input.enabled;
    hook.updatedAt = new Date().toISOString();
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async updateHookLifecyclePolicy(
    userId: string,
    input: UpdateHookLifecyclePolicyInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const current = visibleHookLifecyclePolicy(document.lifecyclePolicy);
    document.lifecyclePolicy = {
      enabled: input.enabled ?? current.enabled,
      disabledEvents:
        input.disabledEvents === undefined
          ? current.disabledEvents
          : sanitizeHookLifecycleEvents(input.disabledEvents),
      failureMode: input.failureMode ?? current.failureMode,
      updatedAt: new Date().toISOString(),
    };
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async updateHookSchedulingPolicy(
    userId: string,
    input: UpdateAutomationSchedulingPolicyInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const current = visibleAutomationSchedulingPolicy(document.schedulingPolicy);
    document.schedulingPolicy = {
      enabled: input.enabled ?? current.enabled,
      maxConcurrentRuns:
        input.maxConcurrentRuns === undefined
          ? current.maxConcurrentRuns
          : clampAutomationMaxConcurrentRuns(input.maxConcurrentRuns),
      cooldownMs:
        input.cooldownMs === undefined
          ? current.cooldownMs
          : clampAutomationCooldownMs(input.cooldownMs),
      updatedAt: new Date().toISOString(),
    };
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async approveHookRun(
    userId: string,
    input: ApproveHookRunInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const hook = document.hooks.find((item) => item.id === input.hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${input.hookId}`);
    }
    assertHookReadyForManualRun(hook);
    const operationFingerprint = hookRunOperationFingerprint(hook);
    if (input.operationFingerprint.trim() !== operationFingerprint) {
      throw new Error(
        "Hook run operation changed before approval; refresh and review the current run operation."
      );
    }
    const now = new Date();
    const approval: StoredHookRunApproval = {
      id: `hook-approval-${randomUUID()}`,
      hookId: hook.id,
      operation: "manual-run",
      fingerprint: operationFingerprint,
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + HOOK_RUN_APPROVAL_TTL_MS).toISOString(),
    };
    document.approvals = pruneHookRunApprovals([
      ...document.approvals.filter(
        (item) => !(item.hookId === hook.id && !item.consumedAt)
      ),
      approval,
    ]);
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async runHook(userId: string, input: RunHookInput): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const hook = document.hooks.find((item) => item.id === input.hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${input.hookId}`);
    }
    assertHookReadyForManualRun(hook);
    assertHookRunConfirmation(hook, input.confirmation);
    const operationFingerprint = hookRunOperationFingerprint(hook);
    const approval = document.approvals.find(
      (item) =>
        item.id === input.operationApprovalId.trim() &&
        item.hookId === hook.id &&
        item.fingerprint === operationFingerprint &&
        !item.consumedAt
    );
    if (!approval) {
      throw new Error(
        `Hook run operation must be approved before execution: ${hook.name} (${operationFingerprint})`
      );
    }
    const approvalExpiresMs = Date.parse(approval.expiresAt);
    if (!Number.isFinite(approvalExpiresMs) || approvalExpiresMs <= Date.now()) {
      throw new Error(
        `Hook run operation approval expired before execution: ${hook.name}`
      );
    }
    const slot = acquireAutomationRun({
      rootPath: context.rootPath,
      kind: "hook",
      itemId: hook.id,
      policy: document.schedulingPolicy,
      runs: document.runs,
    });
    let run: LocalAdeHookRun;
    if (slot.state.status !== "ready" || !slot.release) {
      run = createDisabledHookRun({
        hook,
        event: normalizeHookEvent(hook.event),
        batchId: `hook-manual-${randomUUID()}`,
        message: automationSchedulingBlockMessage("hook", hook.name, slot.state),
      });
    } else {
      try {
        run = await runHookProcess({
          rootPath: context.rootPath,
          hook,
        });
      } finally {
        slot.release();
      }
    }
    approval.consumedAt = new Date().toISOString();
    document.runs = [run, ...document.runs].slice(0, MAX_HOOK_RUNS);
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async runHookBatch(
    userId: string,
    input: RunHookBatchInput
  ): Promise<LocalAdeSnapshot> {
    assertHookBatchConfirmation(input.confirmation);
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const hookIds = [...new Set(input.hookIds.map((id) => id.trim()).filter(Boolean))];
    if (hookIds.length === 0) {
      throw new Error("Hook batch requires at least one hook id.");
    }
    if (hookIds.length > MAX_HOOK_BATCH_RUN_ITEMS) {
      throw new Error(
        `Hook batch can include at most ${MAX_HOOK_BATCH_RUN_ITEMS} hook(s).`
      );
    }
    const failureMode: LocalAdeHookLifecycleFailureMode =
      input.failureMode === "stop-on-failure" ? "stop-on-failure" : "continue";
    const batchId = `hook-batch-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const batchRuns: LocalAdeHookRun[] = [];
    const hookNames: string[] = [];
    const diagnostics = [
      `Hook batch confirmation token accepted: ${HOOK_BATCH_CONFIRMATION_TOKEN}.`,
      "Each hook operation fingerprint was rechecked before execution.",
      `Hook batch failure mode: ${failureMode}.`,
    ];
    let stopReason: string | undefined;

    for (const hookId of hookIds) {
      const hook = document.hooks.find((item) => item.id === hookId);
      if (!hook) {
        diagnostics.push(`Hook not found and skipped: ${hookId}.`);
        if (failureMode === "stop-on-failure" && !stopReason) {
          stopReason = `Hook not found: ${hookId}.`;
        }
        continue;
      }
      hookNames.push(hook.name);
      const currentOperationFingerprint = hookRunOperationFingerprint(hook);
      const submittedFingerprint =
        input.operationFingerprints[hook.id]?.trim() ?? "";
      let run: LocalAdeHookRun | undefined;
      const event = normalizeHookEvent(hook.event);

      if (stopReason) {
        run = createDisabledHookRun({
          hook,
          event,
          batchId,
          message: `Hook batch skipped this item because stop-on-failure was triggered earlier: ${stopReason}`,
        });
      }

      if (!run && submittedFingerprint !== currentOperationFingerprint) {
        run = createDisabledHookRun({
          hook,
          event,
          batchId,
          message:
            "Hook batch skipped this item because the run operation fingerprint changed before execution.",
        });
      }

      if (!run) {
        try {
          assertHookReadyForManualRun(hook);
        } catch (error) {
          run = createDisabledHookRun({
            hook,
            event,
            batchId,
            message: `Hook batch skipped this item before spawn: ${errorMessage(error)}`,
          });
        }
      }

      if (!run) {
        const slot = acquireAutomationRun({
          rootPath: context.rootPath,
          kind: "hook",
          itemId: hook.id,
          policy: document.schedulingPolicy,
          runs: [...batchRuns, ...document.runs],
        });
        if (slot.state.status !== "ready" || !slot.release) {
          run = createDisabledHookRun({
            hook,
            event,
            batchId,
            message: automationSchedulingBlockMessage(
              "hook",
              hook.name,
              slot.state
            ),
          });
        } else {
          try {
            try {
              run = await runHookProcess({
                rootPath: context.rootPath,
                hook,
                batchId,
              });
            } finally {
              slot.release();
            }
          } catch (error) {
            run = createFailedHookRun({
              hook,
              event,
              batchId,
              message: `Hook batch failed this item: ${errorMessage(error)}`,
            });
          }
        }
      }

      batchRuns.push(run);
      if (
        failureMode === "stop-on-failure" &&
        !stopReason &&
        run.status !== "success"
      ) {
        stopReason = `${hook.name} ended with status ${run.status}.`;
      }
    }

    const batch = createHookBatchSummary({
      batchId,
      hookIds,
      hookNames,
      failureMode,
      runs: batchRuns,
      startedAt,
      startedMs,
      diagnostics,
    });
    document.runs = [...batchRuns].reverse().concat(document.runs).slice(0, MAX_HOOK_RUNS);
    document.batches = [batch, ...document.batches].slice(0, MAX_HOOK_BATCHES);
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async reviewHookRun(
    userId: string,
    input: ReviewHookRunInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const run = document.runs.find((item) => item.id === input.runId);
    if (!run) {
      throw new Error(`Hook run not found: ${input.runId}`);
    }
    if (input.reviewed) {
      run.reviewedAt = new Date().toISOString();
    } else {
      delete run.reviewedAt;
    }
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async exportHookRuns(
    userId: string,
    input: ExportHookRunsInput = {}
  ): Promise<LocalAdeHookRunExport> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const reviewState = input.reviewState ?? "all";
    const limit = normalizeRunAuditExportLimit(input.limit);
    const matchingRuns = document.runs.filter((run) =>
      matchesRunAuditFilters(run, {
        reviewState,
        ...(input.status ? { status: input.status } : {}),
      })
    );
    const runs = matchingRuns.slice(0, limit).map(sanitizeHookRunForExport);
    const diagnostics =
      matchingRuns.length > runs.length
        ? [
            `${matchingRuns.length - runs.length} hook run(s) were omitted by the export limit.`,
          ]
        : [];

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      projectRoot: context.rootPath,
      filters: {
        reviewState,
        ...(input.status ? { status: input.status } : {}),
        limit,
      },
      redacted: true,
      stats: createRunAuditStats(document.runs, matchingRuns, runs.length),
      runs,
      diagnostics,
    };
  }

  async upsertPlugin(
    userId: string,
    input: UpsertPluginInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const id = input.id?.trim() || `plugin-${randomUUID()}`;
    const now = new Date().toISOString();
    const description = input.description?.trim();
    const previous = document.plugins.find((plugin) => plugin.id === id);
    const policy = normalizePluginPolicy({
      scopes: input.scopes,
      envKeys: input.envKeys,
    });
    const policyPreset = normalizeExecutionPolicyPreset(input.policyPreset);
    const dependencyIds = input.dependencyIds === undefined
      ? previous?.dependencyIds ?? []
      : normalizePluginDependencyIds(input.dependencyIds, id);
    const missingDependencyIds = dependencyIds.filter(
      (dependencyId) => !document.plugins.some((plugin) => plugin.id === dependencyId)
    );
    if (missingDependencyIds.length > 0) {
      throw new Error(
        `Plugin dependency references missing plugin(s): ${missingDependencyIds.join(", ")}.`
      );
    }
    const next: StoredPlugin = {
      id,
      name: input.name.trim(),
      ...(description ? { description } : {}),
      enabled: input.enabled ?? true,
      policyPreset,
      scopes: policy.scopes,
      dependencyIds,
      envKeys: policy.envKeys,
      ...(previous?.trustedFingerprint
        ? { trustedFingerprint: previous.trustedFingerprint }
        : {}),
      ...(previous?.trustedAt ? { trustedAt: previous.trustedAt } : {}),
      ...(previous?.grantedPermissionFingerprint
        ? { grantedPermissionFingerprint: previous.grantedPermissionFingerprint }
        : {}),
      ...(previous?.permissionGrantedAt
        ? { permissionGrantedAt: previous.permissionGrantedAt }
        : {}),
      command: input.command.trim(),
      args: sanitizeHookArgs(input.args),
      timeoutMs: clampPluginTimeout(input.timeoutMs),
      updatedAt: now,
      ...(input.workingDirectory?.trim()
        ? { workingDirectory: normalizeSlash(input.workingDirectory.trim()) }
        : {}),
    };
    if (!next.command) {
      throw new Error("Plugin command is required.");
    }
    if (next.workingDirectory) {
      resolvePluginWorkingDirectory(context.rootPath, next);
    }
    const index = document.plugins.findIndex((plugin) => plugin.id === id);
    if (index >= 0) {
      document.plugins[index] = next;
    } else {
      document.plugins.push(next);
    }
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async installPluginPackage(
    userId: string,
    input: InstallPluginPackageInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const signedPackage = input.registryUrl
      ? await readSignedPluginPackageFromRegistry({
          rootPath: context.rootPath,
          registryUrl: input.registryUrl,
          packageId: input.packageId ?? "",
        })
      : await readSignedPluginPackage({
          rootPath: context.rootPath,
          manifestPath: input.manifestPath ?? "",
        });
    const now = new Date().toISOString();
    const next = createStoredPluginFromSignedPackage(signedPackage, now);
    const index = document.plugins.findIndex((plugin) => plugin.id === next.id);
    if (index >= 0) {
      document.plugins[index] = next;
    } else {
      document.plugins.push(next);
    }
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async revalidatePluginPackage(
    userId: string,
    input: RevalidatePluginPackageInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const plugin = document.plugins.find((item) => item.id === input.pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${input.pluginId}`);
    }
    if (plugin.installSource !== "signed-package") {
      throw new Error(`Plugin is not installed from a signed package: ${plugin.name}`);
    }
    const registryDocument = await readPluginRegistryStateDocument(context.rootPath);
    const now = new Date().toISOString();
    try {
      const signedPackage = await readInstalledSignedPluginPackage({
        rootPath: context.rootPath,
        plugin,
        registryDocument,
      });
      assertStoredPluginPackageMatchesVerification(plugin, signedPackage);
      plugin.packageVerifiedAt = now;
      plugin.packageGovernanceStatus = "verified";
      plugin.packageGovernanceDiagnostics = [
        `Signed package revalidated at ${now}.`,
        `Signature hash pin: ${signedPackage.signatureHash}.`,
        `Public key fingerprint pin: ${signedPackage.publicKeyFingerprint}.`,
      ];
    } catch (error) {
      plugin.packageGovernanceStatus = "verification-failed";
      plugin.packageGovernanceDiagnostics = [
        `Signed package revalidation failed at ${now}: ${errorMessage(error)}`,
      ];
    }
    plugin.updatedAt = now;
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async upsertPluginRegistry(
    userId: string,
    input: UpsertPluginRegistryInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginRegistryStateDocument(context.rootPath);
    const url = parsePluginDistributionUrl(input.url, "Plugin registry URL").toString();
    const id = input.id?.trim() || `registry-${toHashId(input.name, url)}`;
    const previous = document.registries.find((registry) => registry.id === id);
    const now = new Date().toISOString();
    const sameUrl = previous?.url === url;
    const next: StoredPluginRegistry = {
      id,
      name: sanitizeDiagnosticText(input.name.trim()).slice(0, 160),
      url,
      enabled: input.enabled ?? previous?.enabled ?? true,
      ...(sameUrl && previous?.trustedFingerprint
        ? { trustedFingerprint: previous.trustedFingerprint }
        : {}),
      ...(sameUrl && previous?.trustedAt ? { trustedAt: previous.trustedAt } : {}),
      ...(sameUrl && previous?.lastRefreshAt
        ? { lastRefreshAt: previous.lastRefreshAt }
        : {}),
      packages: sameUrl ? previous?.packages ?? [] : [],
      revokedSigners: previous?.revokedSigners ?? [],
      diagnostics: sameUrl ? previous?.diagnostics ?? [] : [],
      updatedAt: now,
    };
    const index = document.registries.findIndex((registry) => registry.id === id);
    if (index >= 0) {
      document.registries[index] = next;
    } else {
      document.registries.push(next);
    }
    await writePluginRegistryStateDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async trustPluginRegistry(
    userId: string,
    input: TrustPluginRegistryInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginRegistryStateDocument(context.rootPath);
    const registry = document.registries.find((item) => item.id === input.registryId);
    if (!registry) {
      throw new Error(`Plugin registry not found: ${input.registryId}`);
    }
    const fingerprint = pluginRegistryFingerprint(registry);
    if (input.fingerprint.trim() !== fingerprint) {
      throw new Error(
        "Plugin registry fingerprint changed before trust approval; refresh and review the current URL."
      );
    }
    const now = new Date().toISOString();
    registry.trustedFingerprint = fingerprint;
    registry.trustedAt = now;
    registry.updatedAt = now;
    await writePluginRegistryStateDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async revokePluginRegistryTrust(
    userId: string,
    input: RevokePluginRegistryTrustInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginRegistryStateDocument(context.rootPath);
    const registry = document.registries.find((item) => item.id === input.registryId);
    if (!registry) {
      throw new Error(`Plugin registry not found: ${input.registryId}`);
    }
    delete registry.trustedFingerprint;
    delete registry.trustedAt;
    registry.updatedAt = new Date().toISOString();
    await writePluginRegistryStateDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async revokePluginRegistrySigner(
    userId: string,
    input: RevokePluginRegistrySignerInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginRegistryStateDocument(context.rootPath);
    const registry = document.registries.find((item) => item.id === input.registryId);
    if (!registry) {
      throw new Error(`Plugin registry not found: ${input.registryId}`);
    }
    const publicKeyFingerprint = normalizeSha256Pin(
      input.publicKeyFingerprint,
      "Plugin registry signer publicKeyFingerprint"
    );
    const reason =
      typeof input.reason === "string" && input.reason.trim()
        ? sanitizeDiagnosticText(input.reason.trim()).slice(0, 240)
        : undefined;
    const now = new Date().toISOString();
    const existing = (registry.revokedSigners ?? []).find(
      (entry) => entry.publicKeyFingerprint === publicKeyFingerprint
    );
    if (existing) {
      existing.revokedAt = now;
      existing.source = "manual";
      if (reason) {
        existing.reason = reason;
      } else {
        delete existing.reason;
      }
    } else {
      registry.revokedSigners = [
        ...(registry.revokedSigners ?? []),
        {
          publicKeyFingerprint,
          revokedAt: now,
          source: "manual" as const,
          ...(reason ? { reason } : {}),
        },
      ].slice(-MAX_DISCOVERY_FILES);
    }
    registry.updatedAt = now;
    await writePluginRegistryStateDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async restorePluginRegistrySigner(
    userId: string,
    input: RestorePluginRegistrySignerInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginRegistryStateDocument(context.rootPath);
    const registry = document.registries.find((item) => item.id === input.registryId);
    if (!registry) {
      throw new Error(`Plugin registry not found: ${input.registryId}`);
    }
    const publicKeyFingerprint = normalizeSha256Pin(
      input.publicKeyFingerprint,
      "Plugin registry signer publicKeyFingerprint"
    );
    const existing = (registry.revokedSigners ?? []).find(
      (entry) => entry.publicKeyFingerprint === publicKeyFingerprint
    );
    if ((existing?.source ?? "manual") === "registry") {
      throw new Error(
        `Plugin registry signer revocation is managed by the registry feed: ${publicKeyFingerprint}`
      );
    }
    registry.revokedSigners = (registry.revokedSigners ?? []).filter(
      (entry) => entry.publicKeyFingerprint !== publicKeyFingerprint
    );
    registry.updatedAt = new Date().toISOString();
    await writePluginRegistryStateDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async refreshPluginRegistry(
    userId: string,
    input: RefreshPluginRegistryInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginRegistryStateDocument(context.rootPath);
    const registry = document.registries.find((item) => item.id === input.registryId);
    if (!registry) {
      throw new Error(`Plugin registry not found: ${input.registryId}`);
    }
    if (!registry.enabled) {
      throw new Error(`Plugin registry is disabled: ${registry.name}`);
    }
    const fingerprint = pluginRegistryFingerprint(registry);
    if (pluginRegistryTrustStatus(registry, fingerprint) !== "trusted") {
      throw new Error(
        `Plugin registry must be trusted before refresh: ${registry.name} (${fingerprint})`
      );
    }
    const now = new Date().toISOString();
    try {
      const refreshed = await fetchPluginRegistryPackages(registry);
      registry.packages = refreshed.packages;
      registry.revokedSigners = mergePluginRegistryRevocations(
        registry.revokedSigners,
        refreshed.revokedSigners
      );
      registry.diagnostics = [];
    } catch (error) {
      registry.diagnostics = [
        sanitizeDiagnosticText(
          error instanceof Error ? error.message : String(error)
        ),
      ];
    }
    registry.lastRefreshAt = now;
    registry.updatedAt = now;
    await writePluginRegistryStateDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async installPluginRegistryPackage(
    userId: string,
    input: InstallPluginRegistryPackageInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const registryDocument = await readPluginRegistryStateDocument(context.rootPath);
    const registry = registryDocument.registries.find(
      (item) => item.id === input.registryId
    );
    if (!registry) {
      throw new Error(`Plugin registry not found: ${input.registryId}`);
    }
    if (!registry.enabled) {
      throw new Error(`Plugin registry is disabled: ${registry.name}`);
    }
    const fingerprint = pluginRegistryFingerprint(registry);
    if (pluginRegistryTrustStatus(registry, fingerprint) !== "trusted") {
      throw new Error(
        `Plugin registry must be trusted before install: ${registry.name} (${fingerprint})`
      );
    }
    const packageRef = (registry.packages ?? []).find(
      (item) => item.id === input.packageId.trim()
    );
    if (!packageRef) {
      throw new Error(`Plugin registry package not found: ${input.packageId}`);
    }
    if (
      pluginPackageExpiryStatus({ packageExpiresAt: packageRef.expiresAt }) ===
      "expired"
    ) {
      throw new Error(
        `Plugin registry package signature has expired: ${packageRef.id}`
      );
    }
    const revocation = pluginRegistrySignerRevocation(
      registry,
      packageRef.publicKeyFingerprint
    );
    if (revocation) {
      throw new Error(
        `Plugin registry signer is revoked: ${packageRef.publicKeyFingerprint}${
          revocation.reason ? ` (${revocation.reason})` : ""
        }`
      );
    }
    const pluginDocument = await readPluginDocument(context.rootPath);
    const signedPackage = await readSignedPluginPackageFromSavedRegistry({
      rootPath: context.rootPath,
      registry,
      packageRef,
    });
    const now = new Date().toISOString();
    const next = createStoredPluginFromSignedPackage(signedPackage, now);
    const index = pluginDocument.plugins.findIndex((plugin) => plugin.id === next.id);
    if (index >= 0) {
      pluginDocument.plugins[index] = next;
    } else {
      pluginDocument.plugins.push(next);
    }
    await writePluginDocument(context.rootPath, pluginDocument);
    return await this.snapshot(userId);
  }

  async trustPlugin(
    userId: string,
    input: TrustPluginInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const plugin = document.plugins.find((item) => item.id === input.pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${input.pluginId}`);
    }
    const fingerprint = pluginExecutionFingerprint(plugin);
    if (input.fingerprint.trim() !== fingerprint) {
      throw new Error(
        "Plugin fingerprint changed before trust approval; refresh and review the current command."
      );
    }
    plugin.trustedFingerprint = fingerprint;
    plugin.trustedAt = new Date().toISOString();
    plugin.grantedPermissionFingerprint = pluginPermissionFingerprint(plugin);
    plugin.permissionGrantedAt = plugin.trustedAt;
    plugin.updatedAt = plugin.trustedAt;
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async updatePluginPermissionGrant(
    userId: string,
    input: UpdatePluginPermissionGrantInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const plugin = document.plugins.find((item) => item.id === input.pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${input.pluginId}`);
    }
    const permissionFingerprint = pluginPermissionFingerprint(plugin);
    if (input.permissionFingerprint.trim() !== permissionFingerprint) {
      throw new Error(
        "Plugin permission fingerprint changed before approval; refresh and review the current scopes, env keys, and workspace access."
      );
    }
    const now = new Date().toISOString();
    if (input.granted) {
      plugin.grantedPermissionFingerprint = permissionFingerprint;
      plugin.permissionGrantedAt = now;
    } else {
      delete plugin.grantedPermissionFingerprint;
      delete plugin.permissionGrantedAt;
    }
    plugin.updatedAt = now;
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async togglePlugin(
    userId: string,
    input: TogglePluginInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const plugin = document.plugins.find((item) => item.id === input.id);
    if (!plugin) {
      throw new Error(`Plugin not found: ${input.id}`);
    }
    plugin.enabled = input.enabled;
    plugin.updatedAt = new Date().toISOString();
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async updatePluginSchedulingPolicy(
    userId: string,
    input: UpdateAutomationSchedulingPolicyInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const current = visibleAutomationSchedulingPolicy(document.schedulingPolicy);
    document.schedulingPolicy = {
      enabled: input.enabled ?? current.enabled,
      maxConcurrentRuns:
        input.maxConcurrentRuns === undefined
          ? current.maxConcurrentRuns
          : clampAutomationMaxConcurrentRuns(input.maxConcurrentRuns),
      cooldownMs:
        input.cooldownMs === undefined
          ? current.cooldownMs
          : clampAutomationCooldownMs(input.cooldownMs),
      updatedAt: new Date().toISOString(),
    };
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async approvePluginRun(
    userId: string,
    input: ApprovePluginRunInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const plugin = document.plugins.find((item) => item.id === input.pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${input.pluginId}`);
    }
    assertPluginReadyForManualRun(plugin);
    const operationFingerprint = pluginRunOperationFingerprint(plugin);
    if (input.operationFingerprint.trim() !== operationFingerprint) {
      throw new Error(
        "Plugin run operation changed before approval; refresh and review the current run operation."
      );
    }
    const now = new Date();
    const approval: StoredPluginRunApproval = {
      id: `plugin-approval-${randomUUID()}`,
      pluginId: plugin.id,
      operation: "manual-run",
      fingerprint: operationFingerprint,
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PLUGIN_RUN_APPROVAL_TTL_MS).toISOString(),
    };
    document.approvals = prunePluginRunApprovals([
      ...document.approvals.filter(
        (item) => !(item.pluginId === plugin.id && !item.consumedAt)
      ),
      approval,
    ]);
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  private async executePluginRunWithWorkspaceAudit(params: {
    userId: string;
    rootPath: string;
    plugin: StoredPlugin;
    slot: { release: () => void };
    batchId?: string;
  }): Promise<LocalAdePluginRun> {
    let slotReleased = false;
    const releaseSlot = () => {
      if (slotReleased) {
        return;
      }
      slotReleased = true;
      params.slot.release();
    };
    try {
    const policy = effectivePluginPolicy({
      scopes: params.plugin.scopes,
      envKeys: params.plugin.envKeys,
      policyPreset: params.plugin.policyPreset,
    });
    const auditsWorkspace = policy.scopes.includes("project-root");
    const activeSessions = auditsWorkspace
      ? this.sessionRuntime
          .getAll()
          .filter(
            (session) =>
              session.userId === params.userId &&
              path.resolve(session.projectRoot) === path.resolve(params.rootPath)
          )
      : [];
    const sessionAttributions = auditsWorkspace
      ? await this.collectCheckpointSessionAttributions(
          params.userId,
          activeSessions
        )
      : [];
    const checkpointDocument = auditsWorkspace
      ? await readCheckpointDocument(params.rootPath)
      : undefined;
    const beforeStatus = auditsWorkspace
      ? await readPluginWorkspaceStatus(params.rootPath)
      : { statusLines: [], diagnostics: [] };
    const preRunCheckpoint =
      auditsWorkspace && beforeStatus.statusLines.length > 0
        ? await createGitCheckpoint({
            rootPath: params.rootPath,
            name: `Safety before plugin: ${params.plugin.name}`,
            sessionIds: activeSessions.map((session) => session.id),
            sessionAttributions,
            restoreMode: "apply-patch",
          })
        : undefined;
    let run: LocalAdePluginRun;
    try {
      run = await runPluginProcess({
        rootPath: params.rootPath,
        plugin: params.plugin,
        ...(params.batchId ? { batchId: params.batchId } : {}),
      });
    } finally {
      releaseSlot();
    }
    const afterStatus = auditsWorkspace
      ? await readPluginWorkspaceStatus(params.rootPath)
      : { statusLines: [], diagnostics: [] };
    const workspaceChangedFiles = auditsWorkspace
      ? pluginWorkspaceChangedFiles(
          beforeStatus.statusLines,
          afterStatus.statusLines
        )
      : [];
    const postRunCheckpoint =
      auditsWorkspace && afterStatus.statusLines.length > 0
        ? await createGitCheckpoint({
            rootPath: params.rootPath,
            name: `Plugin changes after: ${params.plugin.name}`,
            sessionIds: activeSessions.map((session) => session.id),
            sessionAttributions,
          })
        : undefined;
    if (auditsWorkspace) {
      run = {
        ...run,
        ...(preRunCheckpoint ? { preRunCheckpointId: preRunCheckpoint.id } : {}),
        ...(postRunCheckpoint ? { postRunCheckpointId: postRunCheckpoint.id } : {}),
        workspaceStatusBefore: beforeStatus.statusLines,
        workspaceStatusAfter: afterStatus.statusLines,
        workspaceChangedFiles,
        diagnostics: [
          ...run.diagnostics,
          beforeStatus.statusLines.length > 0
            ? `Pre-run workspace status lines: ${beforeStatus.statusLines.length}.`
            : "Pre-run workspace status was clean.",
          afterStatus.statusLines.length > 0
            ? `Post-run workspace status lines: ${afterStatus.statusLines.length}.`
            : "Post-run workspace status is clean.",
          preRunCheckpoint
            ? `Plugin pre-run safety checkpoint created: ${preRunCheckpoint.id}.`
            : "Plugin pre-run safety checkpoint was not needed.",
          postRunCheckpoint
            ? `Plugin post-run change checkpoint created: ${postRunCheckpoint.id}.`
            : "Plugin post-run change checkpoint was not needed.",
          workspaceChangedFiles.length > 0
            ? `Plugin workspace changed files: ${workspaceChangedFiles.join(", ")}.`
            : "Plugin did not change tracked workspace status.",
          ...beforeStatus.diagnostics,
          ...afterStatus.diagnostics,
        ],
      };
    }
    if (checkpointDocument && (preRunCheckpoint || postRunCheckpoint)) {
      checkpointDocument.checkpoints = [
        ...(postRunCheckpoint ? [postRunCheckpoint] : []),
        ...(preRunCheckpoint ? [preRunCheckpoint] : []),
        ...checkpointDocument.checkpoints,
      ].slice(0, MAX_CHECKPOINTS);
      await writeCheckpointDocument(params.rootPath, checkpointDocument);
    }
    return run;
    } catch (error) {
      releaseSlot();
      throw error;
    }
  }

  async runPlugin(
    userId: string,
    input: RunPluginInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const plugin = document.plugins.find((item) => item.id === input.pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${input.pluginId}`);
    }
    assertPluginReadyForManualRun(plugin);
    assertPluginRunConfirmation(plugin, input.confirmation);
    const operationFingerprint = pluginRunOperationFingerprint(plugin);
    const approval = document.approvals.find(
      (item) =>
        item.id === input.operationApprovalId.trim() &&
        item.pluginId === plugin.id &&
        item.fingerprint === operationFingerprint &&
        !item.consumedAt
    );
    if (!approval) {
      throw new Error(
        `Plugin run operation must be approved before execution: ${plugin.name} (${operationFingerprint})`
      );
    }
    const approvalExpiresMs = Date.parse(approval.expiresAt);
    if (!Number.isFinite(approvalExpiresMs) || approvalExpiresMs <= Date.now()) {
      throw new Error(
        `Plugin run operation approval expired before execution: ${plugin.name}`
      );
    }
    const slot = acquireAutomationRun({
      rootPath: context.rootPath,
      kind: "plugin",
      itemId: plugin.id,
      policy: document.schedulingPolicy,
      runs: document.runs,
    });
    if (slot.state.status !== "ready" || !slot.release) {
      const run = createDisabledPluginRun({
        plugin,
        message: automationSchedulingBlockMessage("plugin", plugin.name, slot.state),
      });
      approval.consumedAt = new Date().toISOString();
      document.runs = [run, ...document.runs].slice(0, MAX_PLUGIN_RUNS);
      await writePluginDocument(context.rootPath, document);
      return await this.snapshot(userId);
    }
    const run = await this.executePluginRunWithWorkspaceAudit({
      userId,
      rootPath: context.rootPath,
      plugin,
      slot: { release: slot.release },
    });
    approval.consumedAt = new Date().toISOString();
    document.runs = [run, ...document.runs].slice(0, MAX_PLUGIN_RUNS);
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async runPluginBatch(
    userId: string,
    input: RunPluginBatchInput
  ): Promise<LocalAdeSnapshot> {
    assertPluginBatchConfirmation(input.confirmation);
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const pluginIds = [...new Set(input.pluginIds.map((id) => id.trim()).filter(Boolean))];
    if (pluginIds.length === 0) {
      throw new Error("Plugin batch requires at least one plugin id.");
    }
    if (pluginIds.length > MAX_PLUGIN_BATCH_RUN_ITEMS) {
      throw new Error(
        `Plugin batch can include at most ${MAX_PLUGIN_BATCH_RUN_ITEMS} plugin(s).`
      );
    }
    const failureMode: LocalAdePluginBatchFailureMode =
      input.failureMode === "stop-on-failure" ? "stop-on-failure" : "continue";
    const batchPlan = createPluginBatchExecutionPlan(document, pluginIds);

    const batchId = `plugin-batch-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const batchRuns: LocalAdePluginRun[] = [];
    const batchPluginNames: string[] = [];
    const diagnostics: string[] = [
      `Plugin batch confirmation token accepted: ${PLUGIN_BATCH_CONFIRMATION_TOKEN}.`,
      "Each plugin operation fingerprint was rechecked before execution.",
      `Plugin batch failure mode: ${failureMode}.`,
      ...batchPlan.diagnostics,
    ];
    const runStatusByPluginId = new Map<string, LocalAdeHookRun["status"]>();
    let stopReason: string | undefined;

    for (const pluginId of batchPlan.orderedPluginIds) {
      const plugin = document.plugins.find((item) => item.id === pluginId);
      if (!plugin) {
        diagnostics.push(`Plugin not found and skipped: ${pluginId}.`);
        if (failureMode === "stop-on-failure" && !stopReason) {
          stopReason = `Plugin not found: ${pluginId}.`;
        }
        continue;
      }
      batchPluginNames.push(plugin.name);
      const currentOperationFingerprint = pluginRunOperationFingerprint(plugin);
      const submittedFingerprint =
        input.operationFingerprints[plugin.id]?.trim() ?? "";
      let run: LocalAdePluginRun | undefined;

      if (stopReason) {
        run = createDisabledPluginRun({
          plugin,
          batchId,
          message: `Plugin batch skipped this item because stop-on-failure was triggered earlier: ${stopReason}`,
        });
      }

      if (!run && batchPlan.cyclePluginIds.has(plugin.id)) {
        run = createDisabledPluginRun({
          plugin,
          batchId,
          message: "Plugin batch skipped this item because its dependency graph contains a cycle.",
        });
      }

      const missingDependencyIds = batchPlan.missingDependenciesByPluginId.get(plugin.id) ?? [];
      if (!run && missingDependencyIds.length > 0) {
        run = createDisabledPluginRun({
          plugin,
          batchId,
          message: `Plugin batch skipped this item because dependency plugin(s) are missing from the selected batch: ${missingDependencyIds.join(", ")}.`,
        });
      }

      const failedDependencyIds = normalizePluginDependencyIds(
        plugin.dependencyIds,
        plugin.id
      ).filter((dependencyId) => {
        if (!batchPlan.requestedSet.has(dependencyId)) {
          return false;
        }
        const status = runStatusByPluginId.get(dependencyId);
        return status !== undefined && status !== "success";
      });
      if (!run && failedDependencyIds.length > 0) {
        run = createDisabledPluginRun({
          plugin,
          batchId,
          message: `Plugin batch skipped this item because dependency plugin(s) did not complete successfully: ${failedDependencyIds.join(", ")}.`,
        });
      }

      if (!run && submittedFingerprint !== currentOperationFingerprint) {
        run = createDisabledPluginRun({
          plugin,
          batchId,
          message:
            "Plugin batch skipped this item because the run operation fingerprint changed before execution.",
        });
      }

      if (!run) {
        try {
          assertPluginReadyForManualRun(plugin);
        } catch (error) {
          run = createDisabledPluginRun({
            plugin,
            batchId,
            message: `Plugin batch skipped this item before spawn: ${errorMessage(error)}`,
          });
        }
      }

      if (!run) {
        const slot = acquireAutomationRun({
          rootPath: context.rootPath,
          kind: "plugin",
          itemId: plugin.id,
          policy: document.schedulingPolicy,
          runs: [...batchRuns, ...document.runs],
        });
        if (slot.state.status !== "ready" || !slot.release) {
          run = createDisabledPluginRun({
            plugin,
            batchId,
            message: automationSchedulingBlockMessage(
              "plugin",
              plugin.name,
              slot.state
            ),
          });
        } else {
          try {
            run = await this.executePluginRunWithWorkspaceAudit({
              userId,
              rootPath: context.rootPath,
              plugin,
              slot: { release: slot.release },
              batchId,
            });
          } catch (error) {
            run = createFailedPluginRun({
              plugin,
              batchId,
              message: `Plugin batch failed this item: ${errorMessage(error)}`,
            });
          }
        }
      }

      batchRuns.push(run);
      runStatusByPluginId.set(plugin.id, run.status);
      if (
        failureMode === "stop-on-failure" &&
        !stopReason &&
        run.status !== "success"
      ) {
        stopReason = `${plugin.name} ended with status ${run.status}.`;
      }
    }

    const batch = createPluginBatchSummary({
      batchId,
      pluginIds: batchPlan.orderedPluginIds,
      pluginNames: batchPluginNames,
      failureMode,
      runs: batchRuns,
      startedAt,
      startedMs,
      diagnostics,
    });
    document.runs = [...batchRuns].reverse().concat(document.runs).slice(0, MAX_PLUGIN_RUNS);
    document.batches = [batch, ...document.batches].slice(0, MAX_PLUGIN_BATCHES);
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async upsertPluginBatchPreset(
    userId: string,
    input: UpsertPluginBatchPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const name = input.name.trim();
    if (!name) {
      throw new Error("Plugin batch preset name is required.");
    }
    const pluginIds = [
      ...new Set(input.pluginIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (pluginIds.length === 0) {
      throw new Error("Plugin batch preset requires at least one plugin id.");
    }
    if (pluginIds.length > MAX_PLUGIN_BATCH_RUN_ITEMS) {
      throw new Error(
        `Plugin batch preset can include at most ${MAX_PLUGIN_BATCH_RUN_ITEMS} plugin(s).`
      );
    }
    const missingIds = pluginIds.filter(
      (pluginId) => !document.plugins.some((plugin) => plugin.id === pluginId)
    );
    if (missingIds.length > 0) {
      throw new Error(
        `Plugin batch preset references missing plugin(s): ${missingIds.join(", ")}.`
      );
    }
    const presetId = input.id?.trim() || `plugin-batch-preset-${randomUUID()}`;
    const now = new Date().toISOString();
    const existing = document.batchPresets.find((preset) => preset.id === presetId);
    const failureMode: LocalAdePluginBatchFailureMode =
      input.failureMode === "stop-on-failure" ? "stop-on-failure" : "continue";
    const pluginNames = pluginIds.map(
      (pluginId) =>
        document.plugins.find((plugin) => plugin.id === pluginId)?.name ?? pluginId
    );
    const preset: LocalAdePluginBatchPreset = {
      id: presetId,
      name,
      pluginIds,
      pluginNames,
      failureMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.lastRunBatchId ? { lastRunBatchId: existing.lastRunBatchId } : {}),
      diagnostics: [
        `Preset contains ${pluginIds.length} plugin(s).`,
        `Failure mode: ${failureMode}.`,
      ],
    };
    document.batchPresets = [
      preset,
      ...document.batchPresets.filter((item) => item.id !== presetId),
    ].slice(0, MAX_PLUGIN_BATCH_PRESETS);
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async deletePluginBatchPreset(
    userId: string,
    input: DeletePluginBatchPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const presetId = input.presetId.trim();
    const before = document.batchPresets.length;
    document.batchPresets = document.batchPresets.filter(
      (preset) => preset.id !== presetId
    );
    if (document.batchPresets.length === before) {
      throw new Error(`Plugin batch preset not found: ${presetId}`);
    }
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async runPluginBatchPreset(
    userId: string,
    input: RunPluginBatchPresetInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const presetId = input.presetId.trim();
    const preset = document.batchPresets.find((item) => item.id === presetId);
    if (!preset) {
      throw new Error(`Plugin batch preset not found: ${presetId}`);
    }
    const snapshot = await this.runPluginBatch(userId, {
      projectId: input.projectId,
      pluginIds: preset.pluginIds,
      operationFingerprints: input.operationFingerprints,
      confirmation: input.confirmation,
      failureMode: preset.failureMode,
    });
    const updatedDocument = await readPluginDocument(context.rootPath);
    const updatedPreset = updatedDocument.batchPresets.find(
      (item) => item.id === presetId
    );
    if (updatedPreset) {
      const latestBatch = updatedDocument.batches[0];
      if (latestBatch) {
        updatedPreset.lastRunBatchId = latestBatch.id;
        updatedPreset.updatedAt = new Date().toISOString();
        await writePluginDocument(context.rootPath, updatedDocument);
        return await this.snapshot(userId);
      }
    }
    return snapshot;
  }

  async upsertPluginBatchSchedule(
    userId: string,
    input: UpsertPluginBatchScheduleInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const name = input.name.trim();
    if (!name) {
      throw new Error("Plugin batch schedule name is required.");
    }
    const presetId = input.presetId.trim();
    const preset = document.batchPresets.find((item) => item.id === presetId);
    if (!preset) {
      throw new Error(`Plugin batch preset not found: ${presetId}`);
    }
    const operationFingerprints = sanitizePluginBatchOperationFingerprints(
      input.operationFingerprints
    );
    const missingFingerprintIds = preset.pluginIds.filter(
      (pluginId) => !operationFingerprints[pluginId]
    );
    if (missingFingerprintIds.length > 0) {
      throw new Error(
        `Plugin batch schedule is missing operation fingerprint(s): ${missingFingerprintIds.join(", ")}.`
      );
    }
    const scheduleId =
      input.id?.trim() || `plugin-batch-schedule-${randomUUID()}`;
    const existing = document.batchSchedules.find(
      (schedule) => schedule.id === scheduleId
    );
    const now = new Date().toISOString();
    const schedule: StoredPluginBatchSchedule = {
      id: scheduleId,
      name: sanitizeDiagnosticText(name).slice(0, 120),
      presetId,
      enabled: input.enabled ?? existing?.enabled ?? true,
      intervalMs: clampPluginBatchScheduleIntervalMs(input.intervalMs),
      nextRunAt: normalizePluginBatchScheduleNextRunAt(
        input.nextRunAt,
        existing?.nextRunAt ?? now
      ),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
      ...(existing?.lastRunBatchId
        ? { lastRunBatchId: existing.lastRunBatchId }
        : {}),
      ...(existing?.lastRunStatus
        ? { lastRunStatus: existing.lastRunStatus }
        : {}),
      operationFingerprints,
      diagnostics: [
        `Scheduled plugin batch preset: ${preset.name}.`,
        `Interval: ${clampPluginBatchScheduleIntervalMs(input.intervalMs)}ms.`,
      ],
    };
    document.batchSchedules = [
      schedule,
      ...document.batchSchedules.filter((item) => item.id !== scheduleId),
    ].slice(0, MAX_PLUGIN_BATCH_SCHEDULES);
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async deletePluginBatchSchedule(
    userId: string,
    input: DeletePluginBatchScheduleInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const scheduleId = input.scheduleId.trim();
    const before = document.batchSchedules.length;
    document.batchSchedules = document.batchSchedules.filter(
      (schedule) => schedule.id !== scheduleId
    );
    if (document.batchSchedules.length === before) {
      throw new Error(`Plugin batch schedule not found: ${scheduleId}`);
    }
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async runDuePluginBatchSchedules(
    userId: string,
    input: RunDuePluginBatchSchedulesInput = {}
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const nowMs = Number.isFinite(Date.parse(input.now ?? ""))
      ? Date.parse(input.now ?? "")
      : Date.now();
    const selectedScheduleIds = new Set(
      (input.scheduleIds ?? []).map((id) => id.trim()).filter(Boolean)
    );
    let document = await readPluginDocument(context.rootPath);
    const dueSchedules = document.batchSchedules.filter((schedule) => {
      if (selectedScheduleIds.size > 0 && !selectedScheduleIds.has(schedule.id)) {
        return false;
      }
      if (!schedule.enabled) {
        return false;
      }
      const nextRunMs = Date.parse(schedule.nextRunAt);
      return Number.isFinite(nextRunMs) && nextRunMs <= nowMs;
    });

    for (const dueSchedule of dueSchedules) {
      const scheduleId = dueSchedule.id;
      const scheduleNow = new Date().toISOString();
      const nextRunAt = new Date(nowMs + dueSchedule.intervalMs).toISOString();
      const preset = document.batchPresets.find(
        (item) => item.id === dueSchedule.presetId
      );
      if (!preset) {
        const schedule = document.batchSchedules.find(
          (item) => item.id === scheduleId
        );
        if (schedule) {
          schedule.lastRunAt = scheduleNow;
          schedule.lastRunStatus = "blocked";
          delete schedule.lastRunBatchId;
          schedule.nextRunAt = nextRunAt;
          schedule.updatedAt = scheduleNow;
          schedule.diagnostics = [
            `Scheduled plugin batch skipped because preset is missing: ${dueSchedule.presetId}.`,
          ];
          await writePluginDocument(context.rootPath, document);
        }
        continue;
      }

      try {
        await this.runPluginBatch(userId, {
          projectId: input.projectId,
          pluginIds: preset.pluginIds,
          operationFingerprints: dueSchedule.operationFingerprints,
          confirmation: PLUGIN_BATCH_CONFIRMATION_TOKEN,
          failureMode: preset.failureMode,
        });
        document = await readPluginDocument(context.rootPath);
        const schedule = document.batchSchedules.find(
          (item) => item.id === scheduleId
        );
        const latestBatch = document.batches[0];
        if (schedule) {
          schedule.lastRunAt = scheduleNow;
          schedule.lastRunStatus = latestBatch?.status ?? "blocked";
          if (latestBatch) {
            schedule.lastRunBatchId = latestBatch.id;
          } else {
            delete schedule.lastRunBatchId;
          }
          schedule.nextRunAt = nextRunAt;
          schedule.updatedAt = scheduleNow;
          schedule.diagnostics = [
            latestBatch
              ? `Scheduled plugin batch executed: ${latestBatch.id}.`
              : "Scheduled plugin batch execution did not produce a batch summary.",
            `Next scheduled run: ${nextRunAt}.`,
          ];
          await writePluginDocument(context.rootPath, document);
        }
      } catch (error) {
        document = await readPluginDocument(context.rootPath);
        const schedule = document.batchSchedules.find(
          (item) => item.id === scheduleId
        );
        if (schedule) {
          schedule.lastRunAt = scheduleNow;
          schedule.lastRunStatus = "blocked";
          delete schedule.lastRunBatchId;
          schedule.nextRunAt = nextRunAt;
          schedule.updatedAt = scheduleNow;
          schedule.diagnostics = [
            `Scheduled plugin batch failed before execution: ${errorMessage(error)}`,
            `Next scheduled run: ${nextRunAt}.`,
          ];
          await writePluginDocument(context.rootPath, document);
        }
      }
    }

    return await this.snapshot(userId);
  }

  async dispatchDuePluginBatchSchedules(input: {
    userIds: string[];
    now?: string;
  }): Promise<LocalAdePluginBatchScheduleDispatchResult> {
    const userIds = [...new Set(input.userIds.map((id) => id.trim()).filter(Boolean))];
    const nowIso = Number.isFinite(Date.parse(input.now ?? ""))
      ? new Date(Date.parse(input.now ?? "")).toISOString()
      : new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const result: LocalAdePluginBatchScheduleDispatchResult = {
      users: userIds.length,
      projects: 0,
      dueSchedules: 0,
      dispatchedSchedules: 0,
      failedProjects: 0,
    };

    for (const userId of userIds) {
      let projects: Awaited<ReturnType<ProjectRepositoryPort["findAll"]>>;
      try {
        projects = await this.projectRepo.findAll(userId);
      } catch {
        result.failedProjects += 1;
        continue;
      }
      for (const project of projects) {
        result.projects += 1;
        let dueSchedules = 0;
        try {
          const document = await readPluginDocument(project.path);
          dueSchedules = document.batchSchedules.filter((schedule) => {
            if (!schedule.enabled) {
              return false;
            }
            const nextRunMs = Date.parse(schedule.nextRunAt);
            return Number.isFinite(nextRunMs) && nextRunMs <= nowMs;
          }).length;
          if (dueSchedules === 0) {
            continue;
          }
          result.dueSchedules += dueSchedules;
          await this.runDuePluginBatchSchedules(userId, {
            projectId: project.id,
            now: nowIso,
          });
          result.dispatchedSchedules += dueSchedules;
        } catch {
          result.failedProjects += 1;
        }
      }
    }

    return result;
  }

  async reviewPluginRun(
    userId: string,
    input: ReviewPluginRunInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const run = document.runs.find((item) => item.id === input.runId);
    if (!run) {
      throw new Error(`Plugin run not found: ${input.runId}`);
    }
    if (input.reviewed) {
      run.reviewedAt = new Date().toISOString();
    } else {
      delete run.reviewedAt;
    }
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async exportPluginRuns(
    userId: string,
    input: ExportPluginRunsInput = {}
  ): Promise<LocalAdePluginRunExport> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readPluginDocument(context.rootPath);
    const reviewState = input.reviewState ?? "all";
    const limit = normalizeRunAuditExportLimit(input.limit);
    const matchingRuns = document.runs.filter((run) =>
      matchesRunAuditFilters(run, {
        reviewState,
        ...(input.status ? { status: input.status } : {}),
      })
    );
    const runs = matchingRuns.slice(0, limit).map(sanitizePluginRunForExport);
    const diagnostics =
      matchingRuns.length > runs.length
        ? [
            `${matchingRuns.length - runs.length} plugin run(s) were omitted by the export limit.`,
          ]
        : [];

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      projectRoot: context.rootPath,
      filters: {
        reviewState,
        ...(input.status ? { status: input.status } : {}),
        limit,
      },
      redacted: true,
      stats: createRunAuditStats(document.runs, matchingRuns, runs.length),
      runs,
      diagnostics,
    };
  }

  async updateCapabilityState(
    userId: string,
    input: UpdateCapabilityStateInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    if (input.capabilityId.startsWith("hook.project.")) {
      const hookId = input.capabilityId.slice("hook.project.".length);
      return await this.toggleHook(userId, {
        ...(input.projectId ? { projectId: input.projectId } : {}),
        id: hookId,
        enabled: input.enabled,
      });
    }
    if (input.capabilityId.startsWith("plugin.project.")) {
      const pluginId = input.capabilityId.slice("plugin.project.".length);
      return await this.togglePlugin(userId, {
        ...(input.projectId ? { projectId: input.projectId } : {}),
        id: pluginId,
        enabled: input.enabled,
      });
    }
    const state = await readCapabilityState(context.rootPath);
    const updatedAt = new Date().toISOString();
    if (input.capabilityId.startsWith("memory.")) {
      state.memory ??= {};
      state.memory[input.capabilityId] = {
        enabled: input.enabled,
        updatedAt,
      };
    } else {
      state.capabilities[input.capabilityId] = {
        enabled: input.enabled,
        updatedAt,
      };
    }
    await writeCapabilityState(context.rootPath, state);
    return await this.snapshot(userId);
  }

  async upsertMcpServer(
    userId: string,
    input: UpsertMcpServerInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const id = input.id?.trim() || `mcp-${randomUUID()}`;
    const now = new Date().toISOString();
    const headers = sanitizeMcpHeaderRecord(input.headers);
    const unsafeHeaders = unsafeLiteralMcpHeaderNames(headers);
    if (unsafeHeaders.length > 0) {
      throw new Error(
        `MCP literal secret headers are not stored: ${unsafeHeaders.join(
          ", "
        )}. Configure header env mapping instead.`
      );
    }
    const headerEnv = sanitizeMcpHeaderEnvRecord(input.headerEnv);
    const index = document.servers.findIndex((server) => server.id === id);
    const previous = index >= 0 ? document.servers[index] : undefined;
    const remoteControls = normalizeMcpRemoteControls(
      input.remoteControls ?? previous?.remoteControls
    );
    const next: StoredMcpServer = {
      id,
      name: input.name.trim(),
      transport: input.transport,
      enabled: input.enabled ?? true,
      ...(input.command?.trim() ? { command: input.command.trim() } : {}),
      ...(input.args?.length
        ? { args: input.args.map((arg) => arg.trim()).filter(Boolean) }
        : {}),
      ...(input.url?.trim() ? { url: input.url.trim() } : {}),
      ...(input.messageEndpoint?.trim()
        ? { messageEndpoint: input.messageEndpoint.trim() }
        : {}),
      ...(sanitizeRecord(input.env) ? { env: sanitizeRecord(input.env) } : {}),
      ...(headers ? { headers } : {}),
      ...(headerEnv ? { headerEnv } : {}),
      ...(remoteControls ? { remoteControls } : {}),
      ...(previous?.probeHistory?.length
        ? { probeHistory: previous.probeHistory }
        : {}),
      ...(previous?.invocationHistory?.length
        ? { invocationHistory: previous.invocationHistory }
        : {}),
      ...(previous?.notificationHistory?.length
        ? { notificationHistory: previous.notificationHistory }
        : {}),
      ...(previous?.notificationMonitorHistory?.length
        ? { notificationMonitorHistory: previous.notificationMonitorHistory }
        : {}),
      ...(previous?.trustedFingerprint
        ? { trustedFingerprint: previous.trustedFingerprint }
        : {}),
      ...(previous?.trustedAt ? { trustedAt: previous.trustedAt } : {}),
      updatedAt: now,
    };
    if (index >= 0) {
      document.servers[index] = next;
    } else {
      document.servers.push(next);
    }
    await writeMcpDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async toggleMcpServer(
    userId: string,
    input: ToggleMcpServerInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.id);
    if (server) {
      server.enabled = input.enabled;
      server.updatedAt = new Date().toISOString();
      await writeMcpDocument(context.rootPath, document);
    }
    return await this.snapshot(userId);
  }

  async trustMcpServer(
    userId: string,
    input: TrustMcpServerInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
    }
    const fingerprint = mcpInvocationFingerprint(server);
    if (input.fingerprint.trim() !== fingerprint) {
      throw new Error(
        "MCP server fingerprint changed before trust approval; refresh and review the current server configuration."
      );
    }
    server.trustedFingerprint = fingerprint;
    server.trustedAt = new Date().toISOString();
    server.updatedAt = server.trustedAt;
    await writeMcpDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async probeMcpServer(
    userId: string,
    input: ProbeMcpServerInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.id);
    if (!server) {
      throw new Error(`MCP server not found: ${input.id}`);
    }
    const visible = await toVisibleMcpServer(context.rootPath, server);
    const run = createMcpProbeRun(visible);
    server.probeHistory = [run, ...(server.probeHistory ?? [])].slice(
      0,
      MAX_MCP_PROBE_HISTORY
    );
    server.notificationHistory = visible.notificationHistory.slice(
      0,
      MAX_MCP_NOTIFICATION_HISTORY
    );
    await writeMcpDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async invokeMcpTool(
    userId: string,
    input: InvokeMcpToolInput
  ): Promise<LocalAdeMcpInvocationResult> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
    }
    const toolName = input.toolName.trim();
    if (!toolName) {
      throw new Error("MCP tool name is required.");
    }
    const result = await invokeMcpMethod({
      rootPath: context.rootPath,
      server,
      method: "tools/call",
      methodParams: {
        name: toolName,
        arguments: input.arguments ?? {},
      },
      target: toolName,
    });
    recordMcpInvocation(document, server.id, result);
    await writeMcpDocument(context.rootPath, document);
    return result;
  }

  async readMcpResource(
    userId: string,
    input: ReadMcpResourceInput
  ): Promise<LocalAdeMcpInvocationResult> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
    }
    const uri = input.uri.trim();
    if (!uri) {
      throw new Error("MCP resource URI is required.");
    }
    const result = await invokeMcpMethod({
      rootPath: context.rootPath,
      server,
      method: "resources/read",
      methodParams: { uri },
      target: uri,
    });
    recordMcpInvocation(document, server.id, result);
    await writeMcpDocument(context.rootPath, document);
    return result;
  }

  async watchMcpNotifications(
    userId: string,
    input: WatchMcpNotificationsInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
    }
    const requestedDurationMs = normalizeMcpNotificationWatchMs(
      input.durationMs ?? mcpNotificationWatchMs(server)
    );
    const startedAtMs = Date.now();
    let run: LocalAdeMcpNotificationMonitorRun;
    const fingerprint = mcpInvocationFingerprint(server);
    const trustStatus = mcpTrustStatus(server, fingerprint);
    if (!server.enabled) {
      run = createMcpNotificationMonitorRun({
        server,
        status: "failed",
        startedAtMs,
        requestedDurationMs,
        reconnectCount: 0,
        streamOpenCount: 0,
        notifications: [],
        diagnostics: ["MCP notification monitor blocked because the server is disabled."],
      });
    } else if (trustStatus !== "trusted") {
      run = createMcpNotificationMonitorRun({
        server,
        status: "failed",
        startedAtMs,
        requestedDurationMs,
        reconnectCount: 0,
        streamOpenCount: 0,
        notifications: [],
        diagnostics: [
          trustStatus === "changed"
            ? `MCP server configuration changed after trust approval. Review and trust fingerprint ${fingerprint} before watching notifications.`
            : `MCP server must be trusted before watching notifications. Review and trust fingerprint ${fingerprint}.`,
        ],
      });
    } else if (server.transport !== "sse") {
      run = createMcpNotificationMonitorRun({
        server,
        status: "unsupported",
        startedAtMs,
        requestedDurationMs,
        reconnectCount: 0,
        streamOpenCount: 0,
        notifications: [],
        diagnostics: [
          `MCP notification monitor currently supports SSE servers; ${server.transport} notifications are captured during probe and invocation.`,
        ],
      });
    } else if (!server.url) {
      run = createMcpNotificationMonitorRun({
        server,
        status: "failed",
        startedAtMs,
        requestedDurationMs,
        reconnectCount: 0,
        streamOpenCount: 0,
        notifications: [],
        diagnostics: ["MCP SSE server is missing URL."],
      });
    } else {
      run = await watchSseMcpNotifications(server, requestedDurationMs);
    }
    recordMcpNotificationMonitor(document, server.id, run);
    await writeMcpDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async configureMcpRemoteControls(
    userId: string,
    input: ConfigureMcpRemoteControlsInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readMcpDocument(context.rootPath);
    const server = document.servers.find((item) => item.id === input.serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${input.serverId}`);
    }
    const currentFingerprint = mcpInvocationFingerprint(server);
    if (input.fingerprint.trim() !== currentFingerprint) {
      throw new Error(
        "MCP server fingerprint changed before remote controls update; refresh and review the current server configuration."
      );
    }
    const remoteControls = normalizeMcpRemoteControls({
      requestTimeoutMs: input.requestTimeoutMs,
      reconnectAttempts: input.reconnectAttempts,
      notificationWatchMs: input.notificationWatchMs,
    });
    if (remoteControls) {
      server.remoteControls = remoteControls;
    } else {
      delete server.remoteControls;
    }
    server.updatedAt = new Date().toISOString();
    await writeMcpDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async testProvider(
    userId: string,
    input: TestProviderInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const agents = await this.agentRepo.findAll(userId);
    const providerId = input.providerId.trim();
    const agentId = providerId.startsWith("provider.agent.")
      ? providerId.slice("provider.agent.".length)
      : providerId;
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error(`Provider agent not found: ${providerId}`);
    }

    const command = agent.command.trim();
    const providerHealthId = `provider.agent.${agent.id}`;
    const healthDocument = await readProviderHealthDocument(context.rootPath);
    const startedAt = Date.now();
    const readiness = await probeProviderReadiness(agent).catch(
      (error): ProviderReadinessProbe => ({
        cliStatus: "failed",
        authStatus: "unknown",
        modelStatus: "unknown",
        readiness: "unavailable",
        modelList: [],
        diagnostics: [`Provider readiness probe failed: ${errorMessage(error)}`],
        remediation: providerReadinessRemediation({
          providerKind: agent.type,
          command: agent.command.trim(),
          cliStatus: "failed",
          authStatus: "unknown",
          modelStatus: "unknown",
          modelList: [],
        }),
      })
    );
    const record: ProviderHealthRecord = {
      status: readiness.readiness === "unavailable" ? "unavailable" : readiness.readiness,
      cliStatus: readiness.cliStatus,
      authStatus: readiness.authStatus,
      modelStatus: readiness.modelStatus,
      readiness: readiness.readiness,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      ...(readiness.version ? { version: readiness.version } : {}),
      ...(readiness.modelList.length > 0 ? { modelList: readiness.modelList } : {}),
      diagnostics: [
        ...readiness.diagnostics,
        `Readiness summary: CLI ${readiness.cliStatus}, auth ${readiness.authStatus}, model ${readiness.modelStatus}.`,
        `Provider probe completed for ${command} without exposing secret values.`,
      ],
      remediation: readiness.remediation,
    };

    healthDocument.providers[providerHealthId] = record;
    await writeProviderHealthDocument(context.rootPath, healthDocument);
    return await this.snapshot(userId);
  }

  async selectProviderModel(
    userId: string,
    input: SelectProviderModelInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const providerId = input.providerId.trim();
    const modelId = input.modelId.trim();
    if (!modelId) {
      throw new Error("Provider model id is required.");
    }

    const agentId = providerId.startsWith("provider.agent.")
      ? providerId.slice("provider.agent.".length)
      : providerId;
    const agents = await this.agentRepo.findAll(userId);
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error(`Provider agent not found: ${providerId}`);
    }

    const healthDocument = await readProviderHealthDocument(context.rootPath);
    const health = healthDocument.providers[`provider.agent.${agent.id}`];
    const discoveredModels = health?.modelList ?? [];
    if (
      !health ||
      health.modelStatus !== "ok" ||
      !discoveredModels.includes(modelId)
    ) {
      throw new Error(
        "Provider model selection requires a successful readiness probe with the model in the discovered model list."
      );
    }

    const current = await this.settingsRepo.get();
    const nextApp = this.appConfigService.validatePatch({
      defaultModel: modelId,
    });
    const settings = await this.settingsRepo.update({ app: nextApp });
    this.appConfigService.reloadFromSettings(settings);
    if (current.app.defaultModel !== settings.app.defaultModel) {
      await this.eventBus?.publish({
        type: "settings_updated",
        changedKeys: ["app.defaultModel"],
        requiresRestart: [],
      });
      await this.eventBus?.publish({
        type: "dashboard_refresh",
        reason: "settings_updated",
      });
    }

    return await this.snapshot(userId);
  }

  async clearProviderModel(
    userId: string,
    input: ClearProviderModelInput = {}
  ): Promise<LocalAdeSnapshot> {
    await this.resolveProjectContext(userId, input.projectId);
    const current = await this.settingsRepo.get();
    const nextApp = this.appConfigService.validatePatch({ defaultModel: "" });
    const settings = await this.settingsRepo.update({ app: nextApp });
    this.appConfigService.reloadFromSettings(settings);
    if (current.app.defaultModel !== settings.app.defaultModel) {
      await this.eventBus?.publish({
        type: "settings_updated",
        changedKeys: ["app.defaultModel"],
        requiresRestart: [],
      });
      await this.eventBus?.publish({
        type: "dashboard_refresh",
        reason: "settings_updated",
      });
    }
    return await this.snapshot(userId);
  }

  async createCheckpoint(
    userId: string,
    input: CreateCheckpointInput = {}
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const activeSessions = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      );
    const activeSessionIds = activeSessions.map((session) => session.id);
    const sessionAttributions = await this.collectCheckpointSessionAttributions(
      userId,
      activeSessions
    );
    const checkpoint = await createGitCheckpoint({
      rootPath: context.rootPath,
      name: input.name,
      sessionIds: activeSessionIds,
      sessionAttributions,
    });
    document.checkpoints = [checkpoint, ...document.checkpoints].slice(
      0,
      MAX_CHECKPOINTS
    );
    await writeCheckpointDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-checkpoint-create"
    );
    return await this.snapshot(userId);
  }

  async previewCheckpoint(
    userId: string,
    input: PreviewCheckpointInput
  ): Promise<LocalAdeCheckpointPreview> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpoint = document.checkpoints.find(
      (item) => item.id === input.checkpointId
    );
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    return await readCheckpointPreview({
      rootPath: context.rootPath,
      checkpoint,
    });
  }

  async restoreCheckpoint(
    userId: string,
    input: RestoreCheckpointInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpointIndex = document.checkpoints.findIndex(
      (item) => item.id === input.checkpointId
    );
    if (checkpointIndex < 0) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const checkpoint = document.checkpoints[checkpointIndex];
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const expectedConfirmation = checkpointRestoreToken(checkpoint);
    if (input.confirmation.trim() !== expectedConfirmation) {
      throw new Error(`Type '${expectedConfirmation}' to restore this checkpoint.`);
    }
    const preview = await readCheckpointPreview({
      rootPath: context.rootPath,
      checkpoint,
    });
    if (!preview.canRestore) {
      throw new Error(
        preview.restoreBlockers.map((blocker) => blocker.reason).join(" ")
      );
    }
    const activeSessions = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      );
    const activeSessionIds = activeSessions.map((session) => session.id);
    const sessionAttributions = await this.collectCheckpointSessionAttributions(
      userId,
      activeSessions
    );
    const safetyCheckpoint = await createGitCheckpoint({
      rootPath: context.rootPath,
      name: `Safety before restore: ${checkpoint.name}`,
      sessionIds: activeSessionIds,
      sessionAttributions,
      restoreMode: "apply-patch",
      safetyForCheckpointId: checkpoint.id,
    });
    const restored = await restoreGitCheckpoint({
      rootPath: context.rootPath,
      checkpoint,
      confirmation: input.confirmation,
    });
    let safetyToStore: LocalAdeCheckpoint | null = null;
    if (safetyCheckpoint.patchBytes > 0) {
      safetyToStore = {
        ...safetyCheckpoint,
        restoreStatusLines: await readGitStatusLines(context.rootPath).catch(
          () => []
        ),
        diagnostics: [
          `Automatic pre-restore safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply the pre-restore patch if needed.`,
          ...safetyCheckpoint.diagnostics,
        ],
      };
    }
    const restoredWithSafety = {
      ...restored,
      ...(safetyToStore
        ? { preRestoreSafetyCheckpointId: safetyToStore.id }
        : {}),
      diagnostics: [
        ...(safetyToStore
          ? [`Pre-restore safety checkpoint created: ${safetyToStore.id}.`]
          : ["Pre-restore safety checkpoint was empty and was not retained."]),
        ...restored.diagnostics,
      ],
    };
    const replaced = document.checkpoints.map((item) =>
      item.id === checkpoint.id ? restoredWithSafety : item
    );
    document.checkpoints = [
      ...(safetyToStore ? [safetyToStore] : []),
      ...replaced,
    ].slice(0, MAX_CHECKPOINTS);
    await writeCheckpointDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-checkpoint-restore"
    );
    return await this.snapshot(userId);
  }

  async shelveCheckpointConflicts(
    userId: string,
    input: ShelveCheckpointConflictsInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpointIndex = document.checkpoints.findIndex(
      (item) => item.id === input.checkpointId
    );
    if (checkpointIndex < 0) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const checkpoint = document.checkpoints[checkpointIndex];
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const expectedConfirmation = checkpointRestoreToken(checkpoint);
    if (input.confirmation.trim() !== expectedConfirmation) {
      throw new Error(`Type '${expectedConfirmation}' to shelve checkpoint blockers.`);
    }
    const preview = await readCheckpointPreview({
      rootPath: context.rootPath,
      checkpoint,
    });
    const shelf = await shelveCheckpointConflictFiles({
      rootPath: context.rootPath,
      checkpoint,
      files: input.files,
      risks: preview.restoreRisks,
    });

    const updatedCheckpoint: LocalAdeCheckpoint = {
      ...checkpoint,
      conflictShelves: [shelf, ...(checkpoint.conflictShelves ?? [])].slice(0, 12),
      diagnostics: [
        `Checkpoint conflict blockers shelved at ${shelf.shelfPath}.`,
        ...checkpoint.diagnostics,
      ],
    };
    document.checkpoints = document.checkpoints.map((item) =>
      item.id === checkpoint.id ? updatedCheckpoint : item
    );
    await writeCheckpointDocument(context.rootPath, document);
    return await this.snapshot(userId);
  }

  async resolveCheckpointTrackedConflicts(
    userId: string,
    input: ResolveCheckpointTrackedConflictsInput
  ): Promise<LocalAdeSnapshot> {
    return await this.resolveCheckpointTrackedConflictChoice(userId, {
      ...input,
      resolution: "restore",
    });
  }

  async resolveCheckpointTrackedConflictChoice(
    userId: string,
    input: ResolveCheckpointTrackedConflictChoiceInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpointIndex = document.checkpoints.findIndex(
      (item) => item.id === input.checkpointId
    );
    if (checkpointIndex < 0) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const checkpoint = document.checkpoints[checkpointIndex];
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    if (input.resolution !== "restore" && input.resolution !== "current") {
      throw new Error(`Unsupported tracked checkpoint resolution: ${input.resolution}`);
    }
    const selectedFiles = normalizeCheckpointRestoreFiles(input.files);
    const expectedConfirmation = checkpointRestoreToken(checkpoint);
    if (input.confirmation.trim() !== expectedConfirmation) {
      throw new Error(
        `Type '${expectedConfirmation}' to resolve tracked checkpoint conflicts.`
      );
    }
    const preview = await readCheckpointPreview({
      rootPath: context.rootPath,
      checkpoint,
    });
    const risksByFile = new Map(preview.restoreRisks.map((risk) => [risk.file, risk]));
    const unsupported = selectedFiles.filter(
      (file) => !isResolvableTrackedCheckpointConflictRisk(risksByFile.get(file))
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Only tracked checkpoint patch conflicts can be resolved automatically: ${unsupported.join(
          ", "
        )}`
      );
    }

    if (input.resolution === "current") {
      const resolvedAt = new Date().toISOString();
      const updatedCheckpoint: LocalAdeCheckpoint = {
        ...checkpoint,
        partialRestores: [
          {
            restoredAt: resolvedAt,
            files: selectedFiles,
            resolution: "current",
          },
          ...(checkpoint.partialRestores ?? []),
        ],
        diagnostics: [
          `Tracked checkpoint conflicts resolved by keeping current content for ${selectedFiles.join(
            ", "
          )} at ${resolvedAt}; future full restore omits these files.`,
          ...checkpoint.diagnostics,
        ],
      };
      document.checkpoints = document.checkpoints.map((item) =>
        item.id === checkpoint.id ? updatedCheckpoint : item
      );
      await writeCheckpointDocument(context.rootPath, document);
      await this.runLifecycleHooksForProject(
        context.rootPath,
        "after-checkpoint-restore"
      );
      return await this.snapshot(userId);
    }

    const activeSessions = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      );
    const activeSessionIds = activeSessions.map((session) => session.id);
    const sessionAttributions = await this.collectCheckpointSessionAttributions(
      userId,
      activeSessions
    );
    const safetyCheckpoint = await createGitCheckpoint({
      rootPath: context.rootPath,
      name: `Safety before tracked conflict resolve: ${checkpoint.name}`,
      sessionIds: activeSessionIds,
      sessionAttributions,
      restoreMode: "apply-patch",
      safetyForCheckpointId: checkpoint.id,
      files: selectedFiles,
    });
    if (safetyCheckpoint.patchBytes <= 0) {
      throw new Error(
        "Tracked checkpoint conflict resolution requires a safety checkpoint with tracked changes."
      );
    }

    await runGit(context.rootPath, ["checkout", "--", ...selectedFiles]);
    const restoreStatusLines = filterStatusLinesByFiles(
      await readGitStatusLines(context.rootPath).catch(() => []),
      selectedFiles
    );
    const safetyToStore: LocalAdeCheckpoint = {
      ...safetyCheckpoint,
      restoreStatusLines,
      diagnostics: [
        `Automatic tracked-conflict safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply the pre-resolution tracked file content if needed.`,
        ...safetyCheckpoint.diagnostics,
      ],
    };
    const resolvedAt = new Date().toISOString();
    const updatedCheckpoint: LocalAdeCheckpoint = {
      ...checkpoint,
      partialRestores: [
        {
          restoredAt: resolvedAt,
          files: selectedFiles,
          resolution: "restore",
          safetyCheckpointId: safetyToStore.id,
        },
        ...(checkpoint.partialRestores ?? []),
      ],
      diagnostics: [
        `Tracked checkpoint conflicts resolved for ${selectedFiles.join(
          ", "
        )} at ${resolvedAt}; safety checkpoint ${safetyToStore.id} can re-apply the previous content.`,
        ...checkpoint.diagnostics,
      ],
    };
    document.checkpoints = [
      safetyToStore,
      ...document.checkpoints.map((item) =>
        item.id === checkpoint.id ? updatedCheckpoint : item
      ),
    ].slice(0, MAX_CHECKPOINTS);
    await writeCheckpointDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-checkpoint-restore"
    );
    return await this.snapshot(userId);
  }

  async resolveCheckpointTrackedConflictHunks(
    userId: string,
    input: ResolveCheckpointTrackedConflictHunksInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpointIndex = document.checkpoints.findIndex(
      (item) => item.id === input.checkpointId
    );
    if (checkpointIndex < 0) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const checkpoint = document.checkpoints[checkpointIndex];
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const expectedConfirmation = checkpointRestoreToken(checkpoint);
    if (input.confirmation.trim() !== expectedConfirmation) {
      throw new Error(
        `Type '${expectedConfirmation}' to resolve tracked checkpoint conflict hunks.`
      );
    }

    const selectedPatch = await buildSelectedCheckpointHunkPatch({
      rootPath: context.rootPath,
      checkpoint,
      hunks: input.hunks,
    });
    const preview = await readCheckpointPreview({
      rootPath: context.rootPath,
      checkpoint,
    });
    const risksByFile = new Map(preview.restoreRisks.map((risk) => [risk.file, risk]));
    const unsupported = selectedPatch.files.filter(
      (file) => !isResolvableTrackedCheckpointConflictRisk(risksByFile.get(file))
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Only tracked checkpoint patch conflicts can use hunk-level choices: ${unsupported.join(
          ", "
        )}`
      );
    }
    const hunkChoices = buildCheckpointTrackedConflictHunkChoices({
      diffFiles: preview.diffFiles,
      selectedPatch,
    });

    const activeSessions = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      );
    const activeSessionIds = activeSessions.map((session) => session.id);
    const sessionAttributions = await this.collectCheckpointSessionAttributions(
      userId,
      activeSessions
    );
    const safetyCheckpoint = await createPatchBackedCheckpoint({
      rootPath: context.rootPath,
      name: `Safety before tracked hunk conflict resolve: ${checkpoint.name}`,
      sessionIds: activeSessionIds,
      sessionAttributions,
      restoreMode: "apply-patch",
      safetyForCheckpointId: checkpoint.id,
      patch: selectedPatch.patch,
      changedFiles: selectedPatch.files,
      statusLines: filterStatusLinesByFiles(
        await readGitStatusLines(context.rootPath).catch(() => []),
        selectedPatch.files
      ),
      diagnostics: [
        `Automatic tracked-conflict hunk safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply the pre-resolution selected hunks if needed.`,
      ],
    });

    const restored = await restoreGitCheckpointHunks({
      rootPath: context.rootPath,
      checkpoint,
      confirmation: input.confirmation,
      selectedPatch,
      partialRestore: {
        resolution: "mixed",
        hunkChoices,
      },
      diagnosticLabel: "Tracked checkpoint conflict hunk choices",
    });

    let safetyToStore: LocalAdeCheckpoint | null = null;
    if (safetyCheckpoint.patchBytes > 0) {
      const restoreStatusLines = filterStatusLinesByFiles(
        await readGitStatusLines(context.rootPath).catch(() => []),
        selectedPatch.files
      );
      safetyToStore = {
        ...safetyCheckpoint,
        restoreStatusLines,
        diagnostics: [
          `Automatic tracked-conflict hunk safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply the pre-resolution selected hunks if needed.`,
          ...safetyCheckpoint.diagnostics,
        ],
      };
    }

    const partialRestores = restored.checkpoint.partialRestores ?? [];
    const latestPartialRestore = partialRestores[0];
    const partialRestoresWithSafety = latestPartialRestore
      ? [
          {
            ...latestPartialRestore,
            ...(safetyToStore ? { safetyCheckpointId: safetyToStore.id } : {}),
          },
          ...partialRestores.slice(1),
        ]
      : [];
    const restoredWithSafety: LocalAdeCheckpoint = {
      ...restored.checkpoint,
      partialRestores: partialRestoresWithSafety,
      diagnostics: [
        ...(safetyToStore
          ? [`Tracked-conflict hunk safety checkpoint created: ${safetyToStore.id}.`]
          : [
              "Tracked-conflict hunk safety checkpoint was empty and was not retained.",
            ]),
        ...restored.checkpoint.diagnostics,
      ],
    };
    const replaced = document.checkpoints.map((item) =>
      item.id === checkpoint.id ? restoredWithSafety : item
    );
    document.checkpoints = [
      ...(safetyToStore ? [safetyToStore] : []),
      ...replaced,
    ].slice(0, MAX_CHECKPOINTS);
    await writeCheckpointDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-checkpoint-restore"
    );
    return await this.snapshot(userId);
  }

  async restoreCheckpointFiles(
    userId: string,
    input: RestoreCheckpointFilesInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpointIndex = document.checkpoints.findIndex(
      (item) => item.id === input.checkpointId
    );
    if (checkpointIndex < 0) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const checkpoint = document.checkpoints[checkpointIndex];
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const selectedFiles = normalizeCheckpointRestoreFiles(input.files);
    const expectedConfirmation = checkpointRestoreToken(checkpoint);
    if (input.confirmation.trim() !== expectedConfirmation) {
      throw new Error(`Type '${expectedConfirmation}' to restore selected files.`);
    }

    const activeSessions = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      );
    const activeSessionIds = activeSessions.map((session) => session.id);
    const sessionAttributions = await this.collectCheckpointSessionAttributions(
      userId,
      activeSessions
    );
    const safetyCheckpoint = await createGitCheckpoint({
      rootPath: context.rootPath,
      name: `Safety before selected restore: ${checkpoint.name}`,
      sessionIds: activeSessionIds,
      sessionAttributions,
      restoreMode: "apply-patch",
      safetyForCheckpointId: checkpoint.id,
      files: selectedFiles,
    });

    const restored = await restoreGitCheckpointFiles({
      rootPath: context.rootPath,
      checkpoint,
      confirmation: input.confirmation,
      files: selectedFiles,
    });

    let safetyToStore: LocalAdeCheckpoint | null = null;
    if (safetyCheckpoint.patchBytes > 0) {
      const restoreStatusLines = filterStatusLinesByFiles(
        await readGitStatusLines(context.rootPath).catch(() => []),
        selectedFiles
      );
      safetyToStore = {
        ...safetyCheckpoint,
        restoreStatusLines,
        diagnostics: [
          `Automatic selected-file safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply the selected pre-restore patch if needed.`,
          ...safetyCheckpoint.diagnostics,
        ],
      };
    }

    const partialRestores = restored.checkpoint.partialRestores ?? [];
    const latestPartialRestore = partialRestores[0];
    const partialRestoresWithSafety = latestPartialRestore
      ? [
          {
            ...latestPartialRestore,
            ...(safetyToStore ? { safetyCheckpointId: safetyToStore.id } : {}),
          },
          ...partialRestores.slice(1),
        ]
      : [];
    const restoredWithSafety: LocalAdeCheckpoint = {
      ...restored.checkpoint,
      partialRestores: partialRestoresWithSafety,
      diagnostics: [
        ...(safetyToStore
          ? [`Selected-file safety checkpoint created: ${safetyToStore.id}.`]
          : ["Selected-file safety checkpoint was empty and was not retained."]),
        ...restored.checkpoint.diagnostics,
      ],
    };
    const replaced = document.checkpoints.map((item) =>
      item.id === checkpoint.id ? restoredWithSafety : item
    );
    document.checkpoints = [
      ...(safetyToStore ? [safetyToStore] : []),
      ...replaced,
    ].slice(0, MAX_CHECKPOINTS);
    await writeCheckpointDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-checkpoint-restore"
    );
    return await this.snapshot(userId);
  }

  async restoreCheckpointHunks(
    userId: string,
    input: RestoreCheckpointHunksInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readCheckpointDocument(context.rootPath);
    const checkpointIndex = document.checkpoints.findIndex(
      (item) => item.id === input.checkpointId
    );
    if (checkpointIndex < 0) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const checkpoint = document.checkpoints[checkpointIndex];
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${input.checkpointId}`);
    }
    const expectedConfirmation = checkpointRestoreToken(checkpoint);
    if (input.confirmation.trim() !== expectedConfirmation) {
      throw new Error(`Type '${expectedConfirmation}' to restore selected hunks.`);
    }

    const selectedPatch = await buildSelectedCheckpointHunkPatch({
      rootPath: context.rootPath,
      checkpoint,
      hunks: input.hunks,
    });

    const activeSessions = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      );
    const activeSessionIds = activeSessions.map((session) => session.id);
    const sessionAttributions = await this.collectCheckpointSessionAttributions(
      userId,
      activeSessions
    );
    const safetyCheckpoint = await createPatchBackedCheckpoint({
      rootPath: context.rootPath,
      name: `Safety before selected hunk restore: ${checkpoint.name}`,
      sessionIds: activeSessionIds,
      sessionAttributions,
      restoreMode: "apply-patch",
      safetyForCheckpointId: checkpoint.id,
      patch: selectedPatch.patch,
      changedFiles: selectedPatch.files,
      statusLines: filterStatusLinesByFiles(
        await readGitStatusLines(context.rootPath).catch(() => []),
        selectedPatch.files
      ),
      diagnostics: [
        `Automatic selected-hunk safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply only the selected hunk patch if needed.`,
      ],
    });

    const restored = await restoreGitCheckpointHunks({
      rootPath: context.rootPath,
      checkpoint,
      confirmation: input.confirmation,
      selectedPatch,
    });

    let safetyToStore: LocalAdeCheckpoint | null = null;
    if (safetyCheckpoint.patchBytes > 0) {
      const restoreStatusLines = filterStatusLinesByFiles(
        await readGitStatusLines(context.rootPath).catch(() => []),
        selectedPatch.files
      );
      safetyToStore = {
        ...safetyCheckpoint,
        restoreStatusLines,
        diagnostics: [
          `Automatic selected-hunk safety checkpoint for ${checkpoint.id}. Restore this checkpoint to re-apply only the selected hunk patch if needed.`,
          ...safetyCheckpoint.diagnostics,
        ],
      };
    }

    const partialRestores = restored.checkpoint.partialRestores ?? [];
    const latestPartialRestore = partialRestores[0];
    const partialRestoresWithSafety = latestPartialRestore
      ? [
          {
            ...latestPartialRestore,
            ...(safetyToStore ? { safetyCheckpointId: safetyToStore.id } : {}),
          },
          ...partialRestores.slice(1),
        ]
      : [];
    const restoredWithSafety: LocalAdeCheckpoint = {
      ...restored.checkpoint,
      partialRestores: partialRestoresWithSafety,
      diagnostics: [
        ...(safetyToStore
          ? [`Selected-hunk safety checkpoint created: ${safetyToStore.id}.`]
          : ["Selected-hunk safety checkpoint was empty and was not retained."]),
        ...restored.checkpoint.diagnostics,
      ],
    };
    const replaced = document.checkpoints.map((item) =>
      item.id === checkpoint.id ? restoredWithSafety : item
    );
    document.checkpoints = [
      ...(safetyToStore ? [safetyToStore] : []),
      ...replaced,
    ].slice(0, MAX_CHECKPOINTS);
    await writeCheckpointDocument(context.rootPath, document);
    await this.runLifecycleHooksForProject(
      context.rootPath,
      "after-checkpoint-restore"
    );
    return await this.snapshot(userId);
  }

  private async collectCheckpointSessionAttributions(
    userId: string,
    activeSessions: RuntimeSession[]
  ): Promise<LocalAdeCheckpointSessionAttribution[]> {
    const limited = activeSessions.slice(0, MAX_CHECKPOINT_SESSION_ATTRIBUTIONS);
    const attributions = await Promise.all(
      limited.map(async (session) => {
        const active = runtimeCheckpointAttribution(session);
        let storedAttribution: LocalAdeCheckpointSessionAttribution | undefined;
        try {
          const stored = await this.sessionRepo.findById(session.id, userId);
          if (stored) {
            let latestStoredMessage = stored.messages.at(-1);
            if (!latestStoredMessage) {
              latestStoredMessage = (
                await this.sessionRepo.getMessagesPage(session.id, userId, {
                  direction: "backward",
                  limit: 1,
                })
              ).messages.at(-1);
            }
            storedAttribution = storedCheckpointAttribution(
              stored,
              latestStoredMessage
            );
          }
        } catch {
          storedAttribution = undefined;
        }
        return mergeCheckpointAttribution(active, storedAttribution);
      })
    );
    return attributions;
  }

  private async runLifecycleHooksForProject(
    rootPath: string,
    event: string,
    context?: Record<string, string | undefined>
  ): Promise<void> {
    const document = await readHookDocument(rootPath);
    const updated = await runLifecycleHooks({
      rootPath,
      document,
      event,
      context,
    });
    if (updated.runs !== document.runs) {
      await writeHookDocument(rootPath, updated);
    }
  }

  private async resolveProjectContext(
    userId: string,
    projectId?: string
  ): Promise<ProjectContext> {
    const [projects, activeProjectId] = await Promise.all([
      this.projectRepo.findAll(userId),
      this.projectRepo.getActiveId(userId),
    ]);
    const targetProjectId = projectId ?? activeProjectId ?? undefined;
    const activeProject =
      (targetProjectId
        ? projects.find((project) => project.id === targetProjectId)
        : undefined) ?? projects[0];
    const fallbackRoot = getFallbackRepoRoot();
    const rootPath = path.resolve(activeProject?.path ?? fallbackRoot);
    return {
      rootPath,
      activeProjectId: activeProject?.id ?? activeProjectId ?? null,
      activeProjectPath: activeProject?.path ?? null,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        favorite: project.favorite,
        lastOpenedAt: project.lastOpenedAt,
      })),
    };
  }
}
