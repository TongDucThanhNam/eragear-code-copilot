import type { UIMessage } from "@repo/shared";
import { findUiMessageInsertIndex } from "@repo/shared";

export interface MessageState {
  byId: Map<string, UIMessage>;
  order: string[];
  indexById: Map<string, number>;
  orderedMessages: UIMessage[];
}

export interface MessageDeltaChunk {
  messageId: string;
  partIndex: number;
  delta: string;
}

export interface MessagePartUpdateChunk {
  messageId: string;
  messageRole: UIMessage["role"];
  partIndex: number;
  part: UIMessage["parts"][number];
  isNew: boolean;
}

export const createEmptyMessageState = (): MessageState => ({
  byId: new Map<string, UIMessage>(),
  order: [],
  indexById: new Map<string, number>(),
  orderedMessages: [],
});

export const getOrderedMessages = (state: MessageState): UIMessage[] => {
  return state.orderedMessages;
};

export const mergeMessagesIntoState = (
  state: MessageState,
  messages: UIMessage[]
): MessageState => {
  if (messages.length === 0) {
    return state;
  }

  let nextById = state.byId;
  let nextOrder = state.order;
  let nextIndexById = state.indexById;
  let nextOrderedMessages = state.orderedMessages;
  let byIdChanged = false;
  let orderChanged = false;
  let orderedMessagesChanged = false;
  let indexChanged = false;

  for (const message of messages) {
    const index = nextIndexById.get(message.id);
    const hasMessage = index !== undefined;
    const prevMessage = nextById.get(message.id);

    if (prevMessage !== message) {
      if (!byIdChanged) {
        nextById = new Map(nextById);
        byIdChanged = true;
      }
      nextById.set(message.id, message);
    }

    if (!hasMessage) {
      if (!orderChanged) {
        nextOrder = [...nextOrder];
        orderChanged = true;
      }
      const insertIndex = findUiMessageInsertIndex(nextOrderedMessages, message);
      nextOrder.splice(insertIndex, 0, message.id);
      if (!indexChanged) {
        nextIndexById = new Map(nextIndexById);
        indexChanged = true;
      }
      for (let reorderIndex = insertIndex; reorderIndex < nextOrder.length; reorderIndex += 1) {
        const reorderMessageId = nextOrder[reorderIndex];
        if (reorderMessageId) {
          nextIndexById.set(reorderMessageId, reorderIndex);
        }
      }
      if (!orderedMessagesChanged) {
        nextOrderedMessages = [...nextOrderedMessages];
        orderedMessagesChanged = true;
      }
      nextOrderedMessages.splice(insertIndex, 0, message);
      continue;
    }

    if (prevMessage !== message && index !== undefined) {
      if (!orderedMessagesChanged) {
        nextOrderedMessages = [...nextOrderedMessages];
        orderedMessagesChanged = true;
      }
      nextOrderedMessages[index] = message;
    }
  }

  if (!byIdChanged && !orderChanged && !orderedMessagesChanged && !indexChanged) {
    return state;
  }

  return {
    byId: nextById,
    order: nextOrder,
    indexById: nextIndexById,
    orderedMessages: nextOrderedMessages,
  };
};

export const prependMessagesIntoState = (
  state: MessageState,
  messages: UIMessage[]
): MessageState => {
  if (messages.length === 0) {
    return state;
  }

  let nextById = state.byId;
  let nextOrder = state.order;
  let nextIndexById = state.indexById;
  let nextOrderedMessages = state.orderedMessages;
  let byIdChanged = false;
  let orderedMessagesChanged = false;
  const prependMessages: UIMessage[] = [];
  const seenPrepended = new Set<string>();

  for (const message of messages) {
    const index = nextIndexById.get(message.id);
    const hasMessage = index !== undefined;
    const prevMessage = nextById.get(message.id);

    if (prevMessage !== message) {
      if (!byIdChanged) {
        nextById = new Map(nextById);
        byIdChanged = true;
      }
      nextById.set(message.id, message);
      if (index !== undefined) {
        if (!orderedMessagesChanged) {
          nextOrderedMessages = [...nextOrderedMessages];
          orderedMessagesChanged = true;
        }
        nextOrderedMessages[index] = message;
      }
    }

    if (!hasMessage && !seenPrepended.has(message.id)) {
      prependMessages.push(message);
      seenPrepended.add(message.id);
    }
  }

  if (!byIdChanged && !orderedMessagesChanged && prependMessages.length === 0) {
    return state;
  }

  if (prependMessages.length > 0) {
    nextOrderedMessages = [...prependMessages, ...nextOrderedMessages];
    nextOrder = nextOrderedMessages.map((message) => message.id);
    nextIndexById = new Map<string, number>();
    for (let index = 0; index < nextOrder.length; index += 1) {
      const messageId = nextOrder[index];
      if (messageId) {
        nextIndexById.set(messageId, index);
      }
    }
  }

  return {
    byId: nextById,
    order: nextOrder,
    indexById: nextIndexById,
    orderedMessages: nextOrderedMessages,
  };
};

