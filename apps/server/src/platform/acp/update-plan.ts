import { isDeepStrictEqual } from "node:util";
import {
  buildPlanToolPart,
  getPlanToolCallId,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";
import type { Plan } from "../../shared/types/session.types";
import type { SessionUpdate, SessionUpdateContext } from "./update-types";

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

export async function handlePlanUpdate(
  context: Pick<
    SessionUpdateContext,
    | "chatId"
    | "update"
    | "sessionRuntime"
    | "sessionRepo"
    | "suppressReplayBroadcast"
    | "finalizeStreamingForCurrentAssistant"
  >
): Promise<boolean> {
  const {
    chatId,
    update,
    sessionRuntime,
    sessionRepo,
    suppressReplayBroadcast,
    finalizeStreamingForCurrentAssistant,
  } = context;
  if (update.sessionUpdate !== "plan") {
    return false;
  }

  await finalizeStreamingForCurrentAssistant(chatId, sessionRuntime, {
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
  if (session?.userId) {
    await sessionRepo.updateMetadata(chatId, session.userId, {
      plan: effectivePlan,
    });
  }

  if (session) {
    const planTool = buildPlanToolPart(
      effectivePlan,
      getPlanToolCallId(chatId)
    );
    const { message } = upsertToolPart({
      state: session.uiState,
      part: planTool,
    });
    if (shouldBroadcast && !suppressReplayBroadcast) {
      await sessionRuntime.broadcast(chatId, { type: "ui_message", message });
    }
  }
  return true;
}
