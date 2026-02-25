import type { UIMessage } from "../ui-message";

const MESSAGE_ROLE_PRIORITY: Record<UIMessage["role"], number> = {
  system: 0,
  user: 1,
  assistant: 2,
};

function compareByRole(left: UIMessage, right: UIMessage): number {
  return MESSAGE_ROLE_PRIORITY[left.role] - MESSAGE_ROLE_PRIORITY[right.role];
}

function compareById(left: UIMessage, right: UIMessage): number {
  return left.id.localeCompare(right.id);
}

export function compareUiMessagesChronologically(
  left: UIMessage,
  right: UIMessage
): number {
  const leftCreatedAt = left.createdAt;
  const rightCreatedAt = right.createdAt;
  if (typeof leftCreatedAt === "number" && typeof rightCreatedAt === "number") {
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    const roleDiff = compareByRole(left, right);
    if (roleDiff !== 0) {
      return roleDiff;
    }
    return compareById(left, right);
  }
  if (typeof leftCreatedAt === "number") {
    return -1;
  }
  if (typeof rightCreatedAt === "number") {
    return 1;
  }
  return 0;
}

export function findUiMessageInsertIndex(
  orderedMessages: UIMessage[],
  nextMessage: UIMessage
): number {
  for (let index = 0; index < orderedMessages.length; index += 1) {
    const current = orderedMessages[index];
    if (!current) {
      continue;
    }
    const compare = compareUiMessagesChronologically(nextMessage, current);
    if (compare < 0) {
      return index;
    }
  }
  return orderedMessages.length;
}
