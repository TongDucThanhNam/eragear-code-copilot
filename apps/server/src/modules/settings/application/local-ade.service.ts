import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type CapabilityDescriptor,
  type CapabilityKind,
  type CapabilityScope,
  createCapabilityRegistrySnapshot,
} from "@repo/shared";
import type { AgentRepositoryPort } from "@/modules/agent";
import type { ProjectRepositoryPort } from "@/modules/project";
import type { SessionRepositoryPort, SessionRuntimePort } from "@/modules/session";
import type { LogStorePort } from "@/shared/ports/log-store.port";
import { isRecord } from "@/shared/utils/type-guards.util";

const execFileAsync = promisify(execFile);
const STATE_FILE = "capabilities-state.json";
const MCP_FILE = "mcp-servers.json";
const PROVIDER_HEALTH_FILE = "provider-health.json";
const CHECKPOINTS_FILE = "checkpoints.json";
const CHECKPOINT_PATCH_DIR = "checkpoints";
const MAX_DISCOVERY_FILES = 160;
const MAX_MARKDOWN_BYTES = 96_000;
const MAX_MEMORY_PREVIEW_BYTES = 16_000;
const GIT_TIMEOUT_MS = 4000;
const PROBE_TIMEOUT_MS = 2500;
const MAX_CHECKPOINTS = 80;
const SECRET_HINT_PATTERN =
  /(api[_-]?key|secret|token|password|private[_-]?key|authorization)/i;

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
  status: "configured" | "missing-config" | "not-probed" | "available" | "unavailable";
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

export type McpTransport = "stdio" | "sse" | "streamable-http";

export interface LocalAdeMcpServer {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  headerKeys: string[];
  health: "not-probed" | "invalid-config" | "available" | "unavailable" | "disabled";
  lastProbedAt?: string;
  latencyMs?: number;
  diagnostics: string[];
  updatedAt: string;
}

