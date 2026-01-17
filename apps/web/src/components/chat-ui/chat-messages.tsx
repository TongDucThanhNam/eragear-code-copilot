"use client";

import type { PermissionOption } from "@agentclientprotocol/sdk";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Plan,
  PlanContent,
  PlanHeader,
  PlanItem,
  type PlanStatus,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

export interface TextPart {
  type: "text";
  content: string;
}

export interface ToolPart {
  type: "tool";
  toolCallId: string;
  requestId?: string;
  name: string;
  description: string;
  status: "pending" | "running" | "completed" | "error" | "approval-requested";
  parameters: Record<string, unknown>;
  result: string | undefined;
  error: string | undefined;
  options?: unknown[];
  terminalId?: string;
  diffs?: { path: string; oldText?: string; newText: string }[];
}

export interface PlanPart {
  type: "plan";
  entries: { content: string; status: PlanStatus }[];
}

export type MessagePart = TextPart | ToolPart | PlanPart;

export interface MessageType {
  key: string;
  from: "user" | "assistant";
  sources?: { href: string; title: string }[];
  parts: MessagePart[];
  reasoning?: {
    content: string;
    duration: number;
  };
}

export interface ChatMessagesProps {
  messages: MessageType[];
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
  // onRetry? // If we want to support retry in the future without versions
}

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { FileDiffView } from "./file-diff-view";
import { TerminalView } from "./terminal-view";

export function ChatMessages({
  messages,
  terminalOutputs,
  onApprove,
  onReject,
}: ChatMessagesProps) {
  return (
    <Conversation className="min-h-0 flex-1 overflow-y-auto">
      <ConversationContent>
        {messages.map((message) => (
          <Message from={message.from} key={message.key}>
            <div>
              {message.reasoning && (
                <Reasoning>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    {message.reasoning.content}
                  </ReasoningContent>
                </Reasoning>
              )}
              <MessageContent>
                {message.parts.map((part, _index) => {
                  if (part.type === "text") {
                    return (
                      <MessageResponse key={part.content}>
                        {part.content}
                      </MessageResponse>
                    );
                  }

                  if (part.type === "plan") {
                    return (
                      <Plan
                        className="mb-4"
                        defaultOpen={true}
                        key={part.entries[0].content}
                      >
                        <PlanHeader>
                          <PlanTitle>Plan</PlanTitle>
                          <PlanTrigger />
                        </PlanHeader>
                        <PlanContent>
                          <div className="space-y-2 pt-2">
                            {part.entries.map((entry) => (
                              <PlanItem
                                key={entry.content}
                                status={entry.status}
                              >
                                {entry.content}
                              </PlanItem>
                            ))}
                          </div>
                        </PlanContent>
                      </Plan>
                    );
                  }

                  if (part.type === "tool") {
                    return (
                      <div className="mb-4 space-y-2" key={part.toolCallId}>
                        <Tool key={part.toolCallId}>
                          <ToolHeader
                            state={part.status}
                            title={part.name}
                            type="tool-call"
                          />
                          <ToolContent>
                            <ToolInput input={part.parameters} />
                            <Confirmation
                              approval={{ id: part.toolCallId }}
                              state={part.status}
                            >
                              <ConfirmationRequest>
                                <ConfirmationTitle>
                                  Requesting permission to execute
                                </ConfirmationTitle>
                                <ConfirmationActions>
                                  {/* Check if we have specific options */}
                                  {part.options && part.options.length > 0 ? (
                                    (part.options as PermissionOption[]).map(
                                      (opt) => (
                                        <ConfirmationAction
                                          key={opt.optionId}
                                          onClick={() => {
                                            // Heuristic mapping for frontend:
                                            const id = String(
                                              opt.optionId || ""
                                            ).toLowerCase();
                                            const isAllow =
                                              id === "allow" ||
                                              id === "yes" ||
                                              id === "allow_once";

                                            if (isAllow) {
                                              part.requestId &&
                                                onApprove?.(
                                                  part.requestId,
                                                  opt.optionId
                                                );
                                            } else {
                                              part.requestId &&
                                                onReject?.(
                                                  part.requestId,
                                                  opt.optionId
                                                );
                                            }
                                          }}
                                          variant={
                                            String(opt.optionId).includes(
                                              "allow"
                                            ) ||
                                            String(opt.optionId).includes("yes")
                                              ? "default"
                                              : "outline"
                                          }
                                        >
                                          {opt.name || "Option"}
                                        </ConfirmationAction>
                                      )
                                    )
                                  ) : (
                                    // Default fallback
                                    <>
                                      <ConfirmationAction
                                        onClick={() =>
                                          part.requestId &&
                                          onReject?.(part.requestId)
                                        }
                                        variant="outline"
                                      >
                                        Reject
                                      </ConfirmationAction>
                                      <ConfirmationAction
                                        onClick={() =>
                                          part.requestId &&
                                          onApprove?.(part.requestId)
                                        }
                                      >
                                        Allow
                                      </ConfirmationAction>
                                    </>
                                  )}
                                </ConfirmationActions>
                              </ConfirmationRequest>
                            </Confirmation>
                            {part.terminalId && terminalOutputs && (
                              <div className="mt-2">
                                <TerminalView
                                  output={
                                    terminalOutputs[part.terminalId] || ""
                                  }
                                />
                              </div>
                            )}
                            {part.diffs && part.diffs.length > 0 && (
                              <div className="mt-2 space-y-4">
                                {part.diffs.map((diff, _i) => (
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
                            <ToolOutput
                              errorText={part.error}
                              output={part.result}
                            />
                          </ToolContent>
                        </Tool>
                      </div>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </div>
          </Message>
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
