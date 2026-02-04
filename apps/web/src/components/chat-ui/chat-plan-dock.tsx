"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ToolUIPart, UIMessage } from "@repo/shared";
import type { PlanStatus } from "@/components/ai-elements/plan";
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanItem,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import { cn } from "@/lib/utils";

type PlanEntry = {
  content: string;
  status: PlanStatus;
};

type PlanSnapshot = {
  entries: PlanEntry[];
  toolCallId: string;
};

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
  const completed = entries.filter((entry) => entry.status === "completed")
    .length;
  const inProgress = entries.filter((entry) => entry.status === "in_progress")
    .length;
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

const PlanHeaderContent = memo(({ summary }: { summary: string }) => (
  <div className="min-w-0">
    <PlanTitle className="text-sm">Plan</PlanTitle>
    {summary ? (
      <PlanDescription className="text-xs">{summary}</PlanDescription>
    ) : null}
  </div>
));
PlanHeaderContent.displayName = "PlanHeaderContent";

const PlanEntries = memo(({ entries }: { entries: PlanEntry[] }) => (
  <div className="space-y-2 pt-1">
    {entries.map((entry, index) => (
      <PlanItem key={`${entry.content}-${index}`} status={entry.status}>
        {entry.content}
      </PlanItem>
    ))}
  </div>
));
PlanEntries.displayName = "PlanEntries";

export interface ChatPlanDockProps {
  messages: UIMessage[];
}

const ChatPlanDockBase = ({ messages }: ChatPlanDockProps) => {
  const planSnapshot = useMemo(() => getLatestPlanSnapshot(messages), [messages]);
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
    <div className="px-2 pb-2">
      <Plan
        className={cn(
          "border border-border/80 bg-background/90 shadow-sm backdrop-blur"
        )}
        isStreaming={isStreaming}
        onOpenChange={setIsOpen}
        open={isOpen}
      >
        <PlanHeader className="gap-3 px-4 py-3">
          <PlanHeaderContent summary={summary} />
          <PlanTrigger />
        </PlanHeader>
        <PlanContent className="px-4 pb-4">
          <PlanEntries entries={planSnapshot.entries} />
        </PlanContent>
      </Plan>
    </div>
  );
};

export const ChatPlanDock = memo(ChatPlanDockBase);
ChatPlanDock.displayName = "ChatPlanDock";
