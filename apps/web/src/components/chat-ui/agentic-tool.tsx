"use client";

import type { ToolUIPart } from "@repo/shared";
import { memo } from "react";
import {
  Tool,
  ToolContent,
  ToolHeader,
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
  <div className="space-y-2 p-4">
    <h4 className="font-medium text-muted-foreground text-xs">
      Changed Files
    </h4>
    {paths.length > 0 ? (
      <ul className="space-y-1">
        {paths.map((path) => (
          <li
            className="truncate rounded-none bg-muted/50 px-2 py-1 font-mono text-foreground text-xs"
            key={path}
            title={path}
          >
            {path}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-muted-foreground text-xs">File path unavailable.</p>
    )}
  </div>
);

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
        <ToolHeader state={viewState} title={tool.title} type={tool.type} />
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
