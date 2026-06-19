// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { ToolUIPart } from "@eragear-code-copilot/shared";
import { memo } from "react";
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolHeaderSummary,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { useChatTerminalSnapshots } from "@/store/chat-stream-store";
import {
  getToolChangedFilePaths,
  isFileEditTool,
  type ParsedToolOutput,
  toToolViewState,
} from "./agentic-message-utils";
import { TerminalView } from "./terminal-view";

interface ToolMessagePartProps {
  chatId: string | null;
  tool: ToolUIPart;
  parsedOutput: ParsedToolOutput;
}

const ToolChangedFiles = ({ paths }: { paths: string[] }) => (
  <div className="space-y-2 py-2">
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Changed Files
    </h4>
    <div className="space-y-1">
      {paths.length > 0 ? (
        paths.map((path) => (
          <div
            className="truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-foreground text-xs"
            key={path}
            title={path}
          >
            {path}
          </div>
        ))
      ) : (
        <p className="text-muted-foreground text-xs">File path unavailable.</p>
      )}
    </div>
  </div>
);

const COMMAND_KEYS = ["command", "cmd", "script", "shellCommand", "args"];
const QUERY_KEYS = ["query", "pattern", "search", "prompt"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truncateSummary = (value: string, maxLength = 96) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
};

const getInputString = (value: unknown, keys: string[]) => {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
    if (Array.isArray(candidate) && candidate.length > 0) {
      const serialized = candidate
        .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
        .join(" ");
      if (serialized.trim().length > 0) {
        return serialized.trim();
      }
    }
  }
  return null;
};

const splitPathSummary = (path: string) => {
  const normalized = path.trim();
  const parts = normalized.split(/[\\/]/);
  const primary = parts.pop() || normalized;
  const secondary =
    parts.length > 0
      ? `${parts.join(normalized.includes("\\") ? "\\" : "/")}/`
      : "";
  return { primary, secondary, title: normalized };
};

const getToolActionLabel = (params: {
  tool: ToolUIPart;
  state: ReturnType<typeof toToolViewState>;
  summary?: ToolHeaderSummary;
}) => {
  if (params.state === "pending") {
    return "Preparing";
  }
  if (params.state === "running") {
    return params.summary?.kind === "file" ? "Writing" : "Running";
  }
  if (params.state === "approval-requested") {
    return "Needs approval";
  }
  if (params.state === "error") {
    return "Failed";
  }
  if (params.state === "cancelled") {
    return "Cancelled";
  }
  if (params.summary?.kind === "command") {
    return "Ran";
  }
  if (params.summary?.kind === "file") {
    const label =
      `${params.tool.type} ${params.tool.title ?? ""}`.toLowerCase();
    return /(^|[-_\s])(edit|patch|replace|modify|update)([-_\s]|$)/u.test(label)
      ? "Edited"
      : "Wrote";
  }
  return undefined;
};

const buildToolHeaderSummary = (params: {
  tool: ToolUIPart;
  parsedOutput: ParsedToolOutput;
  changedFilePaths: string[];
  hasTerminalOutput: boolean;
}): ToolHeaderSummary | undefined => {
  const firstPath = params.changedFilePaths[0];
  if (firstPath) {
    const pathSummary = splitPathSummary(firstPath);
    const changedFile = params.parsedOutput.changedFiles.find(
      (file) => file.path === firstPath
    );
    return {
      kind: "file",
      ...pathSummary,
      ...(params.changedFilePaths.length > 1
        ? { extraCount: params.changedFilePaths.length - 1 }
        : {}),
      ...(changedFile?.addedLines !== undefined
        ? { addedLines: changedFile.addedLines }
        : {}),
      ...(changedFile?.removedLines !== undefined
        ? { removedLines: changedFile.removedLines }
        : {}),
    };
  }

  const command = getInputString(params.tool.input, COMMAND_KEYS);
  if (command || params.hasTerminalOutput) {
    return {
      kind: "command",
      primary: command ? truncateSummary(command) : "Terminal output",
      title: command ?? "Terminal output",
    };
  }

  const query = getInputString(params.tool.input, QUERY_KEYS);
  if (query) {
    return {
      kind: "generic",
      primary: truncateSummary(query),
      title: query,
    };
  }

  return undefined;
};

export const ToolMessagePart = memo(
  ({ chatId, tool, parsedOutput }: ToolMessagePartProps) => {
    const viewState = toToolViewState(tool);
    const { result, terminalIds } = parsedOutput;
    const changedFilePaths = getToolChangedFilePaths(tool, parsedOutput);
    const shouldShowChangedFiles =
      changedFilePaths.length > 0 || isFileEditTool(tool);
    const terminalSnapshots = useChatTerminalSnapshots(chatId, terminalIds);
    const hasTerminalOutput = terminalSnapshots.some(
      (snapshot) => snapshot.totalChars > 0
    );
    const summary = buildToolHeaderSummary({
      tool,
      parsedOutput,
      changedFilePaths,
      hasTerminalOutput,
    });
    const actionLabel = getToolActionLabel({ tool, state: viewState, summary });
    const errorText =
      tool.state === "output-error"
        ? tool.errorText
        : tool.state === "output-denied"
          ? `Permission denied${
              tool.approval?.reason ? ` (${tool.approval.reason})` : ""
            }`
          : undefined;
    return (
      <Tool className="mb-0" defaultOpen={false}>
        <ToolHeader
          actionLabel={actionLabel}
          state={viewState}
          summary={summary}
          title={tool.title}
          type={tool.type}
        />
        <ToolContent>
          {shouldShowChangedFiles ? (
            <ToolChangedFiles paths={changedFilePaths} />
          ) : tool.input !== undefined ? (
            <ToolInput input={tool.input} />
          ) : null}
          {terminalIds.length > 0 && hasTerminalOutput && (
            <div className="mt-2">
              <TerminalView terminalSnapshots={terminalSnapshots} />
            </div>
          )}
          <ToolOutput errorText={errorText} output={result} />
        </ToolContent>
      </Tool>
    );
  }
);
ToolMessagePart.displayName = "ToolMessagePart";
