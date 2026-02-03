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
  type ParsedToolOutput,
  type PermissionEntry,
  toToolViewState,
} from "./agentic-message-utils";

interface ToolMessagePartProps {
  tool: ToolUIPart;
  permission?: PermissionEntry;
  parsedOutput: ParsedToolOutput;
  terminalOutput?: string;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
}

export const ToolMessagePart = memo(
  ({
    tool,
    permission,
    parsedOutput,
    terminalOutput,
    onApprove,
    onReject,
  }: ToolMessagePartProps) => {
    const viewState = toToolViewState(tool);
    const { result, terminalId, diffs } = parsedOutput;
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
