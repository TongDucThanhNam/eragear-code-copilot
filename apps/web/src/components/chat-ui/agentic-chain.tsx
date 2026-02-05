"use client";

import type { ToolUIPart, UIMessagePart } from "@repo/shared";
import {
  BrainIcon,
  ChevronDownIcon,
  CircleIcon,
  Loader2Icon,
  MessageSquareIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Loader } from "@/components/ai-elements/loader";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  getActiveIndex,
  getPartKey,
  parseToolOutput,
  toToolViewState,
} from "./agentic-message-utils";
import {
  FileMessagePart,
  getFileIcon,
  getSourceIcon,
  ReasoningMessagePart,
  SourceMessagePart,
  TextMessagePart,
} from "./agentic-parts";
import { ToolMessagePart } from "./agentic-tool";

const getChainIcon = (part: UIMessagePart, isActive: boolean) => {
  if (part.type.startsWith("tool-")) {
    const viewState = toToolViewState(part as ToolUIPart);
    const tone =
      viewState === "error"
        ? "text-destructive"
        : viewState === "completed"
          ? "text-emerald-500"
          : viewState === "approval-requested"
            ? "text-yellow-600"
            : "text-muted-foreground";

    if (viewState === "running" && isActive) {
      return <Loader2Icon className="size-3.5 animate-spin text-blue-500" />;
    }
    return <WrenchIcon className={cn("size-3.5", tone)} />;
  }

  if (part.type === "reasoning") {
    return <BrainIcon className="size-3.5 text-muted-foreground" />;
  }

  if (part.type === "text") {
    return <MessageSquareIcon className="size-3.5 text-muted-foreground" />;
  }

  if (part.type === "source-url" || part.type === "source-document") {
    const Icon = getSourceIcon(part);
    return <Icon className="size-3.5 text-muted-foreground" />;
  }

  if (part.type === "file") {
    const Icon = getFileIcon(part);
    return <Icon className="size-3.5 text-muted-foreground" />;
  }

  if (part.type === "step-start") {
    return <CircleIcon className="size-2.5 text-muted-foreground" />;
  }

  return <SparklesIcon className="size-3.5 text-muted-foreground" />;
};

const ChainStep = ({
  part,
  isLast,
  isActive,
  children,
}: {
  part: UIMessagePart;
  isLast: boolean;
  isActive: boolean;
  children: ReactNode;
}) => (
  <div className="flex gap-3">
    <div className="flex w-6 flex-col items-center">
      <div
        className={cn(
          "flex size-6 items-center justify-center rounded-full border bg-background",
          isActive && "border-primary/60 bg-primary/10"
        )}
      >
        {getChainIcon(part, isActive)}
      </div>
      {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
    </div>
    <div className={cn("min-w-0 flex-1", !isLast && "pb-3")}>{children}</div>
  </div>
);

const ChainContent = ({
  part,
  terminalOutputs,
}: {
  part: UIMessagePart;
  terminalOutputs?: Record<string, string>;
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
    const terminalOutput =
      parsedOutput.terminalId && terminalOutputs
        ? (terminalOutputs[parsedOutput.terminalId] ?? "")
        : undefined;
    return (
      <ToolMessagePart
        parsedOutput={parsedOutput}
        terminalOutput={terminalOutput}
        tool={toolPart}
      />
    );
  }

  return null;
};

export const ChainOfThought = ({
  items,
  isStreaming,
  terminalOutputs,
}: {
  items: UIMessagePart[];
  isStreaming: boolean;
  terminalOutputs?: Record<string, string>;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasStreamed, setHasStreamed] = useState(isStreaming);
  const [userToggled, setUserToggled] = useState(false);
  const prevStreamingRef = useRef(isStreaming);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndex = useMemo(() => getActiveIndex(items), [items]);
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

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const prevStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (isStreaming) {
      setHasStreamed(true);
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      if (!(userToggled || prevStreaming)) {
        setIsOpen(true);
      }
      return;
    }

    if (userToggled) {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      return;
    }

    if (!(hasStreamed && prevStreaming)) {
      return;
    }

    if (!collapseTimerRef.current) {
      collapseTimerRef.current = setTimeout(() => {
        setIsOpen(false);
        collapseTimerRef.current = null;
      }, 500);
    }
  }, [hasStreamed, isStreaming, userToggled]);

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
      className="w-full border bg-muted/30"
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        setUserToggled(true);
      }}
      open={isOpen}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm">
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
      <CollapsibleContent className="border-t px-3 py-3">
        <div className="space-y-3">
          {items.map((item, index) => (
            <ChainStep
              isActive={index === activeIndex}
              isLast={index === items.length - 1}
              key={getPartKey(item, index)}
              part={item}
            >
              <ChainContent part={item} terminalOutputs={terminalOutputs} />
            </ChainStep>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
