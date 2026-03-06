import type { ToolUIPart } from "@repo/shared";
import { useMemo } from "react";
import {
  ChatPlanDock,
  type PlanEntry,
  type PlanSnapshot,
} from "@/components/chat-ui/chat-plan-dock";
import { useChatStreamStore } from "@/store/chat-stream-store";

interface ChatPlanDockPaneProps {
  chatId: string | null;
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

export function ChatPlanDockPane({ chatId }: ChatPlanDockPaneProps) {
  const latestPlanPart = useChatStreamStore((state) => {
    if (!chatId) {
      return null;
    }
    const messages = state.byChatId[chatId]?.messageState.orderedMessages;
    if (!messages) {
      return null;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      for (let j = message.parts.length - 1; j >= 0; j -= 1) {
        const part = message.parts[j];
        if (part.type === "tool-plan") {
          return part as ToolUIPart;
        }
      }
    }
    return null;
  });

  const planSnapshot = useMemo<PlanSnapshot | null>(() => {
    if (!latestPlanPart || !isPlanOutput(latestPlanPart.output)) {
      return null;
    }
    return {
      entries: latestPlanPart.output.entries,
      toolCallId: latestPlanPart.toolCallId,
    };
  }, [latestPlanPart]);

  return <ChatPlanDock planSnapshot={planSnapshot} />;
}
