"use client";

import type { PermissionOption } from "@agentclientprotocol/sdk";
import {
  AudioLinesIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  LinkIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ToolUIPart, UIMessage, UIMessagePart } from "@repo/shared";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
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
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ChatMessagesProps {
  messages: UIMessage[];
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

// Memoize individual message parts to prevent unnecessary re-renders
const TextMessagePart = memo(({ text }: { text: string }) => (
  <MessageResponse>{text}</MessageResponse>
));
TextMessagePart.displayName = "TextMessagePart";

const ReasoningMessagePart = memo(({ text }: { text: string }) => (
  <Reasoning>
    <ReasoningTrigger />
    <ReasoningContent>{text}</ReasoningContent>
  </Reasoning>
));
ReasoningMessagePart.displayName = "ReasoningMessagePart";

const PlanMessagePart = memo(
  ({
    entries,
  }: {
    entries: Array<{ content: string; status: PlanStatus }>;
  }) => (
    <Plan className="mb-4" defaultOpen={true} key={entries[0]?.content}>
      <PlanHeader>
        <PlanTitle>Plan</PlanTitle>
        <PlanTrigger />
      </PlanHeader>
      <PlanContent>
        <div className="space-y-2 pt-2">
          {entries.map((entry) => (
            <PlanItem key={entry.content} status={entry.status}>
              {entry.content}
            </PlanItem>
          ))}
        </div>
      </PlanContent>
    </Plan>
  )
);
PlanMessagePart.displayName = "PlanMessagePart";

type SourcePart = Extract<
  UIMessagePart,
  { type: "source-url" | "source-document" }
>;

const getSourceIcon = (part: SourcePart) => {
  if (part.type === "source-url") {
    return LinkIcon;
  }
  return FileTextIcon;
};

const SourceMessagePart = memo(({ part }: { part: SourcePart }) => {
  const Icon = getSourceIcon(part);
  const label =
    part.type === "source-url"
      ? part.title ?? part.url
      : part.title ?? part.filename ?? part.sourceId;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs" variant="outline">
            <Icon className="size-3 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs break-words text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
SourceMessagePart.displayName = "SourceMessagePart";

type FilePart = Extract<UIMessagePart, { type: "file" }>;

const getFileIcon = (part: FilePart) => {
  if (part.mediaType?.startsWith("image/")) {
    return ImageIcon;
  }
  if (part.mediaType?.startsWith("audio/")) {
    return AudioLinesIcon;
  }
  return FileTextIcon;
};

const FileMessagePart = memo(({ part }: { part: FilePart }) => {
  const Icon = getFileIcon(part);
  const label = part.filename ?? part.mediaType ?? "File";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs" variant="outline">
            <Icon className="size-3 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs break-words text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
FileMessagePart.displayName = "FileMessagePart";

interface ToolMessagePartProps {
  tool: ToolUIPart;
  permission?: {
    requestId: string;
    options?: PermissionOption[] | { allowOther?: boolean; options?: PermissionOption[] };
  };
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
}

type ToolViewState =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "approval-requested";

const toToolViewState = (tool: ToolUIPart): ToolViewState => {
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
    default:
      return "pending";
  }
};

const parseToolOutput = (output: ToolUIPart["output"]) => {
  if (!Array.isArray(output)) {
    return { result: output, terminalId: undefined, diffs: [] as Array<{ path: string; oldText?: string; newText: string }> };
  }
  let terminalId: string | undefined;
  const diffs: Array<{ path: string; oldText?: string; newText: string }> = [];
  const textParts: string[] = [];
  for (const item of output) {
    if (item && typeof item === "object" && "type" in item) {
      const typed = item as { type: string; terminalId?: string; path?: string; oldText?: string; newText?: string; content?: { type?: string; text?: string } };
      if (typed.type === "terminal" && typed.terminalId) {
        terminalId = typed.terminalId;
      }
      if (typed.type === "diff" && typed.path && typed.newText) {
        diffs.push({ path: typed.path, oldText: typed.oldText, newText: typed.newText });
      }
      if (typed.type === "content" && typed.content?.type === "text" && typed.content.text) {
        textParts.push(typed.content.text);
      }
    }
  }
  const result = textParts.length > 0 ? textParts.join("\n") : output;
  return { result, terminalId, diffs };
};

const ToolMessagePart = memo(
  ({ tool, permission, terminalOutputs, onApprove, onReject }: ToolMessagePartProps) => {
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
      : permissionOptions?.options ?? [];

    return (
      <div className="mb-4 space-y-2" key={tool.toolCallId}>
        <Tool key={tool.toolCallId}>
          <ToolHeader state={viewState} title={tool.title} type={tool.type} />
          <ToolContent>
            <ToolInput input={tool.input ?? {}} />
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
                              id === "allow" || id === "yes" || id === "allow_once";

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
                            permission?.requestId && onReject?.(permission.requestId)
                          }
                          variant="outline"
                        >
                          Reject
                        </ConfirmationAction>
                        <ConfirmationAction
                          onClick={() =>
                            permission?.requestId && onApprove?.(permission.requestId)
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
      </div>
    );
  }
);
ToolMessagePart.displayName = "ToolMessagePart";

const buildMessageCopyText = (message: UIMessage) => {
  const textParts = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean);

  return textParts.join("\n\n");
};

const CopyMessageAction = memo(({ text }: { text: string }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) {
      return;
    }

    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      toast.error("Clipboard API not available");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      toast.success("Copied message");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy message");
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <MessageAction
      aria-label="Copy message"
      disabled={!text}
      label="Copy message"
      onClick={handleCopy}
      tooltip={isCopied ? "Copied" : "Copy"}
    >
      <Icon className="size-3.5" />
    </MessageAction>
  );
});
CopyMessageAction.displayName = "CopyMessageAction";

export function ChatMessages({
  messages,
  terminalOutputs,
  onApprove,
  onReject,
}: ChatMessagesProps) {
  // Memoize messages to prevent unnecessary re-renders
  const memoizedMessages = useMemo(() => messages, [messages]);

  return (
    <Conversation className="min-h-0 flex-1 overflow-y-hidden">
      <ConversationContent>
        {memoizedMessages.map((message) => {
          const permissionByToolCallId = new Map<
            string,
            { requestId: string; options?: PermissionOption[] | { allowOther?: boolean; options?: PermissionOption[] } }
          >();
          for (const part of message.parts) {
            if (part.type === "data-permission-options") {
              const data = part.data as
                | {
                    requestId?: string;
                    toolCallId?: string;
                    options?: PermissionOption[] | { allowOther?: boolean; options?: PermissionOption[] };
                  }
                | undefined;
              if (data?.requestId && data.toolCallId) {
                permissionByToolCallId.set(data.toolCallId, {
                  requestId: data.requestId,
                  options: data.options,
                });
              }
            }
          }
          return (
            <Message from={message.role} key={message.id}>
            <div>
              <MessageContent>
                {message.parts.map((part, _index) => {
                  if (part.type === "text") {
                    return (
                      <TextMessagePart
                        text={part.text}
                        key={`text-${part.text.slice(0, 10)}-${_index}`}
                      />
                    );
                  }

                  if (part.type === "reasoning") {
                    return (
                      <ReasoningMessagePart
                        key={`reasoning-${part.text.slice(0, 10)}-${_index}`}
                        text={part.text}
                      />
                    );
                  }

                  if (part.type === "source-url" || part.type === "source-document") {
                    return (
                      <SourceMessagePart
                        key={`source-${part.sourceId}-${_index}`}
                        part={part}
                      />
                    );
                  }

                  if (part.type === "file") {
                    return (
                      <FileMessagePart
                        key={`file-${part.url}-${_index}`}
                        part={part}
                      />
                    );
                  }

                  if (part.type === "step-start") {
                    return (
                      <div
                        className="my-2 text-xs text-muted-foreground"
                        key={`step-${_index}`}
                      >
                        Step
                      </div>
                    );
                  }

                  if (part.type.startsWith("data-")) {
                    return null;
                  }

                  if (part.type.startsWith("tool-")) {
                    const toolPart = part as ToolUIPart;
                    const permission = permissionByToolCallId.get(
                      toolPart.toolCallId
                    );
                    if (
                      toolPart.type === "tool-plan" &&
                      toolPart.output &&
                      typeof toolPart.output === "object" &&
                      "entries" in toolPart.output
                    ) {
                      const entries = (toolPart.output as { entries: Array<{ content: string; status: PlanStatus }> }).entries;
                      return (
                        <PlanMessagePart
                          entries={entries}
                          key={`plan-${entries[0]?.content.slice(0, 10)}-${_index}`}
                        />
                      );
                    }
                    return (
                      <ToolMessagePart
                        key={`tool-${toolPart.toolCallId}-${_index}`}
                        onApprove={onApprove}
                        onReject={onReject}
                        terminalOutputs={terminalOutputs}
                        tool={toolPart}
                        permission={permission}
                      />
                    );
                  }
                  return null;
                })}
              </MessageContent>
              <div className="mt-2 flex justify-end opacity-0 transition group-hover:opacity-100">
                <MessageActions>
                  <CopyMessageAction text={buildMessageCopyText(message)} />
                </MessageActions>
              </div>
            </div>
          </Message>
          );
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
