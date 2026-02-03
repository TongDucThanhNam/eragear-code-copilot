"use client";

import type { ToolUIPart } from "@repo/shared";
import { memo } from "react";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { FileDiffView } from "./file-diff-view";
import { TerminalView } from "./terminal-view";
import {
  type PermissionEntry,
  toToolViewState,
} from "./agentic-message-utils";

interface ToolMessagePartProps {
  tool: ToolUIPart;
  permission?: PermissionEntry;
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
}

const parseToolOutput = (output: ToolUIPart["output"]) => {
  if (!Array.isArray(output)) {
    return {
      result: output,
      terminalId: undefined,
      diffs: [] as Array<{ path: string; oldText?: string; newText: string }>,
    };
  }
  let terminalId: string | undefined;
  const diffs: Array<{ path: string; oldText?: string; newText: string }> = [];
  const textParts: string[] = [];
  for (const item of output) {
    if (item && typeof item === "object" && "type" in item) {
      const typed = item as {
        type: string;
        terminalId?: string;
        path?: string;
        oldText?: string;
        newText?: string;
        content?: { type?: string; text?: string };
      };
      if (typed.type === "terminal" && typed.terminalId) {
        terminalId = typed.terminalId;
      }
      if (typed.type === "diff" && typed.path && typed.newText) {
        diffs.push({
          path: typed.path,
          oldText: typed.oldText,
          newText: typed.newText,
        });
      }
      if (
        typed.type === "content" &&
        typed.content?.type === "text" &&
        typed.content.text
      ) {
        textParts.push(typed.content.text);
      }
    }
  }
  const result = textParts.length > 0 ? textParts.join("\n") : output;
  return { result, terminalId, diffs };
};

export const ToolMessagePart = memo(
  ({
    tool,
    permission,
    terminalOutputs,
    onApprove,
    onReject,
  }: ToolMessagePartProps) => {
    const viewState = toToolViewState(tool);
    const { result, terminalId, diffs } = parseToolOutput(tool.output);
    const errorText =
      tool.state === "output-error"
        ? tool.errorText
        : tool.state === "output-denied"
          ? "Denied"
          : undefined;
    const permissionOptions = permission?.options;
    const optionsList = Array.isArray(permissionOptions)
      ? permissionOptions
      : (permissionOptions?.options ?? []);

    return (
      <Tool
        className="mb-0"
        defaultOpen={viewState === "approval-requested" || viewState === "running"}
      >
        <ToolHeader state={viewState} title={tool.title} type={tool.type} />
        <ToolContent>
          {tool.input !== undefined ? <ToolInput input={tool.input} /> : null}
          <Confirmation approval={{ id: tool.toolCallId }} state={viewState}>
            <ConfirmationRequest>
              <ConfirmationTitle>
                Requesting permission to execute
              </ConfirmationTitle>
              <ConfirmationActions>
                {viewState === "approval-requested" ? (
                  optionsList.length > 0 ? (
                    optionsList.map((opt) => (
                      <ConfirmationAction
                        key={opt.optionId}
                        onClick={() => {
                          const id = String(opt.optionId || "").toLowerCase();
                          const isAllow =
                            id === "allow" ||
                            id === "yes" ||
                            id === "allow_once";

                          if (isAllow) {
                            permission?.requestId &&
                              onApprove?.(permission.requestId, opt.optionId);
                          } else {
                            permission?.requestId &&
                              onReject?.(permission.requestId, opt.optionId);
                          }
                        }}
                        variant={
                          String(opt.optionId).includes("allow") ||
                          String(opt.optionId).includes("yes")
                            ? "default"
                            : "outline"
                        }
                      >
                        {opt.name || "Option"}
                      </ConfirmationAction>
                    ))
                  ) : (
                    <>
                      <ConfirmationAction
                        onClick={() =>
                          permission?.requestId &&
                          onReject?.(permission.requestId)
                        }
                        variant="outline"
                      >
                        Reject
                      </ConfirmationAction>
                      <ConfirmationAction
                        onClick={() =>
                          permission?.requestId &&
                          onApprove?.(permission.requestId)
                        }
                      >
                        Allow
                      </ConfirmationAction>
                    </>
                  )
                ) : null}
              </ConfirmationActions>
            </ConfirmationRequest>
          </Confirmation>
          {terminalId && terminalOutputs && (
            <div className="mt-2">
              <TerminalView output={terminalOutputs[terminalId] || ""} />
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
