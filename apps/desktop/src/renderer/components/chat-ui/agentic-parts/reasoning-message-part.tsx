// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type { ReasoningUIPart } from "@eragear-code-copilot/shared";
import { memo } from "react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";

const normalizeReasoningText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const wrapperMatch = trimmed.match(/^<([a-zA-Z][\w-]*)>([\s\S]*)<\/\1>$/);
  let normalized = wrapperMatch ? wrapperMatch[2].trim() : text;
  if (/<[a-zA-Z][^>]*>/.test(normalized)) {
    normalized = normalized.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  return normalized;
};

export interface ReasoningMessagePartProps {
  text: ReasoningUIPart["text"];
  state?: ReasoningUIPart["state"];
}

export const ReasoningMessagePart = memo(function ReasoningMessagePart({
  text,
  state,
}: ReasoningMessagePartProps) {
  const normalizedText = normalizeReasoningText(text);
  const displayText =
    normalizedText.trim().length > 0 || state === "streaming"
      ? normalizedText
      : "No reasoning details provided.";

  return (
    <Reasoning
      className="mb-0"
      defaultOpen={false}
      isStreaming={state === "streaming"}
    >
      <ReasoningTrigger />
      <ReasoningContent>{displayText}</ReasoningContent>
    </Reasoning>
  );
});
