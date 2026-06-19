// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
export const PROJECT_MEMORY_COMMAND_NAME = "memory";

export interface ParsedProjectMemoryCommand {
  query: string;
  sourcePaths: string[];
  retrievalMode?: "full" | "semantic";
  presetId?: string;
  maxChunks?: number;
}

function tokenizeMemoryCommandArgs(value: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

export function parseProjectMemoryCommand(
  text: string
): ParsedProjectMemoryCommand | null {
  const match = text.match(/^\/memory(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  const tokens = tokenizeMemoryCommandArgs(match[1] ?? "");
  const sourcePaths: string[] = [];
  const queryTokens: string[] = [];
  let retrievalMode: "full" | "semantic" | undefined;
  let presetId: string | undefined;
  let maxChunks: number | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--semantic") {
      retrievalMode = "semantic";
      continue;
    }
    if (token === "--full") {
      retrievalMode = "full";
      continue;
    }
    if (token === "--chunks") {
      const count = Number(tokens[index + 1]?.trim());
      if (Number.isFinite(count) && count > 0) {
        maxChunks = Math.floor(count);
        index += 1;
      }
      continue;
    }
    if (token.startsWith("--chunks=")) {
      const count = Number(token.slice("--chunks=".length).trim());
      if (Number.isFinite(count) && count > 0) {
        maxChunks = Math.floor(count);
      }
      continue;
    }
    if (token === "--source" || token === "-s") {
      const sourcePath = tokens[index + 1]?.trim();
      if (sourcePath) {
        sourcePaths.push(sourcePath);
        index += 1;
      }
      continue;
    }
    if (token.startsWith("--source=")) {
      const sourcePath = token.slice("--source=".length).trim();
      if (sourcePath) {
        sourcePaths.push(sourcePath);
      }
      continue;
    }
    if (token === "--preset" || token === "-p") {
      const nextPresetId = tokens[index + 1]?.trim();
      if (nextPresetId) {
        presetId = nextPresetId;
        index += 1;
      }
      continue;
    }
    if (token.startsWith("--preset=")) {
      const nextPresetId = token.slice("--preset=".length).trim();
      if (nextPresetId) {
        presetId = nextPresetId;
      }
      continue;
    }
    queryTokens.push(token);
  }

  return {
    query: queryTokens.join(" ").trim(),
    sourcePaths,
    ...(retrievalMode ? { retrievalMode } : {}),
    ...(presetId ? { presetId } : {}),
    ...(maxChunks ? { maxChunks } : {}),
  };
}

export function quoteProjectMemorySourcePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  if (!/[\s"']/.test(trimmed)) {
    return trimmed;
  }
  if (!trimmed.includes('"')) {
    return `"${trimmed}"`;
  }
  if (!trimmed.includes("'")) {
    return `'${trimmed}'`;
  }
  return trimmed;
}

export function getProjectMemoryRequestDraft(text: string): string {
  const parsed = parseProjectMemoryCommand(text);
  if (parsed) {
    return parsed.query;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("@")) {
    return "";
  }
  return trimmed;
}

export function buildProjectMemoryCommandText(input: {
  request?: string;
  retrievalMode?: "full" | "semantic";
  presetId?: string;
  sourcePaths?: string[];
  maxChunks?: number;
}): string {
  const retrievalArgs =
    input.retrievalMode === "semantic"
      ? [
          "--semantic",
          ...(input.maxChunks && input.maxChunks > 0
            ? ["--chunks", String(Math.floor(input.maxChunks))]
            : []),
        ]
      : input.retrievalMode === "full"
        ? ["--full"]
        : [];
  const presetArgs = input.presetId?.trim()
    ? ["--preset", quoteProjectMemorySourcePath(input.presetId)]
    : [];
  const sourceArgs = (input.sourcePaths ?? [])
    .map((path) => quoteProjectMemorySourcePath(path))
    .filter((path) => path.length > 0)
    .flatMap((path) => ["--source", path]);
  const request = input.request?.trim() ?? "";
  const parts = [
    `/${PROJECT_MEMORY_COMMAND_NAME}`,
    ...retrievalArgs,
    ...presetArgs,
    ...sourceArgs,
  ];
  if (request) {
    parts.push(request);
    return parts.join(" ");
  }
  return `${parts.join(" ")} `;
}
