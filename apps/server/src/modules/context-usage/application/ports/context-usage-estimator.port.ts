import type {
  ContextUsageBreakdown,
  ContextUsageSource,
  ContextUsageTokenSource,
} from "../contracts/context-usage.contract";

export interface ContextUsageMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface ContextUsageTokenEstimateInput {
  messages: ContextUsageMessageInput[];
  draftText: string;
  attachmentCount: number;
  attachmentBytes: number;
  mentionCount: number;
}

export interface ContextUsageTokenEstimate {
  totalTokens: number;
  source: ContextUsageTokenSource;
  breakdown: ContextUsageBreakdown;
}

export interface ContextUsageWindowInput {
  modelId?: string;
  modelProvider?: string;
}

export interface ContextUsageWindow {
  maxTokens: number;
  source: ContextUsageSource;
}

export interface ContextUsageEstimatorPort {
  estimateTokens(
    input: ContextUsageTokenEstimateInput
  ): ContextUsageTokenEstimate;
  resolveContextWindow(input: ContextUsageWindowInput): ContextUsageWindow;
}
