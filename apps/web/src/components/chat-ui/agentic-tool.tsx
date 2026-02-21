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
import {
  type ParsedToolOutput,
  toToolViewState,
} from "./agentic-message-utils";
import { FileDiffView } from "./file-diff-view";
import { TerminalView } from "./terminal-view";

interface ToolMessagePartProps {
  tool: ToolUIPart;
  parsedOutput: ParsedToolOutput;
  terminalOutput?: string;
}

export const ToolMessagePart = memo(
  ({ tool, parsedOutput, terminalOutput }: ToolMessagePartProps) => {
    const viewState = toToolViewState(tool);
    const { result, terminalId, diffs } = parsedOutput;
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
          {tool.input !== undefined ? <ToolInput input={tool.input} /> : null}
          {terminalId && terminalOutput !== undefined && (
            <div className="mt-2">
              <TerminalView output={terminalOutput} />
            </div>
          )}
          {diffs.length > 0 && (
            <div className="mt-2 space-y-4">
              {diffs.map((diff) => (
                <div className="space-y-1" key={diff.path}>
                  <FileDiffView
                    filename={diff.path}
                    modified={diff.newText}
                    original={diff.oldText}
                  />
                </div>
              ))}
            </div>
          )}
          <ToolOutput errorText={errorText} output={result} />
        </ToolContent>
      </Tool>
    );
  }
);
ToolMessagePart.displayName = "ToolMessagePart";
