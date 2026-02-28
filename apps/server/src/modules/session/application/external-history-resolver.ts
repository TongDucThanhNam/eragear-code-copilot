import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { TextUIPart, UIMessage } from "@repo/shared";

export interface ExternalHistoryResolveInput {
  sessionIdToLoad?: string;
  agentCommand: string;
  agentEnv: Record<string, string>;
}

interface TimelineTextEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  order: number;
}

type JsonRecord = Record<string, unknown>;

const CODEX_DIR_NAME = ".codex";
const CODEX_HISTORY_FILE_NAME = "history.jsonl";
const CODEX_SESSIONS_DIR_NAME = "sessions";

export async function resolveExternalHistoryImportMessages(
  input: ExternalHistoryResolveInput
): Promise<UIMessage[] | null> {
  const sessionId = input.sessionIdToLoad?.trim();
  if (
    !(
      sessionId &&
      isExternalHistoryImportSupportedAgentCommand(input.agentCommand)
    )
  ) {
    return null;
  }

  const homeDir = resolveHomeDirectory(input.agentEnv);
  if (!homeDir) {
    return null;
  }

  const codexRoot = path.join(homeDir, CODEX_DIR_NAME);
  const transcriptPath = await findCodexTranscriptPath(codexRoot, sessionId);
  if (!transcriptPath) {
    return null;
  }

  const [historyText, transcriptText] = await Promise.all([
    readOptionalText(path.join(codexRoot, CODEX_HISTORY_FILE_NAME)),
    readOptionalText(transcriptPath),
  ]);
  if (!historyText || !transcriptText) {
    return null;
  }

  const entries = mergeCodexEntries({
    historyText,
    transcriptText,
    sessionId,
  });
  if (entries.length === 0) {
    return null;
  }

  return entries.map((entry, index) => {
    const textPart: TextUIPart = {
      type: "text",
      text: entry.text,
      state: "done",
    };
    return {
      id: `msg-import-${entry.role}-${entry.timestamp}-${index + 1}`,
      role: entry.role,
      createdAt: entry.timestamp,
      parts: [textPart],
    } satisfies UIMessage;
  });
}

export function mergeCodexEntries(params: {
  historyText: string;
  transcriptText: string;
  sessionId: string;
}): TimelineTextEntry[] {
  const entries: TimelineTextEntry[] = [];
  let order = 0;

  for (const entry of parseCodexHistoryUserEntries(
    params.historyText,
    params.sessionId
  )) {
    entries.push({
      ...entry,
      order: order + entry.order,
    });
  }
  order = entries.length;

  for (const entry of parseCodexTranscriptAssistantEntries(params.transcriptText)) {
    entries.push({
      ...entry,
      order: order + entry.order,
    });
  }

  entries.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return left.order - right.order;
  });

  return dedupeAdjacentEntries(entries);
}

function dedupeAdjacentEntries(
  entries: TimelineTextEntry[]
): TimelineTextEntry[] {
  if (entries.length <= 1) {
    return entries;
  }

  const deduped: TimelineTextEntry[] = [];
  for (const entry of entries) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.role === entry.role &&
      previous.text === entry.text &&
      previous.timestamp === entry.timestamp
    ) {
      continue;
    }
    deduped.push(entry);
  }
  return deduped;
}

function parseCodexHistoryUserEntries(
  historyText: string,
  sessionId: string
): TimelineTextEntry[] {
  const entries: TimelineTextEntry[] = [];
  let order = 0;

  for (const line of historyText.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseJsonRecord(line);
    if (!parsed) {
      continue;
    }
    if (parsed.session_id !== sessionId) {
      continue;
    }
    const text = normalizeText(parsed.text);
    const timestamp = normalizeUnixTimestampMs(parsed.ts);
    if (!(text && timestamp)) {
      continue;
    }
    entries.push({
      role: "user",
      text,
      timestamp,
      order,
    });
    order += 1;
  }

  return entries;
}

function parseCodexTranscriptAssistantEntries(
  transcriptText: string
): TimelineTextEntry[] {
  const entries: TimelineTextEntry[] = [];
  let order = 0;

  for (const line of transcriptText.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseJsonRecord(line);
    if (!parsed || parsed.type !== "response_item") {
      continue;
    }
    const payload = asRecord(parsed.payload);
    if (!(payload && payload.type === "message" && payload.role === "assistant")) {
      continue;
    }
    const timestamp = normalizeIsoTimestampMs(parsed.timestamp);
    if (!timestamp) {
      continue;
    }
    const text = extractAssistantOutputText(payload.content);
    if (!text) {
      continue;
    }
    entries.push({
      role: "assistant",
      text,
      timestamp,
      order,
    });
    order += 1;
  }

  return entries;
}

function extractAssistantOutputText(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }
  const segments: string[] = [];
  for (const rawPart of content) {
    const part = asRecord(rawPart);
    if (!(part && part.type === "output_text")) {
      continue;
    }
    const text = normalizeText(part.text);
    if (text) {
      segments.push(text);
    }
  }
  if (segments.length === 0) {
    return null;
  }
  return segments.join("\n");
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUnixTimestampMs(value: unknown): number | null {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  if (raw >= 1_000_000_000_000) {
    return Math.trunc(raw);
  }
  return Math.trunc(raw * 1000);
}

function normalizeIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return Math.trunc(ms);
}

export function isExternalHistoryImportSupportedAgentCommand(
  command: string
): boolean {
  const normalized = path.basename(command).toLowerCase();
  return normalized.includes("codex");
}

function resolveHomeDirectory(agentEnv: Record<string, string>): string | null {
  const candidates = [
    agentEnv.HOME,
    agentEnv.USERPROFILE,
    process.env.HOME,
    process.env.USERPROFILE,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

async function findCodexTranscriptPath(
  codexRoot: string,
  sessionId: string
): Promise<string | null> {
  const root = path.join(codexRoot, CODEX_SESSIONS_DIR_NAME);
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readOptionalDirectoryEntries(current);
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name.includes(sessionId)
      ) {
        return fullPath;
      }
    }
  }

  return null;
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readOptionalDirectoryEntries(
  dirPath: string
): Promise<Dirent<string>[] | null> {
  try {
    return await readdir(dirPath, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

function parseJsonRecord(line: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(line);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}