interface StoredMcpServer extends Omit<LocalAdeMcpServer, "envKeys" | "headerKeys" | "health" | "diagnostics"> {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface McpDocument {
  version: 1;
  servers: StoredMcpServer[];
}

interface ProviderHealthRecord {
  status: "available" | "unavailable";
  version?: string;
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

export interface UpsertMcpServerInput {
  projectId?: string;
  id?: string;
  name: string;
  transport: McpTransport;
  enabled?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ToggleMcpServerInput {
  projectId?: string;
  id: string;
  enabled: boolean;
}

export interface TestProviderInput {
  projectId?: string;
  providerId: string;
}

export interface CreateCheckpointInput {
  projectId?: string;
  name?: string;
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

export interface LocalAdeCheckpoint {
  id: string;
  name: string;
  createdAt: string;
  projectRoot: string;
  sessionIds: string[];
  gitHead?: string;
  changedFiles: string[];
  statusLines: string[];
  patchPath: string;
  patchBytes: number;
  canRestore: boolean;
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
  mcp: {
    configPath: string;
    servers: LocalAdeMcpServer[];
  };
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

const CAPABILITY_PLACEHOLDERS: CapabilityDescriptor[] = [
  {
    id: "local.subagents.placeholder",
    kind: "subagent",
    name: "Subagents",
    description: "Descriptor shape is reserved; invocation is still pending.",
    scope: "local",
    enabled: false,
    storage: "filesystem-discovery",
    diagnostics: ["Subagent creation/listing is below the current cut line."],
  },
  {
    id: "local.hooks.placeholder",
    kind: "hook",
    name: "Hooks",
    description: "Hook descriptors are visible as a registry class.",
    scope: "local",
    enabled: false,
    storage: "filesystem-discovery",
    diagnostics: ["Hook runtime execution is not implemented in this sprint."],
  },
  {
    id: "local.plugins.placeholder",
    kind: "plugin",
    name: "Plugins",
    description: "Plugin descriptors are visible as a registry class.",
    scope: "plugin",
    enabled: false,
    storage: "filesystem-discovery",
    diagnostics: ["Plugin installation/loading is intentionally blocked."],
  },
];

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
      diagnostics: ["Loaded as a compatibility skill descriptor only."],
    },
    {
      kind: "command",
      scope: "project",
      rootPath: path.join(params.rootPath, ".eragear", "commands"),
      match: (filePath) => filePath.toLowerCase().endsWith(".md"),
      defaultName: (filePath) => `/${path.basename(filePath, ".md")}`,
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

function redactPotentialSecrets(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!SECRET_HINT_PATTERN.test(line)) {
        return line;
      }
      return line.replace(/(:|=)\s*["']?[^"'\s]+["']?/g, "$1 [redacted]");
    })
    .join("\n");
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
    servers.push({
      id: item.id,
      name: item.name,
      transport,
      enabled: typeof item.enabled === "boolean" ? item.enabled : false,
      ...(typeof item.command === "string" ? { command: item.command } : {}),
      ...(Array.isArray(item.args)
        ? { args: item.args.filter((arg): arg is string => typeof arg === "string") }
        : {}),
      ...(typeof item.url === "string" ? { url: item.url } : {}),
      ...(sanitizeRecord(item.env) ? { env: sanitizeRecord(item.env) } : {}),
      ...(sanitizeRecord(item.headers)
        ? { headers: sanitizeRecord(item.headers) }
        : {}),
      updatedAt:
        typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    });
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

async function probeHttpEndpoint(url: string): Promise<{
  available: boolean;
  latencyMs: number;
  diagnostics: string[];
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "text/event-stream, application/json, */*",
      },
    });
    const latencyMs = Date.now() - startedAt;
    return {
      available: response.status < 500,
      latencyMs,
      diagnostics: [
        `Endpoint responded with HTTP ${response.status} in ${latencyMs}ms.`,
      ],
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      available: false,
      latencyMs,
      diagnostics: [
        `Endpoint probe failed after ${latencyMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function toVisibleMcpServer(server: StoredMcpServer): Promise<LocalAdeMcpServer> {
  const invalid =
    server.transport === "stdio"
      ? !server.command
      : !server.url;
  const base = {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.url ? { url: server.url } : {}),
    envKeys: Object.keys(server.env ?? {}),
    headerKeys: Object.keys(server.headers ?? {}),
    updatedAt: server.updatedAt,
  };

  if (!server.enabled) {
    return {
      ...base,
      health: "disabled",
      diagnostics: ["MCP entry is disabled."],
    };
  }

  if (invalid) {
    return {
      ...base,
      health: "invalid-config",
      diagnostics: ["MCP entry is missing the command or URL required by its transport."],
    };
  }

  const probedAt = new Date().toISOString();
  if (server.transport === "stdio") {
    const startedAt = Date.now();
    const resolved = await resolveExecutable(server.command ?? "");
    return {
      ...base,
      health: resolved.available ? "available" : "unavailable",
      lastProbedAt: probedAt,
      latencyMs: Date.now() - startedAt,
      diagnostics: resolved.diagnostics,
    };
  }

  const probe = await probeHttpEndpoint(server.url ?? "");
  return {
    ...base,
    health: probe.available ? "available" : "unavailable",
    lastProbedAt: probedAt,
    latencyMs: probe.latencyMs,
    diagnostics: probe.diagnostics,
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
    enabled: server.enabled,
    sourcePath: path.join(ensureProjectDataDir(rootPath), MCP_FILE),
    storage: "filesystem-discovery",
    diagnostics: server.diagnostics,
    tags: ["mcp", server.transport],
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
    const status =
      value.status === "available" || value.status === "unavailable"
        ? value.status
        : undefined;
    if (!status || typeof value.checkedAt !== "string") {
      continue;
    }
    providers[id] = {
      status,
      checkedAt: value.checkedAt,
      diagnostics: Array.isArray(value.diagnostics)
        ? value.diagnostics.filter((item): item is string => typeof item === "string")
        : [],
      ...(typeof value.version === "string" ? { version: value.version } : {}),
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

async function providerDescriptorsFromAgents(
  rootPath: string,
  agents: Awaited<ReturnType<AgentRepositoryPort["findAll"]>>,
  healthDocument: ProviderHealthDocument
): Promise<LocalAdeProviderDescriptor[]> {
  return await Promise.all(agents.map(async (agent) => {
    const envKeys = Object.keys(agent.env ?? {});
    const modelList = [
      ...(agent.type === "opencode" ? ["agent-configured"] : []),
      ...(agent.type === "codex" ? ["codex-default"] : []),
      ...(agent.type === "claude" ? ["claude-default"] : []),
      ...(agent.type === "gemini" ? ["gemini-default"] : []),
    ];
    const providerId = `provider.agent.${agent.id}`;
    const health = healthDocument.providers[providerId];
    const executable = await resolveExecutable(agent.command.trim());
    const status = health?.status ?? (executable.available ? "configured" : "missing-config");
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
      ...(health?.version ? { version: health.version } : {}),
      ...(health?.checkedAt ? { lastProbedAt: health.checkedAt } : {}),
      ...(typeof health?.latencyMs === "number" ? { latencyMs: health.latencyMs } : {}),
      diagnostics: [
        "Provider state is derived from safe agent config metadata.",
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
        "Read-only Git diff fallback is active; restore/rollback is intentionally not implemented.",
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
      Array.isArray(item.changedFiles) &&
      Array.isArray(item.statusLines) &&
      typeof item.patchPath === "string" &&
      typeof item.patchBytes === "number" &&
      typeof item.canRestore === "boolean" &&
      Array.isArray(item.diagnostics)
    );
  });
  return { version: 1, checkpoints: checkpoints.slice(0, MAX_CHECKPOINTS) };
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
    statusLines = (await runGit(rootPath, ["status", "--short"])).stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const trackedChanged = (await runGit(rootPath, ["diff", "--name-only"])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const untracked = statusLines
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    changedFiles = Array.from(new Set([...trackedChanged, ...untracked]));
    patch = (await runGit(rootPath, ["diff", "--binary"])).stdout;
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
    ...(gitHead ? { gitHead } : {}),
    changedFiles,
    statusLines,
    patchPath,
    patchBytes,
    canRestore: patchBytes > 0,
    diagnostics: [
      "Tracked-file patch is captured for review. Restore flow still requires an explicit destructive confirmation step.",
      ...diagnostics,
    ],
  };
}

function sessionPid(proc: unknown): number | undefined {
  if (isRecord(proc) && typeof proc.pid === "number") {
    return proc.pid;
  }
  return undefined;
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

  async snapshot(userId: string): Promise<LocalAdeSnapshot> {
    const projectContext = await this.resolveProjectContext(userId);
    const state = await readCapabilityState(projectContext.rootPath);
    const [
      agents,
      activeAgentId,
      markdownCapabilities,
      projectMemory,
      mcpDocument,
      providerHealth,
      checkpointDocument,
      changeTrust,
      logs,
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
        readProjectMemory(projectContext.rootPath, state),
        readMcpDocument(projectContext.rootPath),
        readProviderHealthDocument(projectContext.rootPath),
        readCheckpointDocument(projectContext.rootPath),
        readGitSnapshot(projectContext.rootPath),
        this.logStore.query({ userId, order: "desc", limit: 20 }),
        this.sessionRepo.getStorageStats().catch(() => null),
      ]);

    const providers = await providerDescriptorsFromAgents(
      projectContext.rootPath,
      agents,
      providerHealth
    );
    const mcpServers = await Promise.all(mcpDocument.servers.map(toVisibleMcpServer));
    const capabilities = createCapabilityRegistrySnapshot(
      [
        ...markdownCapabilities,
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
        ...CAPABILITY_PLACEHOLDERS,
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
      mcp: {
        configPath: path.join(ensureProjectDataDir(projectContext.rootPath), MCP_FILE),
        servers: mcpServers,
      },
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

  async updateCapabilityState(
    userId: string,
    input: UpdateCapabilityStateInput
  ): Promise<LocalAdeSnapshot> {
    const context = await this.resolveProjectContext(userId, input.projectId);
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
      ...(sanitizeRecord(input.env) ? { env: sanitizeRecord(input.env) } : {}),
      ...(sanitizeRecord(input.headers)
        ? { headers: sanitizeRecord(input.headers) }
        : {}),
      updatedAt: now,
    };
    const index = document.servers.findIndex((server) => server.id === id);
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
    let record: ProviderHealthRecord;

    try {
      const resolved = await resolveExecutable(command);
      if (!resolved.available) {
        throw new Error(resolved.diagnostics.join(" "));
      }
      const result = await execFileAsync(command, ["--version"], {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...process.env,
          ...(agent.env ?? {}),
        },
      });
      const version =
        result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) ??
        result.stderr
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
      record = {
        status: "available",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        ...(version ? { version: version.slice(0, 160) } : {}),
        diagnostics: [
          ...resolved.diagnostics,
          `Executed ${command} --version without shell expansion.`,
        ],
      };
    } catch (error) {
      record = {
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        diagnostics: [
          `Provider probe failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }

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
    const activeSessionIds = this.sessionRuntime
      .getAll()
      .filter(
        (session) =>
          session.userId === userId &&
          path.resolve(session.projectRoot) === path.resolve(context.rootPath)
      )
      .map((session) => session.id);
    const checkpoint = await createGitCheckpoint({
      rootPath: context.rootPath,
      name: input.name,
      sessionIds: activeSessionIds,
    });
    document.checkpoints = [checkpoint, ...document.checkpoints].slice(
      0,
      MAX_CHECKPOINTS
    );
    await writeCheckpointDocument(context.rootPath, document);
    return await this.snapshot(userId);
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
