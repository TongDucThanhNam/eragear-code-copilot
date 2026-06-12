import type {
  SessionRepositoryPort,
  SessionRuntimePort,
  StoredMessage,
} from "@/modules/session";
import { NotFoundError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import type {
  ContextUsageEstimate,
  ContextUsageEstimateInput,
  ContextUsageStatus,
} from "./contracts/context-usage.contract";
import type {
  ContextUsageEstimatorPort,
  ContextUsageMessageInput,
} from "./ports/context-usage-estimator.port";

const MODULE = "context-usage";
const OP_ESTIMATE = "estimate";
const HISTORY_MESSAGE_LIMIT = 200;
const PERCENT_MAX = 100;

export interface ContextUsageServiceDeps {
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  estimator: ContextUsageEstimatorPort;
  nowMs?: () => number;
}

export class ContextUsageService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly estimator: ContextUsageEstimatorPort;
  private readonly nowMs: () => number;

  constructor(deps: ContextUsageServiceDeps) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.estimator = deps.estimator;
    this.nowMs = deps.nowMs ?? (() => Date.now());
  }

  async estimate(
    userId: string,
    input: ContextUsageEstimateInput
  ): Promise<ContextUsageEstimate> {
    const runtimeSession = this.sessionRuntime.get(input.chatId);
    if (runtimeSession && runtimeSession.userId !== userId) {
      throw new NotFoundError("Session not found", {
        module: MODULE,
        op: OP_ESTIMATE,
        details: { chatId: input.chatId },
      });
    }

    const storedSession = await this.sessionRepo.findById(input.chatId, userId);
    if (!(runtimeSession || storedSession)) {
      throw new NotFoundError("Session not found", {
        module: MODULE,
        op: OP_ESTIMATE,
        details: { chatId: input.chatId },
      });
    }

    const page = await this.sessionRepo.getMessagesPage(input.chatId, userId, {
      direction: "backward",
      includeCompacted: false,
      limit: HISTORY_MESSAGE_LIMIT,
    });
    const messages = page.messages.map(toEstimatorMessage);
    const model = resolveModelContext({
      runtimeSession,
      storedModelId: storedSession?.modelId,
      requestedModelId: input.modelId,
    });
    const tokenEstimate = this.estimator.estimateTokens({
      messages,
      draftText: input.draftText,
      attachmentCount: input.attachmentCount,
      attachmentBytes: input.attachmentBytes,
      mentionCount: input.mentionCount,
    });
    const window = this.estimator.resolveContextWindow(model);
    const usedTokens = tokenEstimate.totalTokens;
    const remainingTokens = window.maxTokens - usedTokens;
    const percentUsed =
      window.maxTokens > 0 ? (usedTokens / window.maxTokens) * PERCENT_MAX : 0;

    return {
      chatId: input.chatId,
      ...(model.modelId ? { modelId: model.modelId } : {}),
      ...(model.modelProvider ? { modelProvider: model.modelProvider } : {}),
      usedTokens,
      maxTokens: window.maxTokens,
      remainingTokens,
      percentUsed,
      status: toContextUsageStatus(percentUsed),
      messageCount: page.messages.length,
      truncatedHistory: page.hasMore,
      estimatedAt: this.nowMs(),
      source: window.source,
      tokenSource: tokenEstimate.source,
      breakdown: tokenEstimate.breakdown,
    };
  }
}

function toEstimatorMessage(message: StoredMessage): ContextUsageMessageInput {
  return {
    role: message.role,
    content: message.content,
  };
}

function resolveModelContext(params: {
  runtimeSession?: ChatSession;
  storedModelId?: string;
  requestedModelId?: string;
}): { modelId?: string; modelProvider?: string } {
  const runtimeModelId = params.runtimeSession?.models?.currentModelId;
  const modelId =
    params.requestedModelId ?? runtimeModelId ?? params.storedModelId;
  const availableModel = modelId
    ? params.runtimeSession?.models?.availableModels.find(
        (model) => model.modelId === modelId
      )
    : undefined;
  const provider = availableModel?.providers?.[0] ?? availableModel?.provider;

  return {
    ...(modelId ? { modelId } : {}),
    ...(provider ? { modelProvider: provider } : {}),
  };
}

function toContextUsageStatus(percentUsed: number): ContextUsageStatus {
  if (percentUsed >= 100) {
    return "overflow";
  }
  if (percentUsed >= 85) {
    return "compact";
  }
  if (percentUsed >= 75) {
    return "warn";
  }
  return "ok";
}
