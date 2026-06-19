// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import type {
  TextUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "@eragear-code-copilot/shared";

const FINAL_PART_TYPES = new Set([
  "text",
  "source-url",
  "source-document",
  "file",
]);

export type SourcePart = Extract<
  UIMessagePart,
  { type: "source-url" | "source-document" }
>;

export type FilePart = Extract<UIMessagePart, { type: "file" }>;

export const isDataPart = (
  part: UIMessagePart
): part is Extract<UIMessagePart, { type: `data-${string}` }> =>
  part.type.startsWith("data-");

export const isPlanPart = (
  part: UIMessagePart
): part is Extract<ToolUIPart, { type: "tool-plan" }> =>
  part.type === "tool-plan";

const isFinalPart = (
  part: UIMessagePart
): part is TextUIPart | SourcePart | FilePart =>
  FINAL_PART_TYPES.has(part.type);

const mergeTextParts = (parts: TextUIPart[]) => {
  const content = parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return content.length > 0 ? content : null;
};

export const splitMessageParts = (parts: UIMessagePart[]) => {
  const displayParts = parts.filter(
    (part) => !(isDataPart(part) || isPlanPart(part))
  );
  let trailingStart = displayParts.length;
  for (let i = displayParts.length - 1; i >= 0; i -= 1) {
    if (isFinalPart(displayParts[i])) {
      trailingStart = i;
      continue;
    }
    break;
  }
  const chainItems = displayParts.slice(0, trailingStart);
  const finalItems = displayParts.slice(trailingStart);
  const finalText = mergeTextParts(
    finalItems.filter((part): part is TextUIPart => part.type === "text")
  );
  const finalAttachments = finalItems.filter(
    (part): part is SourcePart | FilePart => part.type !== "text"
  );

  return { chainItems, finalText, finalAttachments };
};

export const resolveAssistantFinalVisibility = (params: {
  finalText: string | null;
  finalAttachmentsCount: number;
  isStreaming: boolean;
  chainItemsCount: number;
}) => {
  const showFinalText = Boolean(params.finalText);
  const showFinalAttachments =
    params.finalAttachmentsCount > 0 &&
    (!params.isStreaming || params.chainItemsCount === 0);
  return {
    showFinalText,
    showFinalAttachments,
    shouldRenderFinal: showFinalText || showFinalAttachments,
  };
};

export type ToolViewState =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "approval-requested";

export type ChainDisplayItem =
  | {
      kind: "part";
      itemKey: string;
      part: UIMessagePart;
      originalIndex: number;
    }
  | {
      kind: "tool-group";
      itemKey: string;
      tools: ToolUIPart[];
      originalStartIndex: number;
      originalEndIndex: number;
    };

export const toToolViewState = (tool: ToolUIPart): ToolViewState => {
  switch (tool.state) {
    case "input-streaming":
      return "pending";
    case "input-available":
      return "running";
    case "approval-requested":
      return "approval-requested";
    case "approval-responded":
      return "running";
    case "output-available":
      return "completed";
    case "output-error":
    case "output-denied":
      return "error";
    case "output-cancelled":
      return "cancelled";
    default:
      return "pending";
  }
};

const isToolActive = (tool: ToolUIPart) =>
  tool.state !== "output-available" &&
  tool.state !== "output-error" &&
  tool.state !== "output-denied" &&
  tool.state !== "output-cancelled";

const isPartActive = (part: UIMessagePart) => {
  if (part.type === "text" || part.type === "reasoning") {
    return part.state === "streaming";
  }
  if (part.type.startsWith("tool-")) {
    return isToolActive(part as ToolUIPart);
  }
  return false;
};

export const getActiveIndex = (parts: UIMessagePart[]) => {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (isPartActive(parts[i])) {
      return i;
    }
  }
  return -1;
};

export const isMessageStreaming = (parts: UIMessagePart[]) =>
  parts.some((part) => isPartActive(part));

export const isChainStreaming = (parts: UIMessagePart[]) =>
  splitMessageParts(parts).chainItems.some((part) => isPartActive(part));

export const buildMessageCopyText = (message: UIMessage) => {
  const textParts = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean);

  return textParts.join("\n\n");
};

