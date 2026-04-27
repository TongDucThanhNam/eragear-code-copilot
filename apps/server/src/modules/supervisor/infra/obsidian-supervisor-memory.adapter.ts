import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
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
const MARKDOWN_EXTENSION_RE = /\.md$/i;

export interface ObsidianSupervisorMemoryOptions {
  command?: string;
  vault?: string;
  blueprintPath?: string;
  logPath?: string;
  searchPath: string;
  searchLimit: number;
  timeoutMs: number;
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
      return undefined;
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
      return [];
    }
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
