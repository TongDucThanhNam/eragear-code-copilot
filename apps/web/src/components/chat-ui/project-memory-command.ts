export const PROJECT_MEMORY_COMMAND_NAME = "memory";

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
): { query: string; sourcePaths: string[] } | null {
  const match = text.match(/^\/memory(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  const tokens = tokenizeMemoryCommandArgs(match[1] ?? "");
  const sourcePaths: string[] = [];
  const queryTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
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
    queryTokens.push(token);
  }

  return { query: queryTokens.join(" ").trim(), sourcePaths };
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
  sourcePaths?: string[];
}): string {
  const sourceArgs = (input.sourcePaths ?? [])
    .map((path) => quoteProjectMemorySourcePath(path))
    .filter((path) => path.length > 0)
    .flatMap((path) => ["--source", path]);
  const request = input.request?.trim() ?? "";
  const parts = [`/${PROJECT_MEMORY_COMMAND_NAME}`, ...sourceArgs];
  if (request) {
    parts.push(request);
    return parts.join(" ");
  }
  return `${parts.join(" ")} `;
}
