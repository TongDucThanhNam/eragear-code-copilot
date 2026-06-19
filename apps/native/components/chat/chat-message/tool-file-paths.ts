import type { ToolUIPart } from "@eragear-code-copilot/shared";

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

const collectDiffOutputFilePaths = (
  value: unknown,
  paths: Set<string>,
  depth = 0
) => {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDiffOutputFilePaths(item, paths, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.type === "diff" && typeof value.path === "string") {
    paths.add(value.path);
    return;
  }
  for (const nestedValue of Object.values(value)) {
    collectDiffOutputFilePaths(nestedValue, paths, depth + 1);
  }
};

const isDiffOutputItem = (item: unknown) =>
  isRecord(item) && item.type === "diff";

export const isFileEditTool = (params: {
  title?: string;
  type: ToolUIPart["type"];
}) => {
  const label = `${params.type} ${params.title ?? ""}`.toLowerCase();
  return FILE_EDIT_TOOL_PATTERN.test(label);
};

export const getToolChangedFilePaths = (params: {
  input: ToolUIPart["input"];
  output?: unknown;
  title?: string;
  type: ToolUIPart["type"];
}) => {
  const paths = new Set<string>();
  collectDiffOutputFilePaths(params.output, paths);
  if (isFileEditTool(params)) {
    collectInputFilePaths(params.input, paths);
  }
  return Array.from(paths);
};

export const getDiffOutputFilePaths = (output: unknown) => {
  const paths = new Set<string>();
  collectDiffOutputFilePaths(output, paths);
  return Array.from(paths);
};

export const stripDiffOutputItems = (output: unknown) => {
  if (isDiffOutputItem(output)) {
    return undefined;
  }
  if (!Array.isArray(output)) {
    return output;
  }
  const filtered = output.filter((item) => !isDiffOutputItem(item));
  return filtered.length > 0 ? filtered : undefined;
};
