"use client";

import type { ToolUIPart, UIMessage } from "@repo/shared";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import { cn } from "@/lib/utils";

type PlanStatus = "pending" | "in_progress" | "completed" | "failed";

interface PlanEntry {
  content: string;
  status: PlanStatus;
}

interface PlanSnapshot {
  entries: PlanEntry[];
  toolCallId: string;
}

const isPlanOutput = (
  output: ToolUIPart["output"]
): output is { entries: PlanEntry[] } => {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  const entries = (output as { entries?: unknown }).entries;
  return Array.isArray(entries);
};

const getLatestPlanSnapshot = (messages: UIMessage[]): PlanSnapshot | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j];
      if (part.type !== "tool-plan") {
        continue;
      }
      const toolPart = part as ToolUIPart;
      if (!isPlanOutput(toolPart.output)) {
        continue;
      }
      return {
        entries: toolPart.output.entries,
        toolCallId: toolPart.toolCallId,
      };
    }
  }
  return null;
};

const getPlanSummary = (entries: PlanEntry[]) => {
  const total = entries.length;
  const completed = entries.filter(
    (entry) => entry.status === "completed"
  ).length;
  const inProgress = entries.filter(
    (entry) => entry.status === "in_progress"
  ).length;
  const failed = entries.filter((entry) => entry.status === "failed").length;

  const parts = [];
  if (total > 0) {
    parts.push(`${completed}/${total} done`);
  }
  if (inProgress > 0) {
    parts.push(`${inProgress} in progress`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  return parts.join(" · ");
};

const PlanHeaderContent = memo(
  ({
    total,
    summary,
    isStreaming,
  }: {
    total: number;
    summary: string;
    isStreaming: boolean;
  }) => (
    <div className="flex w-full items-center justify-between gap-3">
      <QueueSectionLabel
        className={cn(isStreaming && "animate-pulse")}
        count={total}
        label="steps"
      />
      {summary ? (
        <span
          className={cn(
            "text-muted-foreground text-xs",
            isStreaming && "animate-pulse"
          )}
        >
          {summary}
        </span>
      ) : null}
    </div>
  )
);
PlanHeaderContent.displayName = "PlanHeaderContent";

const PlanEntries = memo(({ entries }: { entries: PlanEntry[] }) => (
  <QueueList>
    {entries.map((entry, index) => {
      const isCompleted = entry.status === "completed";
      const isInProgress = entry.status === "in_progress";
      const isFailed = entry.status === "failed";
      return (
        <QueueItem key={`${entry.content}-${index}`}>
          <div className="flex items-start gap-2">
            <QueueItemIndicator
              className={cn(
                isInProgress &&
                  "animate-pulse border-blue-500/70 bg-blue-500/20",
                isFailed && "border-red-500/70 bg-red-500/20"
              )}
              completed={isCompleted}
            />
            <QueueItemContent
              className={cn(
                "line-clamp-none",
                isInProgress && "text-foreground",
                isFailed && "text-red-500"
              )}
              completed={isCompleted}
            >
              {entry.content}
            </QueueItemContent>
          </div>
        </QueueItem>
      );
    })}
  </QueueList>
));
PlanEntries.displayName = "PlanEntries";

export interface ChatPlanDockProps {
  messages: UIMessage[];
}

const ChatPlanDockBase = ({ messages }: ChatPlanDockProps) => {
  const planSnapshot = useMemo(
    () => getLatestPlanSnapshot(messages),
    [messages]
  );
  const [isOpen, setIsOpen] = useState(true);
  const lastPlanIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!planSnapshot) {
      return;
    }
    if (planSnapshot.toolCallId !== lastPlanIdRef.current) {
      lastPlanIdRef.current = planSnapshot.toolCallId;
      setIsOpen(true);
    }
  }, [planSnapshot?.toolCallId]);

  const summary = useMemo(() => {
    if (!planSnapshot?.entries.length) {
      return "";
    }
    return getPlanSummary(planSnapshot.entries);
  }, [planSnapshot?.entries]);
  const isStreaming = useMemo(() => {
    if (!planSnapshot?.entries.length) {
      return false;
    }
    return planSnapshot.entries.some((entry) => entry.status === "in_progress");
  }, [planSnapshot?.entries]);

  if (!planSnapshot || planSnapshot.entries.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 px-2">
      <Queue className={cn("bg-background/90")}>
        <QueueSection onOpenChange={setIsOpen} open={isOpen}>
          <QueueSectionTrigger>
            <PlanHeaderContent
              isStreaming={isStreaming}
              summary={summary}
              total={planSnapshot.entries.length}
            />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <PlanEntries entries={planSnapshot.entries} />
          </QueueSectionContent>
        </QueueSection>
      </Queue>
    </div>
  );
};

export const ChatPlanDock = memo(ChatPlanDockBase);
ChatPlanDock.displayName = "ChatPlanDock";