export interface ParsedToolOutput {
  result: ToolUIPart["output"];
  terminalIds: string[];
  changedFilePaths: string[];
  changedFiles: ParsedToolChangedFile[];
}

export interface ParsedToolChangedFile {
  path: string;
  addedLines?: number;
  removedLines?: number;
}

const countTextLines = (value: string) => {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutTrailingNewlines = normalized.replace(/\n+$/g, "");
  return withoutTrailingNewlines.length > 0
    ? withoutTrailingNewlines.split("\n").length
    : 0;
};

const readDiffChangedFile = (value: unknown): ParsedToolChangedFile | null => {
  if (
    !(
      value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: unknown }).type === "diff" &&
      typeof (value as { path?: unknown }).path === "string"
    )
  ) {
    return null;
  }

  const diff = value as unknown as {
    path: string;
    oldText?: unknown;
    newText?: unknown;
  };
  return {
    path: diff.path,
    ...(typeof diff.newText === "string"
      ? { addedLines: countTextLines(diff.newText) }
      : {}),
    ...(typeof diff.oldText === "string"
      ? { removedLines: countTextLines(diff.oldText) }
      : {}),
  };
};

const mergeChangedFile = (
  files: Map<string, ParsedToolChangedFile>,
  file: ParsedToolChangedFile
) => {
  const existing = files.get(file.path);
  if (!existing) {
    files.set(file.path, file);
    return;
  }

  files.set(file.path, {
    path: file.path,
    ...(existing.addedLines !== undefined || file.addedLines !== undefined
      ? { addedLines: (existing.addedLines ?? 0) + (file.addedLines ?? 0) }
      : {}),
    ...(existing.removedLines !== undefined || file.removedLines !== undefined
      ? {
          removedLines: (existing.removedLines ?? 0) + (file.removedLines ?? 0),
        }
      : {}),
  });
};

export const parseToolOutput = (
  output: ToolUIPart["output"]
): ParsedToolOutput => {
  if (!Array.isArray(output)) {
    const changedFile = readDiffChangedFile(output);
    if (changedFile) {
      return {
        result: undefined,
        terminalIds: [],
        changedFilePaths: [changedFile.path],
        changedFiles: [changedFile],
      };
    }
    return {
      result: output,
      terminalIds: [],
      changedFilePaths: [],
      changedFiles: [],
    };
  }
  const terminalIds = new Set<string>();
  const changedFiles = new Map<string, ParsedToolChangedFile>();
  const textParts: string[] = [];
  const residualItems: unknown[] = [];
  for (const item of output) {
    let handled = false;
    const changedFile = readDiffChangedFile(item);
    if (changedFile) {
      mergeChangedFile(changedFiles, changedFile);
      handled = true;
    }
    if (item && typeof item === "object" && "type" in item) {
      const typed = item as {
        type: string;
        terminalId?: string;
        content?: { type?: string; text?: string };
      };
      if (typed.type === "terminal" && typed.terminalId) {
        terminalIds.add(typed.terminalId);
        handled = true;
      }
      if (
        typed.type === "content" &&
        typed.content?.type === "text" &&
        typed.content.text
      ) {
        textParts.push(typed.content.text);
        handled = true;
      }
    }
    if (!handled) {
      residualItems.push(item);
    }
  }
  let result: ToolUIPart["output"];
  if (textParts.length > 0) {
    result = textParts.join("\n");
  } else if (residualItems.length === 0) {
    result = undefined;
  } else if (residualItems.length === 1) {
    result = residualItems[0] as ToolUIPart["output"];
  } else {
    result = residualItems as ToolUIPart["output"];
  }
  return {
    result,
    terminalIds: Array.from(terminalIds),
    changedFilePaths: Array.from(changedFiles.keys()),
    changedFiles: Array.from(changedFiles.values()),
  };
};

const FILE_PATH_KEYS = new Set([
  "file",
  "filePath",
  "file_path",
  "filename",
  "path",
  "targetFile",
  "target_file",
]);

