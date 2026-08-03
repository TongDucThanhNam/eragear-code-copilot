export const CHAT_VIRTUALIZER_CONFIG = {
  anchorTo: "end",
  followOnAppend: true,
  overscan: 8,
  scrollEndThreshold: 96,
} as const;

export const LOAD_OLDER_ESTIMATE = 48;
export const THINKING_ESTIMATE = 72;
export const MESSAGE_ESTIMATE = 180;

export type ChatVirtualItem =
  | { kind: "load-older" }
  | { kind: "message"; messageId: string }
  | { kind: "thinking" };

export interface InitialChatScrollState {
  chatId: string | null | undefined;
  pending: boolean;
}

export interface InitialChatScrollTransition {
  chatChanged: boolean;
  shouldScrollToEnd: boolean;
  state: InitialChatScrollState;
}

export interface ChatVirtualTail {
  itemCount: number;
  key: string | null;
}

export function resolveChatVirtualItem(
  index: number,
  messageIds: readonly string[],
  hasLoadOlder: boolean
): ChatVirtualItem {
  if (hasLoadOlder && index === 0) {
    return { kind: "load-older" };
  }
  const messageIndex = index - (hasLoadOlder ? 1 : 0);
  if (messageIndex >= 0 && messageIndex < messageIds.length) {
    return {
      kind: "message",
      messageId: messageIds[messageIndex] ?? "",
    };
  }
  return { kind: "thinking" };
}

export function getChatVirtualItemKey(
  chatId: string | null,
  item: ChatVirtualItem
): string {
  const chatKey = chatId ?? "no-chat";
  if (item.kind === "message") {
    return `chat:${chatKey}:message:${item.messageId}`;
  }
  return `chat:${chatKey}:${item.kind}`;
}

export function getChatVirtualItemEstimate(item: ChatVirtualItem): number {
  if (item.kind === "load-older") {
    return LOAD_OLDER_ESTIMATE;
  }
  if (item.kind === "thinking") {
    return THINKING_ESTIMATE;
  }
  return MESSAGE_ESTIMATE;
}

/**
 * A chat switch always starts at the latest output. If history arrives after
 * the switch, the pending reset is retained until at least one row exists.
 * Same-chat appends are left to TanStack Virtual's followOnAppend behavior.
 */
export function reconcileInitialChatScroll(
  previous: InitialChatScrollState,
  chatId: string | null,
  itemCount: number
): InitialChatScrollTransition {
  const chatChanged = previous.chatId !== chatId;
  const pending = previous.pending || chatChanged;
  const shouldScrollToEnd = pending && itemCount > 0;

  return {
    chatChanged,
    shouldScrollToEnd,
    state: {
      chatId,
      pending: pending && !shouldScrollToEnd,
    },
  };
}

/**
 * A thinking placeholder can be replaced by the first assistant message
 * without changing the virtual row count. TanStack's followOnAppend only runs
 * when count increases, so explicitly follow this count-neutral tail change
 * when the user was already pinned. Prepending history keeps the tail key and
 * never enters this path.
 */
export function shouldFollowChatTailReplacement(
  previous: ChatVirtualTail,
  next: ChatVirtualTail,
  wasAtEnd: boolean,
  chatChanged: boolean
): boolean {
  return (
    wasAtEnd &&
    !chatChanged &&
    previous.key !== null &&
    next.key !== null &&
    previous.itemCount === next.itemCount &&
    previous.key !== next.key
  );
}