function applyDeltaToMessage(
  message: UIMessage,
  partIndex: number,
  delta: string
): UIMessage | null {
  if (!delta) {
    return message;
  }
  const part = message.parts[partIndex];
  if (!part || (part.type !== "text" && part.type !== "reasoning")) {
    return null;
  }
  const updatedPart = { ...part, text: `${part.text ?? ""}${delta}` };
  const updatedParts = [...message.parts];
  updatedParts[partIndex] = updatedPart;
  return {
    ...message,
    parts: updatedParts,
  };
}

export const applyMessageDeltasIntoState = (
  state: MessageState,
  deltas: MessageDeltaChunk[]
): MessageState => {
  if (deltas.length === 0) {
    return state;
  }

  const updatedById = new Map<string, UIMessage>();
  const touchedMessageIds: string[] = [];
  const seenMessageIds = new Set<string>();

  for (const delta of deltas) {
    if (!delta.delta) {
      continue;
    }

    const sourceMessage =
      updatedById.get(delta.messageId) ?? state.byId.get(delta.messageId);
    if (!sourceMessage) {
      continue;
    }

    const updatedMessage = applyDeltaToMessage(
      sourceMessage,
      delta.partIndex,
      delta.delta
    );
    if (!updatedMessage || updatedMessage === sourceMessage) {
      continue;
    }

    updatedById.set(delta.messageId, updatedMessage);
    if (!seenMessageIds.has(delta.messageId)) {
      seenMessageIds.add(delta.messageId);
      touchedMessageIds.push(delta.messageId);
    }
  }

  if (touchedMessageIds.length === 0) {
    return state;
  }

  const updatedMessages = touchedMessageIds
    .map((messageId) => updatedById.get(messageId))
    .filter((message): message is UIMessage => Boolean(message));
  return mergeMessagesIntoState(state, updatedMessages);
};

export const upsertMessageIntoState = (
  state: MessageState,
  message: UIMessage
): MessageState => mergeMessagesIntoState(state, [message]);

export const applyPartUpdate = (
  state: MessageState,
  update: MessagePartUpdateChunk
): MessageState => {
  const existing = state.byId.get(update.messageId);
  if (!existing) {
    if (!update.isNew && update.partIndex > 0) {
      return state;
    }
    const created: UIMessage = {
      id: update.messageId,
      role: update.messageRole,
      parts: [update.part],
    };
    return mergeMessagesIntoState(state, [created]);
  }

  const nextParts = [...existing.parts];
  if (update.isNew) {
    if (update.partIndex < 0 || update.partIndex > nextParts.length) {
      return state;
    }
    if (update.partIndex === nextParts.length) {
      nextParts.push(update.part);
    } else {
      nextParts.splice(update.partIndex, 0, update.part);
    }
  } else {
    if (update.partIndex < 0 || update.partIndex >= nextParts.length) {
      return state;
    }
    nextParts[update.partIndex] = update.part;
  }

  const nextMessage: UIMessage = {
    ...existing,
    parts: nextParts,
  };
  return mergeMessagesIntoState(state, [nextMessage]);
};

export const replaceMessagesState = (messages: UIMessage[]): MessageState => {
  const nextById = new Map<string, UIMessage>();
  const nextOrder: string[] = [];

  for (const message of messages) {
    if (!nextById.has(message.id)) {
      nextOrder.push(message.id);
    }
    nextById.set(message.id, message);
  }

  const nextOrderedMessages = nextOrder
    .map((messageId) => nextById.get(messageId))
    .filter((message): message is UIMessage => Boolean(message));
  const nextIndexById = new Map<string, number>();
  for (let index = 0; index < nextOrder.length; index += 1) {
    const messageId = nextOrder[index];
    if (messageId) {
      nextIndexById.set(messageId, index);
    }
  }

  return {
    byId: nextById,
    order: nextOrder,
    indexById: nextIndexById,
    orderedMessages: nextOrderedMessages,
  };
};