const FILE_EDIT_TOOL_PATTERN = new RegExp(
  [
    "(^|[-_/])(edit|write|patch|replace|modify|update)([-_/]|$)",
    "write_file",
    "writefile",
    "edit_file",
    "editfile",
  ].join("|"),
  "u"
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectInputFilePaths = (
  value: unknown,
  paths: Set<string>,
  depth = 0
) => {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectInputFilePaths(item, paths, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      FILE_PATH_KEYS.has(key) &&
      typeof nestedValue === "string" &&
      nestedValue.trim().length > 0
    ) {
      paths.add(nestedValue.trim());
    }
    collectInputFilePaths(nestedValue, paths, depth + 1);
  }
};

export const isFileEditTool = (tool: ToolUIPart) => {
  const label = `${tool.type} ${tool.title ?? ""}`.toLowerCase();
  return FILE_EDIT_TOOL_PATTERN.test(label);
};

export const getToolChangedFilePaths = (
  tool: ToolUIPart,
  parsedOutput: ParsedToolOutput
) => {
  const paths = new Set(parsedOutput.changedFilePaths);
  if (isFileEditTool(tool)) {
    collectInputFilePaths(tool.input, paths);
  }
  return Array.from(paths);
};

const messageTerminalIdCache = new WeakMap<UIMessage, string[]>();

export const getMessageTerminalIds = (message: UIMessage) => {
  const cached = messageTerminalIdCache.get(message);
  if (cached) {
    return cached;
  }
  const terminalIds = new Set<string>();
  for (const part of message.parts) {
    if (part.type.startsWith("tool-")) {
      const parsed = parseToolOutput((part as ToolUIPart).output);
      for (const terminalId of parsed.terminalIds) {
        terminalIds.add(terminalId);
      }
    }
  }
  const result = Array.from(terminalIds);
  messageTerminalIdCache.set(message, result);
  return result;
};

export const getPartKey = (part: UIMessagePart, _index?: number) => {
  const partId = (part as { id?: unknown }).id;
  if (typeof partId === "string" && partId.length > 0) {
    return `part:${partId}`;
  }
  if (part.type.startsWith("tool-")) {
    return `tool:${(part as ToolUIPart).toolCallId}`;
  }
  if (part.type === "source-url" || part.type === "source-document") {
    return `source:${part.sourceId}`;
  }
  if (part.type === "file") {
    return `file:${part.url}`;
  }
  if (part.type === "reasoning") {
    return "reasoning";
  }
  if (part.type === "text") {
    return "text";
  }
  if (part.type === "step-start") {
    return "step-start";
  }
  if (isDataPart(part)) {
    return part.id ? `${part.type}:${part.id}` : part.type;
  }
  return part.type;
};

/**
 * Wrap getPartKey with deduplication. If two parts in the same list
 * produce the same base key, append a deterministic ordinal suffix.
 */
export const deduplicateKeys = (
  items: UIMessagePart[],
  keyFn: (part: UIMessagePart, index: number) => string = getPartKey
): string[] => {
  const seen = new Map<string, number>();
  return items.map((item, index) => {
    const base = keyFn(item, index);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `${base}#${count}`;
  });
};

const isToolPart = (part: UIMessagePart): part is ToolUIPart =>
  part.type.startsWith("tool-");

export const groupChainDisplayItems = (
  items: UIMessagePart[],
  itemKeys: string[] = deduplicateKeys(items)
): ChainDisplayItem[] => {
  const groups: ChainDisplayItem[] = [];
  let index = 0;

  while (index < items.length) {
    const part = items[index];
    if (!(part && isToolPart(part))) {
      if (part) {
        groups.push({
          kind: "part",
          itemKey: itemKeys[index] ?? getPartKey(part, index),
          part,
          originalIndex: index,
        });
      }
      index += 1;
      continue;
    }

    const tools = [part];
    let endIndex = index;

    while (endIndex + 1 < items.length) {
      const nextPart = items[endIndex + 1];
      if (!(nextPart && isToolPart(nextPart))) {
        break;
      }
      tools.push(nextPart);
      endIndex += 1;
    }

    const firstTool = tools[0];
    const lastTool = tools[tools.length - 1];
    groups.push({
      kind: "tool-group",
      itemKey: `tool-group:${itemKeys[index] ?? getPartKey(firstTool, index)}:${
        itemKeys[endIndex] ?? getPartKey(lastTool, endIndex)
      }`,
      tools,
      originalStartIndex: index,
      originalEndIndex: endIndex,
    });

    index = endIndex + 1;
  }

  return groups;
};
