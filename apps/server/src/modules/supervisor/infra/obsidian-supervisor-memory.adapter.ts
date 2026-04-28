import { execFile } from "node:child_process";
import { appendFile, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  SupervisorAuditPort,
  SupervisorMemoryContext,
  SupervisorMemoryLogInput,
  SupervisorMemoryLookupInput,
  SupervisorMemoryPort,
  SupervisorMemoryResult,
} from "../application/ports/supervisor-memory.port";

const execFileAsync = promisify(execFile);
const OBSIDIAN_MAX_BUFFER_BYTES = 1024 * 1024;
const LOG_TEXT_PART_MAX_CHARS = 800;
const SEARCH_SNIPPET_MAX_CHARS = 800;
const LOCAL_SEARCH_MAX_FILES = 2000;
const LOCAL_SEARCH_MAX_FILE_BYTES = 256 * 1024;
const LOCAL_SEARCH_MAX_QUERY_TERMS = 24;
const MARKDOWN_EXTENSION_RE = /\.md$/i;
const MARKDOWN_PATH_RE = /[\p{L}\p{N}_./-]+\.md/giu;
const WORD_RE = /[\p{L}\p{N}_-]+/gu;

export interface ObsidianSupervisorMemoryOptions {
  command?: string;
  vault?: string;
  blueprintPath?: string;
  logPath?: string;
  searchPath: string;
  searchLimit: number;
  timeoutMs: number;
  /** Optional override used by tests or non-standard Obsidian config paths. */
  configPath?: string;
  /** Optional explicit vault root for headless local fallback. */
  vaultPath?: string;
}

export type ObsidianCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<{ stdout: string; stderr: string }>;

export class ObsidianSupervisorMemoryAdapter implements SupervisorMemoryPort {
  private readonly options: ObsidianSupervisorMemoryOptions;
  private readonly command: string;
  private readonly logger: LoggerPort;
  private readonly runner: ObsidianCommandRunner;

  constructor(
    options: ObsidianSupervisorMemoryOptions,
    logger: LoggerPort,
    runner: ObsidianCommandRunner = runObsidianCommand
  ) {
    this.options = options;
    this.command = options.command?.trim() || "obsidian";
    this.logger = logger;
    this.runner = runner;
  }

  async lookup(
    input: SupervisorMemoryLookupInput
  ): Promise<SupervisorMemoryContext> {
    const [projectBlueprint, results] = await Promise.all([
      this.readBlueprint(),
      this.search(input.query),
    ]);

    return {
      ...(projectBlueprint ? { projectBlueprint } : {}),
      results,
    };
  }

