import type { ChatStatus, UIMessage } from "@repo/shared";
import {
  isDataPart,
  isPlanPart,
} from "@/components/chat-ui/agentic-message-utils";

const THINKING_PLACEHOLDER_STATUSES = new Set<ChatStatus>([
  "submitted",
  "streaming",
  "awaiting_permission",
]);

function hasRenderableAssistantParts(message: UIMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  return message.parts.some(
    (part) => !(isDataPart(part) || isPlanPart(part))
  );
}

export function shouldShowThinkingPlaceholder(params: {
  messages: readonly UIMessage[];
  status: ChatStatus;
}): boolean {
  const { messages, status } = params;
  if (messages.length === 0 || !THINKING_PLACEHOLDER_STATUSES.has(status)) {
    return false;
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex < 0) {
    return false;
  }

  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && hasRenderableAssistantParts(message)) {
      return false;
    }
  }

  return true;
}
