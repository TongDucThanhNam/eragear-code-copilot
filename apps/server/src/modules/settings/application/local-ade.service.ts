import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import type { DomainEvent } from "@/shared/types/domain-events.types";
import type { LogEntry, LogLevel } from "@/shared/types/log.types";
import { isRecord } from "@/shared/utils/type-guards.util";

const execFileAsync = promisify(execFile);
const STATE_FILE = "capabilities-state.json";
const MCP_FILE = "mcp-servers.json";
const MCP_AGENT_AUDIT_FILE = "mcp-agent-audit.jsonl";
const PROVIDER_HEALTH_FILE = "provider-health.json";
const CHECKPOINTS_FILE = "checkpoints.json";
const CHECKPOINT_PATCH_DIR = "checkpoints";
const REPO_INDEX_FILE = "repo-index.json";
const HOOKS_FILE = "hooks.json";
const PLUGINS_FILE = "plugins.json";
const MAX_DISCOVERY_FILES = 160;
const MAX_MARKDOWN_BYTES = 96_000;
const MAX_MEMORY_PREVIEW_BYTES = 16_000;
const MAX_PROJECT_MEMORY_CONTEXT_BYTES = 24_000;
const MAX_REPO_INDEX_FILES = 2_000;
const MAX_REPO_INDEX_VISIBLE_FILES = 160;
const MAX_REPO_INDEX_SYMBOLS = 400;
const MAX_REPO_INDEX_TASKS = 240;
const MAX_REPO_INDEX_FILE_SCAN_BYTES = 128_000;
const MAX_REPO_INDEX_SEARCH_RESULTS = 32;
const DEFAULT_REPO_INDEX_SEARCH_RESULTS = 12;
const MAX_REPO_INDEX_QUERY_TOKENS = 12;
const MAX_HOOK_RUNS = 40;
const MAX_PLUGIN_RUNS = 40;
const MAX_HOOK_OUTPUT_BYTES = 16_000;
const DEFAULT_HOOK_TIMEOUT_MS = 10_000;
const MAX_HOOK_TIMEOUT_MS = 30_000;
const DEFAULT_PLUGIN_TIMEOUT_MS = 10_000;
const MAX_PLUGIN_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 4000;
const PROBE_TIMEOUT_MS = 2500;
const MCP_PROTOCOL_TIMEOUT_MS = 3500;
const MCP_SSE_RECONNECT_ATTEMPTS = 1;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MAX_MCP_PROBE_HISTORY = 8;
const MAX_MCP_INVOCATION_HISTORY = 12;
const MAX_MCP_AGENT_INVOCATION_HISTORY = 24;
const MAX_MCP_NOTIFICATION_HISTORY = 24;
const MAX_MCP_INVOCATION_OUTPUT_BYTES = 16_000;
const MAX_MCP_NOTIFICATION_PAYLOAD_BYTES = 4_000;
const MAX_CHECKPOINTS = 80;
const MAX_CHECKPOINT_PREVIEW_BYTES = 32_000;
const MAX_CHECKPOINT_SESSION_ATTRIBUTIONS = 16;
const MAX_CHECKPOINT_MESSAGE_PREVIEW_CHARS = 180;
const MAX_ACP_ACTIVITY_ENTRIES = 50;
const MAX_ACP_ACTIVITY_CORRELATIONS = 12;
const MAX_ACP_TRACE_EXPORT_ENTRIES = 500;
const MAX_CHECKPOINT_DIFF_FILES = 24;
const MAX_CHECKPOINT_DIFF_ROWS_PER_FILE = 180;
const MAX_CHECKPOINT_RESTORE_FILES = 24;
const MAX_CHECKPOINT_RESTORE_HUNKS = 24;
const MAX_DIAGNOSTIC_CHARS = 900;
const MAX_MCP_DISCOVERY_ITEMS = 80;
const SECRET_HINT_PATTERN =
  /(api[_-]?key|secret|token|password|private[_-]?key|authorization|cookie)/i;
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

interface CapabilityStateDocument {
  version: 1;
  capabilities: Record<string, { enabled: boolean; updatedAt: string }>;
  memory?: Record<string, { enabled: boolean; updatedAt: string }>;
}

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
  diagnostics: string[];
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

export interface LocalAdeProjectMemoryContextResult {
  status: "ready" | "no-enabled-sources";
  query: string;
  sources: LocalAdeProjectMemoryContextSource[];
  prompt: string;
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
  source: "probe" | "invocation";
  method: string;
  receivedAt: string;
  payloadText: string;
  truncated: boolean;
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
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "failed" | "timeout" | "disabled";
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  diagnostics: string[];
}

export interface LocalAdeHookDescriptor {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
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
  lastRun?: LocalAdeHookRun;
  diagnostics: string[];
}

export interface LocalAdePluginRun {
  id: string;
  pluginId: string;
  pluginName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: LocalAdeHookRun["status"];
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  diagnostics: string[];
}

export type LocalAdePluginScope = (typeof PLUGIN_SCOPE_VALUES)[number];

