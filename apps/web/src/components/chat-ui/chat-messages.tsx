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
import {
  ContentBlocksView,
  type StoredContentBlock,
} from "@/components/chat-ui/content-blocks";

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

export interface ContextItem {
  id: string;
  title: string;
  subtitle?: string;
  kind: "resource" | "resource_link" | "image" | "audio";
  uri?: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface ContextPart {
  type: "context";
  items: ContextItem[];
}

export interface ContentBlockPart {
  type: "content_block";
  blocks: StoredContentBlock[];
}

export type MessagePart =
  | TextPart
  | ToolPart
  | PlanPart
  | ContextPart
  | ContentBlockPart;

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

// Memoize individual message parts to prevent unnecessary re-renders
const TextMessagePart = memo(({ content }: { content: string }) => (
  <MessageResponse>{content}</MessageResponse>
));
TextMessagePart.displayName = "TextMessagePart";

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

const getContextIcon = (kind: ContextItem["kind"]) => {
  switch (kind) {
    case "image":
      return ImageIcon;
    case "audio":
      return AudioLinesIcon;
    case "resource_link":
      return LinkIcon;
    default:
      return FileTextIcon;
  }
};

const ContextMessagePart = memo(({ items }: { items: ContextItem[] }) => (
  <div className="flex flex-wrap gap-2">
    {items.map((item) => {
      const Icon = getContextIcon(item.kind);
      const label = item.subtitle ? `${item.title} • ${item.subtitle}` : item.title;
      return (
        <TooltipProvider key={item.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-xs" variant="outline">
                <Icon className="size-3 text-muted-foreground" />
                <span className="truncate">@{item.title}</span>
                {item.subtitle && (
                  <span className="truncate text-muted-foreground">
                    {item.subtitle}
                  </span>
                )}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs break-words text-xs">{label}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    })}
  </div>
));
ContextMessagePart.displayName = "ContextMessagePart";

const ContentBlocksMessagePart = memo(
  ({ blocks }: { blocks: StoredContentBlock[] }) => (
    <ContentBlocksView blocks={blocks} />
  )
);
ContentBlocksMessagePart.displayName = "ContentBlocksMessagePart";

interface ToolMessagePartProps {
  tool: ToolPart;
  terminalOutputs?: Record<string, string>;
  onApprove?: (requestId: string, decision?: string) => void;
  onReject?: (requestId: string, decision?: string) => void;
}

const ToolMessagePart = memo(
  ({ tool, terminalOutputs, onApprove, onReject }: ToolMessagePartProps) => (
    <div className="mb-4 space-y-2" key={tool.toolCallId}>
      <Tool key={tool.toolCallId}>
        <ToolHeader state={tool.status} title={tool.name} type="tool-call" />
        <ToolContent>
          <ToolInput input={tool.parameters} />
          <Confirmation approval={{ id: tool.toolCallId }} state={tool.status}>
            <ConfirmationRequest>
              <ConfirmationTitle>
                Requesting permission to execute
              </ConfirmationTitle>
              <ConfirmationActions>
                {/* Check if we have specific options */}
                {tool.options && tool.options.length > 0 ? (
                  (tool.options as PermissionOption[]).map((opt) => (
                    <ConfirmationAction
                      key={opt.optionId}
                      onClick={() => {
                        // Heuristic mapping for frontend:
                        const id = String(opt.optionId || "").toLowerCase();
                        const isAllow =
                          id === "allow" || id === "yes" || id === "allow_once";

                        if (isAllow) {
                          tool.requestId &&
                            onApprove?.(tool.requestId, opt.optionId);
                        } else {
                          tool.requestId &&
                            onReject?.(tool.requestId, opt.optionId);
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
                  // Default fallback
                  <>
                    <ConfirmationAction
                      onClick={() =>
                        tool.requestId && onReject?.(tool.requestId)
                      }
                      variant="outline"
                    >
                      Reject
                    </ConfirmationAction>
                    <ConfirmationAction
                      onClick={() =>
                        tool.requestId && onApprove?.(tool.requestId)
                      }
                    >
                      Allow
                    </ConfirmationAction>
                  </>
                )}
              </ConfirmationActions>
            </ConfirmationRequest>
          </Confirmation>
          {tool.terminalId && terminalOutputs && (
            <div className="mt-2">
              <TerminalView output={terminalOutputs[tool.terminalId] || ""} />
            </div>
          )}
          {tool.diffs && tool.diffs.length > 0 && (
            <div className="mt-2 space-y-4">
              {tool.diffs.map((diff, _i) => (
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
          <ToolOutput errorText={tool.error} output={tool.result} />
        </ToolContent>
      </Tool>
    </div>
  )
);
ToolMessagePart.displayName = "ToolMessagePart";

const buildMessageCopyText = (message: MessageType) => {
  const textParts = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.content.trim())
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
        {memoizedMessages.map((message) => (
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
                      <TextMessagePart
                        content={part.content}
                        key={`text-${part.content.slice(0, 10)}-${_index}`}
                      />
                    );
                  }

                  if (part.type === "context") {
                    return (
                      <ContextMessagePart
                        items={part.items}
                        key={`context-${part.items[0]?.id ?? _index}`}
                      />
                    );
                  }

                  if (part.type === "content_block") {
                    return (
                      <ContentBlocksMessagePart
                        blocks={part.blocks}
                        key={`content-block-${part.blocks[0]?.type ?? _index}`}
                      />
                    );
                  }

                  if (part.type === "plan") {
                    return (
                      <PlanMessagePart
                        entries={part.entries}
                        key={`plan-${part.entries[0]?.content.slice(0, 10)}-${_index}`}
                      />
                    );
                  }

                  if (part.type === "tool") {
                    return (
                      <ToolMessagePart
                        key={`tool-${part.toolCallId}-${_index}`}
                        onApprove={onApprove}
                        onReject={onReject}
                        terminalOutputs={terminalOutputs}
                        tool={part}
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
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
