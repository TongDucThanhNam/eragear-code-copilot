import type { TurnDiffFile, TurnDiffFileKind } from "./contracts/git.contract";

const DIFF_HEADER_PREFIX = "diff --git ";
const OLD_FILE_PREFIX = "--- ";
const NEW_FILE_PREFIX = "+++ ";
const RENAME_FROM_PREFIX = "rename from ";
const RENAME_TO_PREFIX = "rename to ";
const COPY_FROM_PREFIX = "copy from ";
const COPY_TO_PREFIX = "copy to ";
const SAFE_SESSION_ID_REGEX = /^[A-Za-z0-9._-]+$/;
const GIT_SIDE_PREFIX_REGEX = /^[ab]\//;

interface PendingDiffFile {
  oldPath?: string;
  path?: string;
  kind: TurnDiffFileKind;
  additions: number;
  deletions: number;
}

export function buildTurnCheckpointRef(
  sessionId: string,
  turnCount: number
): string {
  const normalizedSessionId = sessionId.trim();
  if (!SAFE_SESSION_ID_REGEX.test(normalizedSessionId)) {
    throw new Error(
      "Git turn checkpoint session id contains unsafe characters"
    );
  }
  if (!(Number.isSafeInteger(turnCount) && turnCount >= 0)) {
    throw new Error("Git turn checkpoint count must be a non-negative integer");
  }
  return `refs/eragear/session-${normalizedSessionId}-turn-${turnCount}`;
}

export function parseTurnDiffFiles(unifiedDiff: string): TurnDiffFile[] {
  const normalized = unifiedDiff.replaceAll("\r\n", "\n");
  if (!normalized.trim()) {
    return [];
  }

  const files: TurnDiffFile[] = [];
  let pending: PendingDiffFile | undefined;

  const flush = () => {
    if (!(pending?.path && pending.path !== "/dev/null")) {
      pending = undefined;
      return;
    }
    files.push({
      path: pending.path,
      ...(pending.oldPath && pending.oldPath !== pending.path
        ? { oldPath: pending.oldPath }
        : {}),
      kind: pending.kind,
      additions: pending.additions,
      deletions: pending.deletions,
    });
    pending = undefined;
  };

  for (const line of normalized.split("\n")) {
    if (line.startsWith(DIFF_HEADER_PREFIX)) {
      flush();
      pending = {
        kind: "modified",
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!pending) {
      continue;
    }
    applyDiffLine(pending, line);
  }
  flush();

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeDiffPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") {
    return trimmed;
  }
  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"')
      ? JSON.parse(trimmed)
      : trimmed;
  return String(unquoted).replace(GIT_SIDE_PREFIX_REGEX, "");
}

function applyDiffLine(pending: PendingDiffFile, line: string): void {
  if (line.startsWith("new file mode ")) {
    pending.kind = "added";
    return;
  }
  if (line.startsWith("deleted file mode ")) {
    pending.kind = "deleted";
    return;
  }
  if (line.startsWith(RENAME_FROM_PREFIX)) {
    pending.kind = "renamed";
    pending.oldPath = normalizeDiffPath(line.slice(RENAME_FROM_PREFIX.length));
    return;
  }
  if (line.startsWith(RENAME_TO_PREFIX)) {
    pending.kind = "renamed";
    pending.path = normalizeDiffPath(line.slice(RENAME_TO_PREFIX.length));
    return;
  }
  if (line.startsWith(COPY_FROM_PREFIX)) {
    pending.kind = "copied";
    pending.oldPath = normalizeDiffPath(line.slice(COPY_FROM_PREFIX.length));
    return;
  }
  if (line.startsWith(COPY_TO_PREFIX)) {
    pending.kind = "copied";
    pending.path = normalizeDiffPath(line.slice(COPY_TO_PREFIX.length));
    return;
  }
  if (line.startsWith(OLD_FILE_PREFIX)) {
    const oldPath = normalizeDiffPath(
      line.slice(OLD_FILE_PREFIX.length).split("\t", 1)[0] ?? ""
    );
    if (oldPath !== "/dev/null") {
      pending.oldPath = oldPath;
    }
    return;
  }
  if (line.startsWith(NEW_FILE_PREFIX)) {
    const nextPath = normalizeDiffPath(
      line.slice(NEW_FILE_PREFIX.length).split("\t", 1)[0] ?? ""
    );
    if (nextPath === "/dev/null") {
      pending.path = pending.oldPath;
      pending.kind = "deleted";
    } else {
      pending.path = nextPath;
    }
    return;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    pending.additions += 1;
    return;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    pending.deletions += 1;
  }
}
