import type { UIMessage } from "@repo/shared";

export interface MessageState {
  byId: Map<string, UIMessage>;
  order: string[];
  indexById: Map<string, number>;
  orderedMessages: UIMessage[];
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
      nextOrder.push(message.id);
      if (!indexChanged) {
        nextIndexById = new Map(nextIndexById);
        indexChanged = true;
      }
      const nextIndex = nextOrder.length - 1;
      nextIndexById.set(message.id, nextIndex);
      if (!orderedMessagesChanged) {
        nextOrderedMessages = [...nextOrderedMessages];
        orderedMessagesChanged = true;
      }
      nextOrderedMessages.push(message);
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

export const upsertMessageIntoState = (
  state: MessageState,
  message: UIMessage
): MessageState => mergeMessagesIntoState(state, [message]);

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