export interface LocalAdePluginDescriptor {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  scopes: LocalAdePluginScope[];
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
  lastRun?: LocalAdePluginRun;
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
    | "diagnostics"
  > {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  headerEnv?: Record<string, string>;
  probeHistory?: LocalAdeMcpProbeRun[];
  invocationHistory?: LocalAdeMcpInvocationResult[];
  notificationHistory?: LocalAdeMcpNotification[];
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

interface RepoIndexDocument {
  version: 1;
  rootPath: string;
  indexedAt: string;
  files: LocalAdeRepoIndexFile[];
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
  envKeys?: string[];
  trustedFingerprint?: string;
  trustedAt?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
  updatedAt: string;
}

interface HookDocument {
  version: 1;
  hooks: StoredHook[];
  runs: LocalAdeHookRun[];
}

interface StoredPlugin {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  scopes?: LocalAdePluginScope[];
  envKeys?: string[];
  trustedFingerprint?: string;
  trustedAt?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
  updatedAt: string;
}

interface PluginDocument {
  version: 1;
  plugins: StoredPlugin[];
  runs: LocalAdePluginRun[];
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

export interface TestProviderInput {
  projectId?: string;
  providerId: string;
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
  query: string;
  sourceIds?: string[];
  sourcePaths?: string[];
  maxBytes?: number;
}

export interface UpsertHookInput {
  projectId?: string;
  id?: string;
  name: string;
  event?: string;
  enabled?: boolean;
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

export interface RunHookInput {
  projectId?: string;
  hookId: string;
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
  scopes?: LocalAdePluginScope[];
  envKeys?: string[];
  command: string;
  args?: string[];
  timeoutMs?: number;
  workingDirectory?: string;
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

export interface RunPluginInput {
  projectId?: string;
  pluginId: string;
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
  status: "available" | "partial" | "blocked";
  electronSurface: string;
  sourceFile: string;
  blockerFile?: string;
  reason?: string;
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
    hunks?: Array<{
      file: string;
      hunkIndex: number;
      header: string;
    }>;
    safetyCheckpointId?: string;
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

export interface LocalAdeAcpActivitySnapshot {
  entries: LocalAdeAcpActivityEntry[];
  correlations: LocalAdeAcpActivityCorrelation[];
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

export interface LocalAdeAcpActivityExport extends LocalAdeAcpActivitySnapshot {
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
  providers: LocalAdeProviderDescriptor[];
  capabilities: ReturnType<typeof createCapabilityRegistrySnapshot>;
  projectMemory: {
    sources: LocalAdeMemorySource[];
    warnings: string[];
  };
  projectIndex: LocalAdeRepoIndexSnapshot;
  hooks: {
    configPath: string;
    items: LocalAdeHookDescriptor[];
    recentRuns: LocalAdeHookRun[];
  };
  plugins: {
    configPath: string;
    items: LocalAdePluginDescriptor[];
    recentRuns: LocalAdePluginRun[];
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
    electronSurface: "Sidebar project tree and Local ADE Control Center",
    sourceFile: "apps/server/src/presentation/dashboard/components/projects-tab.tsx",
  },
  {
    workflow: "Sessions",
    status: "available",
    electronSurface: "Sidebar session tree and Local ADE Control Center",
    sourceFile: "apps/server/src/presentation/dashboard/components/sessions-tab.tsx",
  },
  {
    workflow: "Agents and runtime allowlists",
    status: "available",
    electronSurface: "Settings dialog and Local ADE Control Center",
    sourceFile: "apps/server/src/presentation/dashboard/components/agents-tab.tsx",
  },
  {
    workflow: "Logs and observability",
    status: "available",
    electronSurface: "Local ADE Control Center timeline",
    sourceFile: "apps/server/src/presentation/dashboard/components/logs-tab.tsx",
  },
  {
    workflow: "Boot settings",
    status: "partial",
    electronSurface: "Settings dialog runtime allowlist panel",
    sourceFile: "apps/server/src/presentation/dashboard/components/settings-tab.tsx",
    reason:
      "Common boot tuning fields are not all editable in Electron yet; allowlists and ACP toggles are on the desktop path.",
  },
  {
    workflow: "Auth admin and device sessions",
    status: "blocked",
    electronSurface: "Not exposed in local ADE",
    sourceFile: "apps/server/src/presentation/dashboard/components/auth-tab.tsx",
    blockerFile: "apps/server/src/transport/http/routes/admin.ts",
    reason:
      "This is remote administration, not local ADE work; exposing it locally requires a separate auth-admin policy.",
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

function normalizeMemorySourcePath(value: string): string {
  return normalizeSlash(value.trim()).replace(/^\.\//, "").toLowerCase();
}

async function buildProjectMemoryContextResult(params: {
  rootPath: string;
  state: CapabilityStateDocument;
  query: string;
  sourceIds?: string[];
  sourcePaths?: string[];
  maxBytes?: number;
}): Promise<LocalAdeProjectMemoryContextResult> {
  const query = params.query.trim();
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
      sources: [],
      prompt: [
        `Use project memory for: ${query}`,
        "",
        "No enabled project memory sources are available.",
        "Enable AGENTS.md, CLAUDE.md, .eragear/memory.md, or .eragear/context.md in Local ADE before using /memory.",
        "",
        "User request:",
        query,
      ].join("\n"),
      diagnostics: [
        hasSourceFilter
          ? "No selected project memory sources are enabled."
          : "No project memory sources are enabled.",
      ],
    };
  }

  return {
    status: "ready",
    query,
    sources: includedSources,
    prompt: [
      `Use enabled project memory for: ${query}`,
      "Project memory is user/project-authored Markdown. Treat it as guidance, not as proof.",
      "Secret-looking values have been redacted before inclusion.",
      "",
      ...sections,
      "",
      "User request:",
      query,
    ].join("\n"),
    diagnostics: [
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

function parseRepoIndexFiles(input: unknown): LocalAdeRepoIndexFile[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const files: LocalAdeRepoIndexFile[] = [];
  for (const item of input) {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.sizeBytes !== "number" ||
      typeof item.extension !== "string"
    ) {
      continue;
    }
    const file: LocalAdeRepoIndexFile = {
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
    files.push(file);
  }
  return files.slice(0, MAX_REPO_INDEX_FILES);
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
    extensions: summarizeRepoIndexExtensions(document.files),
    files: document.files.slice(0, MAX_REPO_INDEX_VISIBLE_FILES),
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

function searchRepoIndexDocument(params: {
  document: RepoIndexDocument;
  query: string;
  limit?: number;
}): LocalAdeRepoIndexSearchItem[] {
  const phrase = params.query.trim().toLowerCase();
  const tokens = tokenizeRepoIndexQuery(params.query);
  const results: LocalAdeRepoIndexSearchItem[] = [];

  for (const file of params.document.files) {
    const score =
      scoreRepoIndexText({ text: file.path, phrase, tokens, weight: 1.4 }) +
      scoreRepoIndexText({ text: file.language, phrase, tokens, weight: 0.8 }) +
      scoreRepoIndexText({ text: file.extension, phrase, tokens, weight: 0.5 });
    if (score <= 0) {
      continue;
    }
    results.push({
      type: "file",
      path: file.path,
      title: file.path,
      detail: `${file.language ?? file.extension} - ${file.sizeBytes} bytes`,
      score,
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
      "Refresh Project Index in the Local ADE Control Center before using /index for retrieval.",
    ].join("\n");
  }

  const lines = [
    `Use the local project index context for: ${query}`,
    `Index timestamp: ${params.document.indexedAt}`,
    "The index contains metadata, code-symbol signals, and task markers only; full file contents are not embedded.",
    "Before editing, read the referenced files directly.",
    "",
    params.results.length > 0
      ? "Matched project index entries:"
      : "No project index entries matched this query.",
    ...params.results.map((item, index) => {
      const location = item.line ? `${item.path}:${item.line}` : item.path;
      return `${index + 1}. [${item.type}] ${item.title} - ${location} - ${item.detail}`;
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

function buildRepoIndexSearchResult(params: {
  query: string;
  document: RepoIndexDocument | null;
  limit?: number;
}): LocalAdeRepoIndexSearchResult {
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

  const results = searchRepoIndexDocument({
    document: params.document,
    query,
    limit: params.limit,
  });
  const status: LocalAdeRepoIndexSearchResult["status"] =
    results.length > 0 ? "ready" : "no-results";
  const diagnostics = [
    "Project index search uses bounded metadata, symbols, and task markers; full file contents are not embedded.",
  ];
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
  diagnostics: string[];
}> {
  if (
    params.sizeBytes > MAX_REPO_INDEX_FILE_SCAN_BYTES ||
    !REPO_INDEX_SCAN_EXTENSIONS.has(params.extension)
  ) {
    return { symbols: [], tasks: [], diagnostics: [] };
  }

  let raw = "";
  try {
    raw = await readFile(params.absolutePath, "utf8");
  } catch (error) {
    return {
      symbols: [],
      tasks: [],
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

  return { symbols, tasks, diagnostics: [] };
}

async function createRepoIndexDocument(rootPath: string): Promise<RepoIndexDocument> {
  const files: LocalAdeRepoIndexFile[] = [];
  const symbols: LocalAdeRepoIndexSymbol[] = [];
  const tasks: LocalAdeRepoIndexTask[] = [];
  const diagnostics: string[] = [
    "Project index stores file metadata, code-symbol signals, and task markers; full file contents are not embedded.",
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
        const file: LocalAdeRepoIndexFile = {
          path: relative,
          sizeBytes: info.size,
          extension,
          modifiedAt: info.mtime.toISOString(),
        };
        if (language) {
          file.language = language;
        }
        files.push(file);
        if (
          symbols.length < MAX_REPO_INDEX_SYMBOLS ||
          tasks.length < MAX_REPO_INDEX_TASKS
        ) {
          const signals = await scanRepoIndexSignals({
            absolutePath: child,
            relativePath: relative,
            extension,
            ...(language ? { language } : {}),
            sizeBytes: info.size,
          });
          diagnostics.push(...signals.diagnostics);
          if (symbols.length < MAX_REPO_INDEX_SYMBOLS) {
            symbols.push(
              ...signals.symbols.slice(0, MAX_REPO_INDEX_SYMBOLS - symbols.length)
            );
          }
          if (tasks.length < MAX_REPO_INDEX_TASKS) {
            tasks.push(...signals.tasks.slice(0, MAX_REPO_INDEX_TASKS - tasks.length));
          }
        }
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
    "command" | "args" | "workingDirectory" | "event" | "envKeys"
  >
): string {
  const payload = JSON.stringify({
    version: 1,
    event: normalizeHookEvent(hook.event),
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

async function readHookDocument(rootPath: string): Promise<HookDocument> {
  const parsed = await readJsonObject(path.join(ensureProjectDataDir(rootPath), HOOKS_FILE));
  if (!parsed || !Array.isArray(parsed.hooks)) {
    return { version: 1, hooks: [], runs: [] };
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
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: Math.max(0, Math.floor(item.durationMs)),
        status,
        ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
        ...(typeof item.signal === "string" ? { signal: item.signal } : {}),
        stdout: sanitizeDiagnosticText(item.stdout),
        stderr: sanitizeDiagnosticText(item.stderr),
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
          : [],
      });
    }
  }

  return {
    version: 1,
    hooks,
    runs: runs.slice(0, MAX_HOOK_RUNS),
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
    const diagnostics = [
      "Manual hook execution is available from the Local ADE Control Center.",
      `Hook execution fingerprint: ${fingerprint}.`,
      hook.envKeys?.length
        ? `Hook env allowlist: ${sanitizeHookEnvKeys(hook.envKeys).join(", ")}.`
        : "Hook runs with base process env only plus Eragear hook context.",
    ];
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
        ? "Manual hook runnable from the Local ADE Control Center."
        : `Lifecycle hook for ${hook.event}.`,
    scope: "project",
    enabled: hook.enabled && hook.trustStatus === "trusted",
    sourcePath: hook.sourcePath,
    storage: "filesystem-discovery",
    tags: [
      hook.event === "manual" ? "manual-hook" : "lifecycle-hook",
      hook.event,
      hook.trustStatus === "trusted" ? "trusted" : "requires-trust",
    ],
    diagnostics: hook.diagnostics,
  }));
}

function createFailedHookRun(params: {
  hook: StoredHook;
  event: string;
  message: string;
}): LocalAdeHookRun {
  const now = new Date().toISOString();
  return {
    id: `hook-run-${randomUUID()}`,
    hookId: params.hook.id,
    hookName: params.hook.name,
    event: params.event,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "failed",
    stdout: "",
    stderr: "",
    diagnostics: [params.message],
  };
}

async function runHookProcess(params: {
  rootPath: string;
  hook: StoredHook;
  event?: string;
  context?: Record<string, string | undefined>;
}): Promise<LocalAdeHookRun> {
  if (!params.hook.enabled) {
    throw new Error(`Hook is disabled: ${params.hook.name}`);
  }
  if (!params.hook.command.trim()) {
    throw new Error(`Hook command is empty: ${params.hook.name}`);
  }
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
    const child = spawn(params.hook.command, params.hook.args ?? [], {
      cwd,
      env: hookExecutionEnv(params.rootPath, params.hook, event, params.context),
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
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
      resolve({ error });
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ...(typeof code === "number" ? { exitCode: code } : {}),
        ...(signal ? { signal } : {}),
      });
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
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    status,
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    ...(result.signal ? { signal: result.signal } : {}),
    stdout: sanitizeDiagnosticText(stdout),
    stderr: sanitizeDiagnosticText(stderr),
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

  const runs: LocalAdeHookRun[] = [];
  for (const hook of matchingHooks) {
    try {
      runs.push(
        await runHookProcess({
          rootPath: params.rootPath,
          hook,
          event,
          context: params.context,
        })
      );
    } catch (error) {
      runs.push(
        createFailedHookRun({
          hook,
          event,
          message: `Lifecycle hook failed before execution: ${errorMessage(error)}`,
        })
      );
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
  const scopes = new Set<LocalAdePluginScope>(DEFAULT_PLUGIN_SCOPES);
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = String(item).trim();
      if (
        PLUGIN_SCOPE_VALUES.includes(value as LocalAdePluginScope)
      ) {
        scopes.add(value as LocalAdePluginScope);
      }
    }
  }
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

function pluginExecutionFingerprint(plugin: Pick<
  StoredPlugin,
  "command" | "args" | "workingDirectory" | "scopes" | "envKeys"
>): string {
  const policy = normalizePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
  });
  const payload = JSON.stringify({
    version: 1,
    command: plugin.command.trim(),
    args: (plugin.args ?? []).map((arg) => String(arg)),
    workingDirectory: normalizeSlash(plugin.workingDirectory ?? "."),
    scopes: policy.scopes,
    envKeys: policy.envKeys,
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
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

async function readPluginDocument(rootPath: string): Promise<PluginDocument> {
  const parsed = await readJsonObject(path.join(ensureProjectDataDir(rootPath), PLUGINS_FILE));
  if (!parsed || !Array.isArray(parsed.plugins)) {
    return { version: 1, plugins: [], runs: [] };
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
    plugins.push({
      id: item.id.trim() || `plugin-${toHashId(item.name, item.command)}`,
      name: item.name.trim() || "Local plugin",
      ...(description ? { description } : {}),
      enabled: typeof item.enabled === "boolean" ? item.enabled : true,
      scopes: policy.scopes,
      envKeys: policy.envKeys,
      ...(typeof item.trustedFingerprint === "string" &&
      item.trustedFingerprint.startsWith("sha256:")
        ? { trustedFingerprint: item.trustedFingerprint }
        : {}),
      ...(typeof item.trustedAt === "string" ? { trustedAt: item.trustedAt } : {}),
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
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: Math.max(0, Math.floor(item.durationMs)),
        status,
        ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
        ...(typeof item.signal === "string" ? { signal: item.signal } : {}),
        stdout: sanitizeDiagnosticText(item.stdout),
        stderr: sanitizeDiagnosticText(item.stderr),
        diagnostics: Array.isArray(item.diagnostics)
          ? item.diagnostics.filter((entry): entry is string => typeof entry === "string")
          : [],
      });
    }
  }

  return {
    version: 1,
    plugins,
    runs: runs.slice(0, MAX_PLUGIN_RUNS),
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
      },
      null,
      2
    )}\n`,
    "utf8"
  );
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
  const policy = normalizePluginPolicy({
    scopes: plugin.scopes,
    envKeys: plugin.envKeys,
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
  env.ERAGEAR_PROJECT_ROOT = rootPath;
  return env;
}

function toVisiblePlugins(
  rootPath: string,
  document: PluginDocument
): LocalAdePluginDescriptor[] {
  const sourcePath = path.join(ensureProjectDataDir(rootPath), PLUGINS_FILE);
  return document.plugins.map((plugin) => {
    const lastRun = document.runs.find((run) => run.pluginId === plugin.id);
    const policy = normalizePluginPolicy({
      scopes: plugin.scopes,
      envKeys: plugin.envKeys,
    });
    const fingerprint = pluginExecutionFingerprint(plugin);
    const trustStatus = pluginTrustStatus(plugin, fingerprint);
    const diagnostics = [
      "Project-local plugin execution is available from the Local ADE Control Center.",
      "Plugins run without shell expansion and are constrained to the project root for cwd.",
      "Plugin environment is isolated; only base runtime env and approved env keys are exposed.",
      `Plugin execution fingerprint: ${fingerprint}.`,
    ];
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
    if (!plugin.command.trim()) {
      diagnostics.push("Plugin command is empty.");
    }
    if (plugin.workingDirectory) {
      const resolved = path.resolve(rootPath, plugin.workingDirectory);
      if (!isPathInside(rootPath, resolved)) {
        diagnostics.push("Working directory is outside the project root.");
      }
    }
    return {
      id: plugin.id,
      name: plugin.name,
      ...(plugin.description ? { description: plugin.description } : {}),
      enabled: plugin.enabled,
      scopes: policy.scopes,
      envKeys: policy.envKeys,
      fingerprint,
      trustStatus,
      ...(plugin.trustedFingerprint
        ? { trustedFingerprint: plugin.trustedFingerprint }
        : {}),
      ...(plugin.trustedAt ? { trustedAt: plugin.trustedAt } : {}),
      command: plugin.command,
      args: plugin.args ?? [],
      timeoutMs: plugin.timeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS,
      ...(plugin.workingDirectory ? { workingDirectory: plugin.workingDirectory } : {}),
      sourcePath,
      updatedAt: plugin.updatedAt,
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
      "Project-local plugin runnable from the Local ADE Control Center.",
    scope: "project",
    enabled: plugin.enabled && plugin.trustStatus === "trusted",
    sourcePath: plugin.sourcePath,
    storage: "filesystem-discovery",
    tags: [
      "project-plugin",
      "manual-plugin",
      plugin.trustStatus === "trusted" ? "trusted" : "requires-trust",
      ...plugin.scopes.map((scope) => `scope:${scope}`),
      plugin.envKeys.length > 0 ? "env-allowlist" : "isolated-env",
    ],
    diagnostics: plugin.diagnostics,
  }));
}

async function runPluginProcess(params: {
  rootPath: string;
  plugin: StoredPlugin;
}): Promise<LocalAdePluginRun> {
  if (!params.plugin.enabled) {
    throw new Error(`Plugin is disabled: ${params.plugin.name}`);
  }
  if (!params.plugin.command.trim()) {
    throw new Error(`Plugin command is empty: ${params.plugin.name}`);
  }
  const fingerprint = pluginExecutionFingerprint(params.plugin);
  if (pluginTrustStatus(params.plugin, fingerprint) !== "trusted") {
    throw new Error(
      `Plugin must be trusted before execution: ${params.plugin.name} (${fingerprint})`
    );
  }

  const cwd = resolvePluginWorkingDirectory(params.rootPath, params.plugin);
  const policy = normalizePluginPolicy({
    scopes: params.plugin.scopes,
    envKeys: params.plugin.envKeys,
  });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const timeoutMs = clampPluginTimeout(params.plugin.timeoutMs);
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;

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
    const child = spawn(params.plugin.command, params.plugin.args ?? [], {
      cwd,
      env: pluginExecutionEnv(params.rootPath, params.plugin),
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
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
      resolve({ error });
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ...(typeof code === "number" ? { exitCode: code } : {}),
        ...(signal ? { signal } : {}),
      });
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
  if (result.error) {
    diagnostics.push(`Plugin process error: ${errorMessage(result.error)}`);
  }
  if (timedOut) {
    diagnostics.push(`Plugin timed out after ${timeoutMs}ms.`);
  }
  if (stdoutTruncated || stderrTruncated) {
    diagnostics.push(`Plugin output was truncated to ${MAX_HOOK_OUTPUT_BYTES} bytes per stream.`);
  }

  return {
    id: `plugin-run-${randomUUID()}`,
    pluginId: params.plugin.id,
    pluginName: params.plugin.name,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    status,
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    ...(result.signal ? { signal: result.signal } : {}),
    stdout: sanitizeDiagnosticText(stdout),
    stderr: sanitizeDiagnosticText(stderr),
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
      item.source === "probe" || item.source === "invocation"
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
}): Promise<{ result: unknown; sessionId?: string; notificationMessages: unknown[] }> {
  const response = await fetch(params.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...params.headers,
      ...(params.sessionId ? { "mcp-session-id": params.sessionId } : {}),
    },
    body: JSON.stringify(params.body),
  });
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
  const headerPolicy = resolveMcpRuntimeHeaders(server);
  diagnostics.push(...headerPolicy.diagnostics);
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

async function discoverSseMcpProtocol(server: StoredMcpServer): Promise<McpDiscoveryResult> {
  const startedAt = Date.now();
  const diagnostics: string[] = [];
  const notifications: LocalAdeMcpNotification[] = [];
  const recorder = createMcpProbeRecorder(server.transport);
  const headerPolicy = resolveMcpRuntimeHeaders(server);
  diagnostics.push(...headerPolicy.diagnostics);
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
    if (reconnectAttempts < MCP_SSE_RECONNECT_ATTEMPTS) {
      reconnecting = true;
      reconnectAttempts += 1;
      diagnostics.push(
        `MCP SSE stream closed before protocol discovery completed; reconnecting (${reconnectAttempts}/${MCP_SSE_RECONNECT_ATTEMPTS}).`
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
    const streamResponse = await fetch(streamUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "text/event-stream",
        ...headerPolicy.headers,
      },
    });
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
              error: `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for SSE endpoint event.`,
            });
            reject(
              new Error(
                `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for SSE endpoint event.`
              )
            );
          },
          MCP_PROTOCOL_TIMEOUT_MS
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
      const response = await fetch(target, {
        method: "POST",
        signal: operationController.signal,
        headers: {
          accept: "application/json, text/event-stream, */*",
          "content-type": "application/json",
          ...headerPolicy.headers,
        },
        body: JSON.stringify(body),
      });
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
            error: `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for ${method}.`,
          });
          reject(
            new Error(
              `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for ${method}.`
            )
          );
        }, MCP_PROTOCOL_TIMEOUT_MS);
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
  const headerPolicy = resolveMcpRuntimeHeaders(params.server);
  diagnostics.push(...headerPolicy.diagnostics);
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
  const headerPolicy = resolveMcpRuntimeHeaders(params.server);
  diagnostics.push(...headerPolicy.diagnostics);
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
    if (reconnectAttempts < MCP_SSE_RECONNECT_ATTEMPTS) {
      reconnecting = true;
      reconnectAttempts += 1;
      diagnostics.push(
        `MCP SSE invocation stream closed before completion; reconnecting (${reconnectAttempts}/${MCP_SSE_RECONNECT_ATTEMPTS}).`
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
    const streamResponse = await fetch(streamUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "text/event-stream",
        ...headerPolicy.headers,
      },
    });
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
                `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for SSE endpoint event.`
              )
            ),
          MCP_PROTOCOL_TIMEOUT_MS
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
      const response = await fetch(target, {
        method: "POST",
        signal: operationController.signal,
        headers: {
          accept: "application/json, text/event-stream, */*",
          "content-type": "application/json",
          ...headerPolicy.headers,
        },
        body: JSON.stringify(body),
      });
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
              `Timed out after ${MCP_PROTOCOL_TIMEOUT_MS}ms waiting for ${method}.`
            )
          );
        }, MCP_PROTOCOL_TIMEOUT_MS);
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
  const requiresAgentCapability =
    server.transport === "streamable-http"
      ? "http"
      : server.transport === "sse"
        ? "sse"
        : undefined;
  const target =
    server.transport === "stdio"
      ? server.command?.trim() || "missing command"
      : server.url?.trim() || "missing URL";
  const diagnostics: string[] = [
    `Route fingerprint ${fingerprint}.`,
    "Secret values are resolved only at session start and are not exposed in this preview.",
  ];
  const routeAgentInvocations = agentInvocations.filter(
    (item) => item.serverId === server.id
  );

  let status: LocalAdeMcpAgentRoute["status"] = "injectable";
  let reason =
    server.transport === "stdio"
      ? "Ready for ACP session MCP broker injection."
      : "Ready for ACP session MCP injection.";

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
  } else if (requiresAgentCapability) {
    status = "conditional";
    reason = `Will inject only when the agent advertises MCP ${requiresAgentCapability.toUpperCase()} capability during ACP initialize.`;
  }

  if (status === "blocked") {
    diagnostics.push(reason);
  }
  if (status === "conditional") {
    diagnostics.push(
      "Session bootstrap enforces the advertised agent MCP transport capability before session/new or session/load."
    );
  }
  if (server.transport === "stdio" && status === "injectable") {
    diagnostics.push(
      "Agent receives an Eragear stdio MCP broker that re-checks trust before forwarding tool/resource calls."
    );
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
    brokerMode:
      server.transport === "stdio"
        ? "stdio-proxy"
        : requiresAgentCapability
          ? "native-agent-transport"
          : "none",
    ...(requiresAgentCapability ? { requiresAgentCapability } : {}),
    agentSupport: requiresAgentCapability
      ? "required-at-session-start"
      : "not-required",
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
      "Remote MCP routes are conditional until the agent advertises matching HTTP/SSE MCP capability."
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
    auth: [["auth", "status"], ["doctor"]],
    models: [["models"], ["model", "list"]],
  },
  gemini: {
    auth: [["auth", "status"], ["login", "status"]],
    models: [["models"], ["models", "list"]],
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

function parseProviderModelList(output: string): string[] {
  const trimmed = output.trim();
  const models = new Set<string>();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidates = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.models)
          ? parsed.models
          : [];
      for (const item of candidates) {
        if (typeof item === "string" && item.trim()) {
          models.add(item.trim());
        } else if (isRecord(item) && typeof item.id === "string") {
          models.add(item.id.trim());
        } else if (isRecord(item) && typeof item.name === "string") {
          models.add(item.name.trim());
        }
      }
    } catch {
      // Fall through to line parsing.
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line
      .replace(/^[-*\s]+/, "")
      .replace(/\s+\(.+\)$/, "")
      .trim();
    if (
      candidate &&
      candidate.length <= 120 &&
      !candidate.includes(" ") &&
      !candidate.includes(":")
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

async function probeProviderReadiness(
  agent: Awaited<ReturnType<AgentRepositoryPort["findAll"]>>[number]
): Promise<ProviderReadinessProbe> {
  const diagnostics: string[] = [];
  const secretValues = Object.values(agent.env ?? {});
  const command = agent.command.trim();
  const resolved = await resolveExecutable(command);
  diagnostics.push(...resolved.diagnostics);
  if (!resolved.available) {
    return {
      cliStatus: "missing",
      authStatus: "unknown",
      modelStatus: "unknown",
      readiness: "unavailable",
      modelList: [],
      diagnostics,
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
  });
  diagnostics.push(...versionProbe.diagnostics);
  const version = versionProbe.ok
    ? firstOutputLine(versionProbe.output, "")?.slice(0, 160)
    : undefined;
  const cliStatus: LocalAdeProviderDescriptor["cliStatus"] = versionProbe.ok
    ? "ok"
    : "failed";
  if (cliStatus !== "ok") {
    return {
      cliStatus,
      authStatus: "unknown",
      modelStatus: "unknown",
      readiness: "unavailable",
      modelList: [],
      diagnostics,
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
  return {
    cliStatus,
    authStatus,
    modelStatus,
    readiness,
    ...(version ? { version } : {}),
    modelList,
    diagnostics,
  };
}

async function providerDescriptorsFromAgents(
  rootPath: string,
  agents: Awaited<ReturnType<AgentRepositoryPort["findAll"]>>,
  healthDocument: ProviderHealthDocument
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
    const modelList = health?.modelList?.length
      ? health.modelList
      : fallbackModelList;
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
      cliStatus: health?.cliStatus ?? (executable.available ? "ok" : "missing"),
      authStatus: health?.authStatus ?? "unknown",
      modelStatus: health?.modelStatus ?? "unknown",
      readiness,
      ...(health?.version ? { version: health.version } : {}),
      ...(health?.checkedAt ? { lastProbedAt: health.checkedAt } : {}),
      ...(typeof health?.latencyMs === "number" ? { latencyMs: health.latencyMs } : {}),
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
              ...(restore.safetyCheckpointId
                ? { safetyCheckpointId: restore.safetyCheckpointId }
                : {}),
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
      .filter(Boolean);
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
    normalized.startsWith(".eragear/checkpoints/")
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

async function collectCheckpointRestoreRisks(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
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
  ]);
  const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
  return [...files]
    .sort()
    .map((file) => {
      const expected = expectedByFile.get(file);
      const current = currentByFile.get(file);
      const patchAction = checkpointPatchAction(expected, restoreMode);
      if (currentStatusError) {
        return {
          file,
          level: "blocked" as const,
          patchAction,
          ...(statusListText(expected) ? { checkpointStatus: statusListText(expected) } : {}),
          reason: `Could not read current Git status: ${currentStatusError}`,
        };
      }
      if (expected?.some((line) => line.startsWith("?? "))) {
        return {
          file,
          level: "warning" as const,
          patchAction,
          checkpointStatus: statusListText(expected),
          ...(statusListText(current) ? { currentStatus: statusListText(current) } : {}),
          reason:
            "This file was untracked metadata at checkpoint time; checkpoint patches do not contain untracked file contents.",
        };
      }
      if (!expected && current) {
        return {
          file,
          level: "blocked" as const,
          patchAction: "unexpected current change",
          currentStatus: statusListText(current),
          reason:
            "This file changed after the checkpoint and is not part of the restore precondition.",
        };
      }
      if (expected && !current) {
        return {
          file,
          level: "blocked" as const,
          patchAction,
          checkpointStatus: statusListText(expected),
          reason:
            "Current workspace no longer has the checkpoint-time change for this file.",
        };
      }
      if (!compareStatusLists(expected, current)) {
        return {
          file,
          level: "blocked" as const,
          patchAction,
          checkpointStatus: statusListText(expected),
          currentStatus: statusListText(current),
          reason:
            "Current file status differs from the checkpoint restore precondition.",
        };
      }
      return {
        file,
        level: "safe" as const,
        patchAction,
        ...(statusListText(expected) ? { checkpointStatus: statusListText(expected) } : {}),
        ...(statusListText(current) ? { currentStatus: statusListText(current) } : {}),
        reason: "Current status matches the checkpoint restore precondition.",
      };
    });
}

async function collectCheckpointRestoreBlockers(params: {
  rootPath: string;
  checkpoint: LocalAdeCheckpoint;
  patchPath: string;
}): Promise<Array<{ file: string; reason: string }>> {
  const blockers: Array<{ file: string; reason: string }> = [];
  const serviceFile = "apps/server/src/modules/settings/application/local-ade.service.ts";

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
    if (!equalLineSets(statusLines, expectedStatusLines)) {
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

  try {
    const mode = params.checkpoint.restoreMode ?? "reverse-patch";
    await runGit(
      params.rootPath,
      mode === "apply-patch"
        ? ["apply", "--check", params.patchPath]
        : ["apply", "--check", "-R", params.patchPath]
    );
  } catch (error) {
    blockers.push({
      file: serviceFile,
      reason: `Reverse patch check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
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
  });

  return {
    checkpointId: params.checkpoint.id,
    name: params.checkpoint.name,
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

  const restoreMode = params.checkpoint.restoreMode ?? "reverse-patch";
  await runGit(
    params.rootPath,
    restoreMode === "apply-patch"
      ? ["apply", "--whitespace=nowarn", resolvedPatchPath]
      : ["apply", "-R", "--whitespace=nowarn", resolvedPatchPath]
  );
  return {
    ...params.checkpoint,
    restoredAt: new Date().toISOString(),
    canRestore: false,
    diagnostics: [
      `Checkpoint restored by guarded reverse patch at ${new Date().toISOString()}.`,
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
    return {
      checkpoint: {
        ...params.checkpoint,
        partialRestores: [
          {
            restoredAt,
            files: params.selectedPatch.files,
            hunks: params.selectedPatch.hunks,
          },
          ...(params.checkpoint.partialRestores ?? []),
        ].slice(0, MAX_CHECKPOINTS),
        diagnostics: [
          `Selected checkpoint hunks restored at ${restoredAt}: ${params.selectedPatch.hunks
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

function createAcpActivitySnapshot(params: {
  entries: LogEntry[];
  totalCandidateEntries: number;
  maxEntries?: number;
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

export class LocalAdeService {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly agentRepo: AgentRepositoryPort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly logStore: LogStorePort;

  constructor(params: {
    projectRepo: ProjectRepositoryPort;
    agentRepo: AgentRepositoryPort;
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
    logStore: LogStorePort;
  }) {
    this.projectRepo = params.projectRepo;
    this.agentRepo = params.agentRepo;
    this.sessionRepo = params.sessionRepo;
    this.sessionRuntime = params.sessionRuntime;
    this.logStore = params.logStore;
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
      repoIndexDocument,
      hookDocument,
      pluginDocument,
      mcpDocument,
      mcpAgentInvocations,
      providerHealth,
      checkpointDocument,
      changeTrust,
      logs,
      acpLogs,
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
        readRepoIndexDocument(projectContext.rootPath),
        readHookDocument(projectContext.rootPath),
        readPluginDocument(projectContext.rootPath),
        readMcpDocument(projectContext.rootPath),
        readMcpAgentInvocations(projectContext.rootPath),
        readProviderHealthDocument(projectContext.rootPath),
        readCheckpointDocument(projectContext.rootPath),
        readGitSnapshot(projectContext.rootPath),
        this.logStore.query({ userId, order: "desc", limit: 20 }),
        this.logStore.query({ acpOnly: true, order: "desc", limit: 200 }),
        this.sessionRepo.findAll(userId, { limit: 100 }).catch(() => []),
        this.sessionRepo.getStorageStats().catch(() => null),
      ]);

    const providers = await providerDescriptorsFromAgents(
      projectContext.rootPath,
      agents,
      providerHealth
    );
    const hooks = toVisibleHooks(projectContext.rootPath, hookDocument);
    const plugins = toVisiblePlugins(projectContext.rootPath, pluginDocument);
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
    });

    const totalStored = await this.sessionRepo.countAll(userId).catch(() => null);

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
      providers,
      capabilities,
      projectMemory,
      projectIndex: toRepoIndexSnapshot(projectContext.rootPath, repoIndexDocument),
      hooks: {
        configPath: path.join(ensureProjectDataDir(projectContext.rootPath), HOOKS_FILE),
        items: hooks,
        recentRuns: hookDocument.runs,
      },
      plugins: {
        configPath: path.join(ensureProjectDataDir(projectContext.rootPath), PLUGINS_FILE),
        items: plugins,
        recentRuns: pluginDocument.runs,
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
      stats: snapshot.stats,
      diagnostics: snapshot.diagnostics,
    };
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
    const filteredEntries = input.correlationKey
      ? chatFilteredEntries.filter(
          (entry) => acpCorrelationIdentity(entry).key === input.correlationKey
        )
      : chatFilteredEntries;
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
        limit,
      },
      redacted: true,
      frames: createAcpReplayFrames(replayEntries),
      correlations: snapshot.correlations,
      stats: snapshot.stats,
      diagnostics,
    };
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
    return buildRepoIndexSearchResult({
      query,
      document,
      limit: input.limit,
    });
  }

  async buildProjectMemoryContext(
    userId: string,
    input: BuildProjectMemoryContextInput
  ): Promise<LocalAdeProjectMemoryContextResult> {
    const query = input.query.trim();
    if (!query) {
      throw new Error("Project memory context query is required.");
    }
    const context = await this.resolveProjectContext(userId, input.projectId);
    const state = await readCapabilityState(context.rootPath);
    return await buildProjectMemoryContextResult({
      rootPath: context.rootPath,
      state,
      query,
      sourceIds: input.sourceIds,
      sourcePaths: input.sourcePaths,
      maxBytes: input.maxBytes,
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

  async runHook(userId: string, input: RunHookInput): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
    const document = await readHookDocument(context.rootPath);
    const hook = document.hooks.find((item) => item.id === input.hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${input.hookId}`);
    }
    const run = await runHookProcess({
      rootPath: context.rootPath,
      hook,
    });
    document.runs = [run, ...document.runs].slice(0, MAX_HOOK_RUNS);
    await writeHookDocument(context.rootPath, document);
    return await this.snapshot(userId);
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
    const next: StoredPlugin = {
      id,
      name: input.name.trim(),
      ...(description ? { description } : {}),
      enabled: input.enabled ?? true,
      scopes: policy.scopes,
      envKeys: policy.envKeys,
      ...(previous?.trustedFingerprint
        ? { trustedFingerprint: previous.trustedFingerprint }
        : {}),
      ...(previous?.trustedAt ? { trustedAt: previous.trustedAt } : {}),
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
    plugin.updatedAt = plugin.trustedAt;
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
    const run = await runPluginProcess({
      rootPath: context.rootPath,
      plugin,
    });
    document.runs = [run, ...document.runs].slice(0, MAX_PLUGIN_RUNS);
    await writePluginDocument(context.rootPath, document);
    return await this.snapshot(userId);
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
      ...(previous?.probeHistory?.length
        ? { probeHistory: previous.probeHistory }
        : {}),
      ...(previous?.invocationHistory?.length
        ? { invocationHistory: previous.invocationHistory }
        : {}),
      ...(previous?.notificationHistory?.length
        ? { notificationHistory: previous.notificationHistory }
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
    };

    healthDocument.providers[providerHealthId] = record;
    await writeProviderHealthDocument(context.rootPath, healthDocument);
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
