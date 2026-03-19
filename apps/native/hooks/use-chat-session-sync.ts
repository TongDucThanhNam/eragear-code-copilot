import type {
  BroadcastEvent,
  SessionModelState,
  SessionModeState,
  SessionStateData,
  ToolUIPart,
  UIMessage,
} from "@repo/shared";
import {
  finalizeToolPartAsCancelled,
  finalizeToolPartAsPreliminaryOutput,
} from "@repo/shared";
import { hasObservedTurnCompletion } from "@/hooks/use-chat-turn-guards";

const RUNTIME_AUTHORITATIVE_LOAD_METHODS = new Set([
  "session_load",
  "unstable_resume",
]);

function isToolPart(part: UIMessage["parts"][number]): part is ToolUIPart {
  return part.type.startsWith("tool-");
}

export function finalizeMessagesAfterReady(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (
      message.parts.some(
        (part) =>
          part.type.startsWith("tool-") &&
          "state" in part &&
          part.state === "approval-requested"
      )
    ) {
      return message;
    }
    let changed = false;
    const parts = message.parts.map((part) => {
      if (
        (part.type === "text" || part.type === "reasoning") &&
        part.state === "streaming"
      ) {
        changed = true;
        return { ...part, state: "done" as const };
      }
      if (isToolPart(part)) {
        const nextPart =
          part.state === "approval-requested"
            ? finalizeToolPartAsCancelled(part)
            : finalizeToolPartAsPreliminaryOutput(part);
        changed ||= nextPart !== part;
        return nextPart;
      }
      return part;
    });
    return changed ? { ...message, parts } : message;
  });
}

export function shouldFinalizeAfterReadyStatus(params: {
  event: Extract<BroadcastEvent, { type: "chat_status" }>;
  completedTurnIds: ReadonlySet<string>;
}): boolean {
  return (
    params.event.status === "ready" &&
    !hasObservedTurnCompletion(
      params.completedTurnIds,
      params.event.turnId ?? null
    )
  );
}

export function getChatFinishHistoryReloadDecision(params: {
  event: Extract<BroadcastEvent, { type: "chat_finish" }>;
  messages: UIMessage[];
}): boolean {
  const resolvedMessageId = params.event.message?.id ?? params.event.messageId;
  if (params.messages.length === 0) {
    return true;
  }
  if (!resolvedMessageId) {
    return false;
  }
  if (!params.messages.some((message) => message.id === resolvedMessageId)) {
    return true;
  }
  return !params.event.message;
}

export interface ResumeSessionSyncPlan {
  alreadyRunning: boolean;
  sessionLoadMethod?: string | null;
  modes?: SessionModeState | null;
  models?: SessionModelState | null;
  supportsModelSwitching?: boolean;
}

export function deriveResumeSessionSyncPlan(
  resumeResult: unknown
): ResumeSessionSyncPlan {
  if (!resumeResult || typeof resumeResult !== "object") {
    return { alreadyRunning: false };
  }
  const record = resumeResult as Record<string, unknown>;
  return {
    alreadyRunning: record.alreadyRunning === true,
    ...(typeof record.sessionLoadMethod === "string" ||
    record.sessionLoadMethod === null
      ? { sessionLoadMethod: record.sessionLoadMethod as string | null }
      : {}),
    modes: record.modes as SessionModeState | null | undefined,
    models: record.models as SessionModelState | null | undefined,
    supportsModelSwitching:
      typeof record.supportsModelSwitching === "boolean"
        ? record.supportsModelSwitching
        : undefined,
  };
}

export function isRuntimeAuthoritativeHistory(
  plan: Pick<ResumeSessionSyncPlan, "alreadyRunning" | "sessionLoadMethod">
): boolean {
  return (
    plan.alreadyRunning === true ||
    (typeof plan.sessionLoadMethod === "string" &&
      RUNTIME_AUTHORITATIVE_LOAD_METHODS.has(plan.sessionLoadMethod))
  );
}

export function shouldBackfillConnectedSessionState(params: {
  sessionState: SessionStateData;
  currentModes: SessionModeState | null;
  currentModels: SessionModelState | null;
}): boolean {
  const nextModes = params.sessionState.modes ?? null;
  const nextModels = params.sessionState.models ?? null;
  const shouldBackfillModes =
    !!nextModes &&
    (!params.currentModes ||
      params.currentModes.currentModeId !== nextModes.currentModeId ||
      params.currentModes.availableModes.length <
        nextModes.availableModes.length);
  const shouldBackfillModels =
    !!nextModels &&
    (!params.currentModels ||
      params.currentModels.currentModelId !== nextModels.currentModelId ||
      params.currentModels.availableModels.length <
        nextModels.availableModels.length);
  return shouldBackfillModes || shouldBackfillModels;
}
