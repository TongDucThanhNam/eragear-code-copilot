import type { UIMessagePart } from "@eragear-code-copilot/shared";

export interface ChainSummary {
  activeIndex: number;
  reasoningCount: number;
  summary: string;
  textCount: number;
  toolCount: number;
}

export interface ChainOfThoughtProps {
  items: UIMessagePart[];
  isStreaming: boolean;
  messageId: string;
}