  async appendLog(input: SupervisorMemoryLogInput): Promise<void> {
    const logPath = this.options.logPath?.trim();
    if (!logPath) {
      return;
    }

    const content = buildLogEntry(input);
    const args = this.buildArgs("append", {
      path: logPath,
      content: encodeObsidianContent(content),
    });

    try {
      await this.runner(this.command, args, this.options.timeoutMs);
      this.logger.info("Supervisor Obsidian log append completed", {
        logPath,
        chatId: input.chatId,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      this.logger.warn("Supervisor Obsidian log append failed", {
        logPath,
        chatId: input.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.appendLocalLog(logPath, content, input.chatId);
    }
  }

  private async readBlueprint(): Promise<string | undefined> {
    const blueprintPath = this.options.blueprintPath?.trim();
    if (!blueprintPath) {
      return undefined;
    }

    try {
      const { stdout } = await this.runner(
        this.command,
        this.buildArgs("read", { path: blueprintPath }),
        this.options.timeoutMs
      );
      const blueprint = stdout.trim();
      this.logger.info("Supervisor Obsidian blueprint read completed", {
        blueprintPath,
        bytes: Buffer.byteLength(blueprint, "utf8"),
      });
      return blueprint.length > 0 ? blueprint : undefined;
    } catch (error) {
      this.logger.warn("Supervisor Obsidian blueprint read failed", {
        blueprintPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return await this.readLocalNote(blueprintPath, "blueprint");
    }
  }

  private async search(query: string): Promise<SupervisorMemoryResult[]> {
    const trimmedQuery = query.replace(/\s+/g, " ").trim();
    if (trimmedQuery.length === 0 || this.options.searchLimit <= 0) {
      return [];
    }

    try {
      const { stdout } = await this.runner(
        this.command,
        this.buildArgs("search:context", {
          query: trimmedQuery,
          path: this.options.searchPath,
          limit: String(this.options.searchLimit),
          format: "json",
        }),
        this.options.timeoutMs
      );
      const results = parseSearchOutput(stdout).slice(
        0,
        this.options.searchLimit
      );
      this.logger.info("Supervisor Obsidian search completed", {
        queryLength: trimmedQuery.length,
        searchPath: this.options.searchPath,
        resultCount: results.length,
      });
      return results;
    } catch (error) {
      this.logger.warn("Supervisor Obsidian search:context failed", {
        queryLength: trimmedQuery.length,
        searchPath: this.options.searchPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return await this.searchFiles(trimmedQuery);
    }
  }

  private async searchFiles(query: string): Promise<SupervisorMemoryResult[]> {
    try {
      const { stdout } = await this.runner(
        this.command,
        this.buildArgs("search", {
          query,
          path: this.options.searchPath,
          limit: String(this.options.searchLimit),
          format: "json",
        }),
        this.options.timeoutMs
      );
      const results = parseSearchOutput(stdout).slice(
        0,
        this.options.searchLimit
      );
      this.logger.info("Supervisor Obsidian search fallback completed", {
        queryLength: query.length,
        searchPath: this.options.searchPath,
        resultCount: results.length,
      });
      return results;
    } catch (error) {
      this.logger.warn("Supervisor Obsidian search fallback failed", {
        queryLength: query.length,
        searchPath: this.options.searchPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return await this.searchLocalFiles(query);
    }
  }

  private async readLocalNote(
    notePath: string,
    kind: "blueprint"
  ): Promise<string | undefined> {
    const localPath = await this.resolveLocalVaultPath(notePath);
    if (!localPath) {
      return undefined;
    }

    try {
      const content = (await readFile(localPath, "utf8")).trim();
      this.logger.info("Supervisor Obsidian local read completed", {
        kind,
        path: notePath,
        bytes: Buffer.byteLength(content, "utf8"),
      });
      return content.length > 0 ? content : undefined;
    } catch (error) {
      this.logger.warn("Supervisor Obsidian local read failed", {
        kind,
        path: notePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async appendLocalLog(
    notePath: string,
    content: string,
    chatId: string
  ): Promise<void> {
    const localPath = await this.resolveLocalVaultPath(notePath);
    if (!localPath) {
      return;
    }

    try {
      await appendFile(localPath, content, "utf8");
      this.logger.info("Supervisor Obsidian local log append completed", {
        path: notePath,
        chatId,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      this.logger.warn("Supervisor Obsidian local log append failed", {
        path: notePath,
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async searchLocalFiles(
    query: string
  ): Promise<SupervisorMemoryResult[]> {
    const vaultRoot = await this.resolveLocalVaultRoot();
    if (!vaultRoot || this.options.searchLimit <= 0) {
      return [];
    }
    const searchRoot = resolveInsideRoot(vaultRoot, this.options.searchPath);
    if (!searchRoot) {
      return [];
    }

    try {
      const files = await listMarkdownFiles(searchRoot, LOCAL_SEARCH_MAX_FILES);
      const results = await scoreLocalMarkdownFiles({
        vaultRoot,
        files,
        query,
        limit: this.options.searchLimit,
      });
      this.logger.info("Supervisor Obsidian local search completed", {
        queryLength: query.length,
        searchPath: this.options.searchPath,
        scannedFileCount: files.length,
        resultCount: results.length,
      });
      return results;
    } catch (error) {
      this.logger.warn("Supervisor Obsidian local search failed", {
        queryLength: query.length,
        searchPath: this.options.searchPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async resolveLocalVaultPath(
    notePath: string
  ): Promise<string | undefined> {
    const vaultRoot = await this.resolveLocalVaultRoot();
    if (!vaultRoot) {
      return undefined;
    }
    return resolveInsideRoot(vaultRoot, notePath);
  }

  private async resolveLocalVaultRoot(): Promise<string | undefined> {
    if (this.options.vaultPath) {
      return path.resolve(this.options.vaultPath);
    }
    const config = await readObsidianConfig(this.options.configPath);
    if (!config) {
      return undefined;
    }
    const requestedVault = this.options.vault?.trim();
    const vaults = Object.entries(config.vaults);
    const selected = requestedVault
      ? vaults.find(([id, vault]) => {
          const basename = path.basename(vault.path);
          return (
            normalizeVaultName(id) === normalizeVaultName(requestedVault) ||
            normalizeVaultName(basename) === normalizeVaultName(requestedVault)
          );
        })?.[1]
      : (vaults.find(([, vault]) => vault.open)?.[1] ??
        (vaults.length === 1 ? vaults[0]?.[1] : undefined));
    return selected?.path ? path.resolve(selected.path) : undefined;
  }

  private buildArgs(
    command: string,
    options: Record<string, string>
  ): string[] {
    const vault = this.options.vault?.trim();
    return buildObsidianArgs(command, {
      ...(vault ? { vault } : {}),
      ...options,
    });
  }
}

export class NoopSupervisorMemoryAdapter implements SupervisorMemoryPort {
  lookup(): Promise<SupervisorMemoryContext> {
    return Promise.resolve({ results: [] });
  }

  appendLog(): Promise<void> {
    return Promise.resolve();
  }
}

export class NoopSupervisorAuditAdapter implements SupervisorAuditPort {
  appendEntry(): Promise<void> {
    return Promise.resolve();
  }
}

async function runObsidianCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: OBSIDIAN_MAX_BUFFER_BYTES,
    timeout: timeoutMs,
  });
  return { stdout, stderr };
}

function buildObsidianArgs(
  command: string,
  options: Record<string, string>
): string[] {
  return [
    command,
    ...Object.entries(options)
      .filter(([, value]) => value.trim().length > 0)
      .map(([key, value]) => `${key}=${value}`),
  ];
}

interface ObsidianConfig {
  vaults: Record<string, { path: string; open?: boolean }>;
}

async function readObsidianConfig(
  configPath = path.join(os.homedir(), ".config", "obsidian", "obsidian.json")
): Promise<ObsidianConfig | undefined> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (!(isRecord(parsed) && isRecord(parsed.vaults))) {
      return undefined;
    }
    const vaults: ObsidianConfig["vaults"] = {};
    for (const [id, value] of Object.entries(parsed.vaults)) {
      if (!isRecord(value) || typeof value.path !== "string") {
        continue;
      }
      vaults[id] = {
        path: value.path,
        ...(typeof value.open === "boolean" ? { open: value.open } : {}),
      };
    }
    return Object.keys(vaults).length > 0 ? { vaults } : undefined;
  } catch {
    return undefined;
  }
}

function normalizeVaultName(value: string): string {
  return value.trim().toLowerCase();
}

function resolveInsideRoot(root: string, notePath: string): string | undefined {
  const trimmed = notePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    return undefined;
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, trimmed);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

async function listMarkdownFiles(
  root: string,
  maxFiles: number
): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".obsidian") {
          continue;
        }
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && MARKDOWN_EXTENSION_RE.test(entry.name)) {
        files.push(fullPath);
        if (files.length >= maxFiles) {
          break;
        }
      }
    }
  }
  return files;
}

async function scoreLocalMarkdownFiles(params: {
  vaultRoot: string;
  files: string[];
  query: string;
  limit: number;
}): Promise<SupervisorMemoryResult[]> {
  const query = params.query.toLowerCase();
  const markdownPathHints = extractMarkdownPathHints(query);
  const terms = extractSearchTerms(query);
  const scored: Array<
    Omit<SupervisorMemoryResult, "path"> & { path: string; score: number }
  > = [];

  for (const file of params.files) {
    const relativePath = normalizeVaultRelativePath(
      path.relative(params.vaultRoot, file)
    );
    const lowerRelativePath = relativePath.toLowerCase();
    const basename = path.basename(relativePath).toLowerCase();
    let score = 0;
    const exactPathMatch = markdownPathHints.some(
      (hint) => lowerRelativePath.endsWith(hint) || basename === hint
    );
    if (exactPathMatch) {
      score += 1000;
    }
    for (const term of terms) {
      if (lowerRelativePath.includes(term)) {
        score += 20;
      }
    }

    const content = await readFileForSearch(file);
    const lowerContent = content.toLowerCase();
    for (const term of terms) {
      if (lowerContent.includes(term)) {
        score += 5;
      }
    }
    if (score <= 0) {
      continue;
    }
    scored.push({
      title: titleFromPath(relativePath),
      path: relativePath,
      snippets: createLocalSnippets(content, terms, exactPathMatch),
      score,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, params.limit)
    .map(({ score: _score, ...result }) => result);
}

async function readFileForSearch(file: string): Promise<string> {
  const stats = await stat(file);
  if (stats.size > LOCAL_SEARCH_MAX_FILE_BYTES) {
    const content = await readFile(file, "utf8");
    return content.slice(0, LOCAL_SEARCH_MAX_FILE_BYTES);
  }
  return await readFile(file, "utf8");
}

function extractMarkdownPathHints(query: string): string[] {
  return [...query.matchAll(MARKDOWN_PATH_RE)]
    .map((match) => normalizeVaultRelativePath(match[0].trim()).toLowerCase())
    .filter(Boolean);
}

function extractSearchTerms(query: string): string[] {
  const terms = [...query.matchAll(WORD_RE)]
    .map((match) => match[0].toLowerCase())
    .filter((term) => term.length >= 3);
  return [...new Set(terms)].slice(0, LOCAL_SEARCH_MAX_QUERY_TERMS);
}

function createLocalSnippets(
  content: string,
  terms: string[],
  preferStart: boolean
): string[] {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  if (preferStart) {
    return [truncateText(normalized, SEARCH_SNIPPET_MAX_CHARS)];
  }
  const lower = normalized.toLowerCase();
  const matchedTerm = terms.find((term) => lower.includes(term));
  if (!matchedTerm) {
    return [truncateText(normalized, SEARCH_SNIPPET_MAX_CHARS)];
  }
  const index = lower.indexOf(matchedTerm);
  const start = Math.max(0, index - Math.floor(SEARCH_SNIPPET_MAX_CHARS / 3));
  return [
    truncateText(normalized.slice(start), SEARCH_SNIPPET_MAX_CHARS).trim(),
  ];
}

function normalizeVaultRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function buildLogEntry(input: SupervisorMemoryLogInput): string {
  const lines = [
    "",
    `### ${new Date().toISOString()} - ${input.chatId}`,
    `- action: ${sanitizeInline(input.action)}`,
    `- reason: ${sanitizeInline(input.reason)}`,
    `- project_root: ${sanitizeInline(input.projectRoot || "(unknown)")}`,
  ];
  if (input.turnId) {
    lines.push(`- turn_id: ${sanitizeInline(input.turnId)}`);
  }
  if (input.autoResumeSignal) {
    lines.push(
      `- auto_resume_signal: ${sanitizeInline(input.autoResumeSignal)}`
    );
  }
  if (typeof input.continuationCount === "number") {
    lines.push(`- continuation_count: ${input.continuationCount}`);
  }
  const latestText = truncateText(
    sanitizeInline(input.latestAssistantTextPart),
    LOG_TEXT_PART_MAX_CHARS
  );
  if (latestText) {
    lines.push(`- latest_text_part: ${latestText}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseSearchOutput(output: string): SupervisorMemoryResult[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return normalizeSearchJson(JSON.parse(trimmed));
  } catch {
    return parseTextSearchOutput(trimmed);
  }
}

function normalizeSearchJson(value: unknown): SupervisorMemoryResult[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeSearchItem);
  }
  if (isRecord(value)) {
    const candidateArrays = [
      value.results,
      value.files,
      value.matches,
      value.items,
    ];
    const found = candidateArrays.find(Array.isArray);
    if (found) {
      return found.flatMap(normalizeSearchItem);
    }
    return Object.entries(value).map(([path, item]) => ({
      title: titleFromPath(path),
      path,
      snippets: collectSnippets(item),
    }));
  }
  return [];
}

function normalizeSearchItem(item: unknown): SupervisorMemoryResult[] {
  if (typeof item === "string") {
    return [{ title: titleFromPath(item), path: item, snippets: [] }];
  }
  if (!isRecord(item)) {
    return [];
  }
  const path = firstString(item.path, item.file, item.filename, item.name);
  const title =
    firstString(item.title, item.name) ??
    (path ? titleFromPath(path) : "Untitled");
  return [
    {
      title,
      ...(path ? { path } : {}),
      snippets: collectSnippets(item),
    },
  ];
}

function collectSnippets(value: unknown): string[] {
  const snippets: string[] = [];
  visitSnippetValue(value, snippets);
  return [...new Set(snippets)]
    .filter((snippet) => snippet.length > 0)
    .slice(0, 4)
    .map((snippet) => truncateText(snippet, SEARCH_SNIPPET_MAX_CHARS));
}

function visitSnippetValue(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value.replace(/\s+/g, " ").trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      visitSnippetValue(item, out);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of ["context", "snippet", "text", "line", "excerpt"]) {
    visitSnippetValue(value[key], out);
  }
  visitSnippetValue(value.matches, out);
}

function parseTextSearchOutput(output: string): SupervisorMemoryResult[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line) => ({
      title: line,
      snippets: [],
    }));
}

function encodeObsidianContent(content: string): string {
  return content.replace(/\t/g, "\\t").replace(/\n/g, "\\n");
}

function sanitizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)} [truncated]`;
}

function titleFromPath(path: string): string {
  return path.split("/").pop()?.replace(MARKDOWN_EXTENSION_RE, "") || path;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const __obsidianSupervisorMemoryInternals = {
  parseSearchOutput,
  buildLogEntry,
  buildObsidianArgs,
};
