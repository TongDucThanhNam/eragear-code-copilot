import { getContextWindow } from "tokenlens";
import type {
  ContextUsageEstimatorPort,
  ContextUsageTokenEstimateInput,
  ContextUsageWindowInput,
} from "../application/ports/context-usage-estimator.port";

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const MESSAGE_OVERHEAD_TOKENS = 4;
const ATTACHMENT_OVERHEAD_TOKENS = 12;
const ATTACHMENT_BYTES_PER_TOKEN = 3072;
const MENTION_OVERHEAD_TOKENS = 12;
const ASCII_WORD_REGEX = /[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g;
const CJK_CHAR_REGEX =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const SYMBOL_REGEX =
  /[^\sA-Za-z0-9_\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;

export class LocalContextUsageEstimatorAdapter
  implements ContextUsageEstimatorPort
{
  estimateTokens(input: ContextUsageTokenEstimateInput) {
    const historyTokens = input.messages.reduce(
      (sum, message) =>
        sum + estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS,
      0
    );
    const draftTokens = estimateTextTokens(input.draftText);
    const attachmentTokens =
      input.attachmentCount * ATTACHMENT_OVERHEAD_TOKENS +
      Math.ceil(input.attachmentBytes / ATTACHMENT_BYTES_PER_TOKEN);
    const mentionTokens = input.mentionCount * MENTION_OVERHEAD_TOKENS;
    return {
      totalTokens:
        historyTokens + draftTokens + attachmentTokens + mentionTokens,
      source: "local-estimate" as const,
      breakdown: {
        historyTokens,
        draftTokens,
        attachmentTokens,
        mentionTokens,
      },
    };
  }

  resolveContextWindow(input: ContextUsageWindowInput) {
    const candidates = buildModelCandidates(input);
    for (const candidate of candidates) {
      const window = getContextWindow(candidate);
      const maxTokens = pickWindowMaxTokens(window);
      if (maxTokens) {
        return {
          maxTokens,
          source: "tokenlens" as const,
        };
      }
    }

    return {
      maxTokens: fallbackContextWindow(input.modelId),
      source: "fallback" as const,
    };
  }
}

export function estimateTextTokens(value: string): number {
  const text = value.trim();
  if (!text) {
    return 0;
  }

  const bytesEstimate = Math.ceil(Buffer.byteLength(text, "utf8") / 4);
  const wordCount = text.match(ASCII_WORD_REGEX)?.length ?? 0;
  const cjkCount = text.match(CJK_CHAR_REGEX)?.length ?? 0;
  const symbolCount = text.match(SYMBOL_REGEX)?.length ?? 0;
  const lexicalEstimate = wordCount + cjkCount + Math.ceil(symbolCount / 2);
  return Math.max(1, bytesEstimate, lexicalEstimate);
}

function buildModelCandidates(input: ContextUsageWindowInput): string[] {
  const candidates = new Set<string>();
  const modelId = input.modelId?.trim();
  const provider = input.modelProvider?.trim();
  if (modelId && provider) {
    candidates.add(`${provider}:${modelId}`);
    candidates.add(`${provider}/${modelId}`);
  }
  if (modelId) {
    candidates.add(modelId);
  }
  return [...candidates];
}

function pickWindowMaxTokens(window: {
  combinedMax?: number;
  inputMax?: number;
  totalMax?: number;
}): number | null {
  const value = window.combinedMax ?? window.inputMax ?? window.totalMax;
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
    return null;
  }
  return Math.trunc(value);
}

function fallbackContextWindow(modelId?: string): number {
  const normalized = modelId?.toLowerCase() ?? "";
  if (normalized.includes("claude")) {
    return 200_000;
  }
  if (normalized.includes("gemini")) {
    return 1_000_000;
  }
  if (normalized.includes("gpt-4.1") || normalized.includes("gpt-5")) {
    return 1_000_000;
  }
  if (normalized.includes("glm") || normalized.includes("qwen")) {
    return 131_072;
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}
