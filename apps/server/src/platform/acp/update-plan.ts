import { isDeepStrictEqual } from "node:util";
import {
  buildPlanToolPart,
  getPlanToolCallId,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import type { Plan } from "../../shared/types/session.types";
import { broadcastUiMessagePart } from "./ui-message-part";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

const PLAN_PERSIST_DEBOUNCE_MS = 250;

interface PendingPlanPersistence {
  timer: ReturnType<typeof setTimeout>;
  userId: string;
  plan: Plan;
  sessionRepo: SessionUpdateContext["sessionRepo"];
}

const pendingPlanPersistenceByChat = new Map<string, PendingPlanPersistence>();

function extractPlan(update: SessionUpdate): Plan | null {
  if (update.sessionUpdate !== "plan") {
    return null;
  }

  return {
    _meta: "_meta" in update ? (update._meta ?? null) : null,
    entries: update.entries,
  };
}

function normalizePlanForComparison(
  plan: Plan | null | undefined
): Plan | null {
  if (!plan) {
    return null;
  }
  return {
    _meta: plan._meta ?? null,
    entries: plan.entries.map((entry) => ({
      ...entry,
      _meta: entry._meta ?? null,
    })),
  };
}

async function persistPlanNow(
  chatId: string,
  pending: Omit<PendingPlanPersistence, "timer">
): Promise<void> {
  try {
    await pending.sessionRepo.updateMetadata(chatId, pending.userId, {
      plan: pending.plan,
    });
  } catch (error) {
    console.warn("Failed to persist debounced plan metadata", {
      chatId,
      userId: pending.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function schedulePlanPersistence(params: {
  chatId: string;
  userId: string;
  plan: Plan;
  sessionRepo: SessionUpdateContext["sessionRepo"];
}): void {
  const { chatId, userId, plan, sessionRepo } = params;
  const existing = pendingPlanPersistenceByChat.get(chatId);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => {
    const latest = pendingPlanPersistenceByChat.get(chatId);
    if (!latest) {
      return;
    }
    pendingPlanPersistenceByChat.delete(chatId);
    void persistPlanNow(chatId, {
      userId: latest.userId,
      plan: latest.plan,
      sessionRepo: latest.sessionRepo,
    });
  }, PLAN_PERSIST_DEBOUNCE_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  pendingPlanPersistenceByChat.set(chatId, {
    timer,
    userId,
    plan,
    sessionRepo,
  });
}

export async function flushPendingPlanPersistenceForTests(
  chatId?: string
): Promise<void> {
  const targets =
    typeof chatId === "string"
      ? [[chatId, pendingPlanPersistenceByChat.get(chatId)] as const]
      : Array.from(pendingPlanPersistenceByChat.entries());
  if (typeof chatId === "string") {
    pendingPlanPersistenceByChat.delete(chatId);
  } else {
    pendingPlanPersistenceByChat.clear();
  }
  await Promise.all(
    targets.map(async ([nextChatId, pending]) => {
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      await persistPlanNow(nextChatId, {
        userId: pending.userId,
        plan: pending.plan,
        sessionRepo: pending.sessionRepo,
      });
    })
  );
}

export async function handlePlanUpdate(
  context: Pick<
    SessionUpdateContext,
    | "chatId"
    | "update"
    | "sessionRuntime"
    | "sessionRepo"
    | "suppressReplayBroadcast"
    | "buffer"
    | "finalizeStreamingForCurrentAssistant"
  >
): Promise<boolean> {
  const {
    chatId,
    buffer,
    update,
    sessionRuntime,
    sessionRepo,
    suppressReplayBroadcast,
    finalizeStreamingForCurrentAssistant,
  } = context;
  if (update.sessionUpdate !== "plan") {
    return false;
  }

  await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, buffer, {
    suppressBroadcast: suppressReplayBroadcast,
  });

  const plan = extractPlan(update);
  if (!plan) {
    return true;
  }

  const session = sessionRuntime.get(chatId);
  const normalizedPlan = normalizePlanForComparison(plan);
  const previousPlan = normalizePlanForComparison(session?.plan);
  const effectivePlan = normalizedPlan ?? plan;
  const shouldBroadcast = !isDeepStrictEqual(previousPlan, normalizedPlan);

  if (session) {
    session.plan = effectivePlan;
  }
  if (session?.userId && shouldBroadcast) {
    schedulePlanPersistence({
      chatId,
      userId: session.userId,
      plan: effectivePlan,
      sessionRepo,
    });
  }

  if (session) {
    const planToolCallId = getPlanToolCallId(chatId);
    const previousPlanIndex = session.uiState.toolPartIndex.get(planToolCallId);
    const planTool = buildPlanToolPart(effectivePlan, planToolCallId);
    const { message } = upsertToolPart({
      state: session.uiState,
      part: planTool,
    });
    if (shouldBroadcast && !suppressReplayBroadcast) {
      const nextPlanIndex = session.uiState.toolPartIndex.get(planToolCallId);
      if (nextPlanIndex && nextPlanIndex.messageId === message.id) {
        await broadcastUiMessagePart({
          chatId,
          sessionRuntime,
          message,
          partIndex: nextPlanIndex.partIndex,
          isNew:
            !previousPlanIndex ||
            previousPlanIndex.messageId !== nextPlanIndex.messageId ||
            previousPlanIndex.partIndex !== nextPlanIndex.partIndex,
        });
      }
    }
  }
  return true;
}
