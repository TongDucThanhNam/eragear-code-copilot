// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { ToolUIPart, UIMessagePart } from "@eragear-code-copilot/shared";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Loader } from "@/components/ai-elements/loader";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  getActiveIndex,
  groupChainDisplayItems,
  parseToolOutput,
  toToolViewState,
} from "./agentic-message-utils";
import { FileMessagePart } from "./agentic-parts/file-message-part";
import { ReasoningMessagePart } from "./agentic-parts/reasoning-message-part";
import { SourceMessagePart } from "./agentic-parts/source-message-part";
import { TextMessagePart } from "./agentic-parts/text-message-part";
import { ToolMessagePart } from "./agentic-tool";

const getToolGroupStates = (tools: ToolUIPart[]) =>
  tools.map((tool) => toToolViewState(tool));

const isActiveToolState = (state: ReturnType<typeof toToolViewState>) =>
  state === "pending" || state === "running" || state === "approval-requested";

const getToolGroupSummary = ({
  isActive,
  tools,
}: {
  isActive: boolean;
  tools: ToolUIPart[];
}) => {
  const count = tools.length;
  const hasActiveTool = getToolGroupStates(tools).some((state) =>
    isActiveToolState(state)
  );
  return {
    action: isActive && hasActiveTool ? "Running" : "Ran",
    target: `${count} Tool Call${count === 1 ? "" : "s"}`,
  };
};

const renderChainStep = ({
  itemKey,
  isLast,
  children,
}: {
  itemKey: string;
  isLast: boolean;
  children: ReactNode;
}) => (
  <div className={cn("min-w-0", !isLast && "pb-3")} key={itemKey}>
    {children}
  </div>
);

const renderChainContent = ({
  chatId,
  part,
}: {
  chatId: string | null;
  part: UIMessagePart;
}) => {
  if (part.type === "text") {
    return <TextMessagePart text={part.text} variant="chain" />;
  }

  if (part.type === "reasoning") {
    return <ReasoningMessagePart state={part.state} text={part.text} />;
  }

  if (part.type === "source-url" || part.type === "source-document") {
    return <SourceMessagePart part={part} />;
  }

  if (part.type === "file") {
    return <FileMessagePart part={part} />;
  }

  if (part.type === "step-start") {
    return <div className="text-muted-foreground text-xs">Step</div>;
  }

  if (part.type.startsWith("tool-")) {
    const toolPart = part as ToolUIPart;
    const parsedOutput = parseToolOutput(toolPart.output);
    return (
      <ToolMessagePart
        chatId={chatId}
        parsedOutput={parsedOutput}
        tool={toolPart}
      />
    );
  }

  return null;
};

const ToolGroupPart = ({
  chatId,
  isActive,
  tools,
}: {
  chatId: string | null;
  isActive: boolean;
  tools: ToolUIPart[];
}) => {
  const summary = getToolGroupSummary({ isActive, tools });

  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger
        aria-label={`Expand ${summary.target}`}
        className="group/tool-group inline-flex max-w-full cursor-pointer items-center gap-2 self-start text-left text-[13px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`${summary.action} ${summary.target}`}
        type="button"
      >
        <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 whitespace-nowrap font-medium text-muted-foreground">
          {summary.action}
        </span>
        <span className="min-w-0 truncate text-foreground">
          {summary.target}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 rotate-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover/tool-group:opacity-100 group-data-[state=open]/tool-group:rotate-90 group-data-[state=open]/tool-group:opacity-100" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden pt-2 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2">
        <div className="space-y-1.5">
          {tools.map((tool, index) => (
            <ToolMessagePart
              chatId={chatId}
              key={`${tool.toolCallId}:${index}`}
              parsedOutput={parseToolOutput(tool.output)}
              tool={tool}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ChainOfThought = ({
  chatId,
  items,
  isStreaming,
}: {
  chatId: string | null;
  items: UIMessagePart[];
  isStreaming: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const activeIndex = useMemo(() => getActiveIndex(items), [items]);
  const displayItems = useMemo(() => groupChainDisplayItems(items), [items]);
  const toolCount = useMemo(
    () => items.filter((item) => item.type.startsWith("tool-")).length,
    [items]
  );
  const reasoningCount = useMemo(
    () => items.filter((item) => item.type === "reasoning").length,
    [items]
  );
  const textCount = useMemo(
    () => items.filter((item) => item.type === "text").length,
    [items]
  );

  if (items.length === 0) {
    return null;
  }

  const summaryParts = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
    reasoningCount
      ? `${reasoningCount} thought${reasoningCount === 1 ? "" : "s"}`
      : null,
    textCount ? `${textCount} note${textCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(" | ")
      : `${items.length} step${items.length === 1 ? "" : "s"}`;

  return (
    <Collapsible
      className="relative w-full"
      onOpenChange={setIsOpen}
      open={isOpen}
    >
      <CollapsibleTrigger className="sticky top-0 z-10 flex w-full items-center justify-between gap-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader className="text-muted-foreground" size={14} />
          ) : (
            <SparklesIcon className="size-4 text-muted-foreground" />
          )}
          <span className="font-medium">Chain of Thought</span>
          <span className="text-muted-foreground text-xs">{summary}</span>
        </div>
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isOpen ? "rotate-180" : "rotate-0"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="py-3">
        <div className="space-y-3">
          {displayItems.map((item, index) => {
            if (item.kind === "tool-group") {
              const isActive =
                activeIndex >= item.originalStartIndex &&
                activeIndex <= item.originalEndIndex;
              return renderChainStep({
                itemKey: item.itemKey,
                isLast: index === displayItems.length - 1,
                children: (
                  <ToolGroupPart
                    chatId={chatId}
                    isActive={isActive}
                    tools={item.tools}
                  />
                ),
              });
            }

            if (!item.part) {
              return null;
            }

            return renderChainStep({
              itemKey: item.itemKey,
              isLast: index === displayItems.length - 1,
              children: renderChainContent({
                chatId,
                part: item.part,
              }),
            });
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
