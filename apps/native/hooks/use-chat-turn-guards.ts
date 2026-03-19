import type {
  BroadcastEvent,
  ChatStatus,
  ToolUIPart,
  UIMessagePart,
} from "@repo/shared";
import { isChatBusyStatus, isMessageStreaming } from "@repo/shared";

const BLOCKED_TURN_ID_MAX = 16;
const COMPLETED_TURN_ID_MAX = 16;

function isStreamingPart(part: UIMessagePart): boolean {
  if (part.type === "text" || part.type === "reasoning") {
    return part.state === "streaming";
  }
  if (part.type.startsWith("tool-")) {
    const toolPart = part as ToolUIPart;
    return (
      toolPart.state !== "output-available" &&
      toolPart.state !== "output-error" &&
      toolPart.state !== "output-denied" &&
      toolPart.state !== "output-cancelled"
    );
  }
  return false;
}

function readEventTurnId(event: BroadcastEvent): string | null {
  switch (event.type) {
    case "chat_status":
    case "chat_finish":
    case "ui_message":
    case "ui_message_part":
    case "ui_message_part_removed":
    case "terminal_output":
      return event.turnId ?? null;
    default:
      return null;
  }
}

function isTurnlessStreamingEvent(event: BroadcastEvent): boolean {
  switch (event.type) {
    case "ui_message":
      return isMessageStreaming(event.message);
    case "ui_message_part":
      return isStreamingPart(event.part);
    case "ui_message_part_removed":
      return false;
    case "terminal_output":
      return true;
    default:
      return false;
  }
}

export function canAcceptPendingTurnEvents(
  status: ChatStatus,
  isResuming: boolean
): boolean {
  return isResuming || status === "connecting" || isChatBusyStatus(status);
}

export function shouldRollbackSendMessageFailure(
  currentStatus: ChatStatus
): boolean {
  return currentStatus === "submitted";
}

export function rememberBlockedTurnId(
  blockedTurnIds: Set<string>,
  turnId?: string | null
): void {
  if (!turnId) {
    return;
  }
  blockedTurnIds.add(turnId);
  while (blockedTurnIds.size > BLOCKED_TURN_ID_MAX) {
    const oldest = blockedTurnIds.values().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    blockedTurnIds.delete(oldest);
  }
}

export function rememberCompletedTurnId(
  completedTurnIds: Set<string>,
  turnId?: string | null
): void {
  if (!turnId) {
    return;
  }
  completedTurnIds.add(turnId);
  while (completedTurnIds.size > COMPLETED_TURN_ID_MAX) {
    const oldest = completedTurnIds.values().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    completedTurnIds.delete(oldest);
  }
}

export function hasObservedTurnCompletion(
  completedTurnIds: ReadonlySet<string>,
  turnId?: string | null
): boolean {
  if (!turnId) {
    return false;
  }
  return completedTurnIds.has(turnId);
}

export function resolveSessionEventTurnGuard(params: {
  activeTurnId: string | null;
  blockedTurnIds: ReadonlySet<string>;
  event: BroadcastEvent;
  isResuming: boolean;
  status: ChatStatus;
}): { ignore: boolean; nextActiveTurnId: string | null } {
  const { activeTurnId, blockedTurnIds, event, isResuming, status } = params;
  const eventTurnId = readEventTurnId(event);
  const canAcceptPendingTurn = canAcceptPendingTurnEvents(status, isResuming);

  if (eventTurnId) {
    if (blockedTurnIds.has(eventTurnId)) {
      return { ignore: true, nextActiveTurnId: activeTurnId };
    }
    if (activeTurnId) {
      return {
        ignore: activeTurnId !== eventTurnId,
        nextActiveTurnId: activeTurnId,
      };
    }
    if (!canAcceptPendingTurn) {
      return { ignore: true, nextActiveTurnId: null };
    }
    return { ignore: false, nextActiveTurnId: eventTurnId };
  }

  if (
    !activeTurnId &&
    isTurnlessStreamingEvent(event) &&
    !canAcceptPendingTurn
  ) {
    return { ignore: true, nextActiveTurnId: null };
  }

  return { ignore: false, nextActiveTurnId: activeTurnId };
}
