import type { UIMessage } from "@repo/shared";

export interface MessageState {
  byId: Map<string, UIMessage>;
  order: string[];
}

export type MessageStateUpdater = (prev: MessageState) => MessageState;

export const createEmptyMessageState = (): MessageState => ({
  byId: new Map<string, UIMessage>(),
  order: [],
});

export const getOrderedMessages = (state: MessageState): UIMessage[] => {
  const messages: UIMessage[] = [];
  for (const messageId of state.order) {
    const message = state.byId.get(messageId);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
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
  let byIdChanged = false;
  let orderChanged = false;

  for (const message of messages) {
    const hasMessage = nextById.has(message.id);
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
    }
  }

  if (!byIdChanged && !orderChanged) {
    return state;
  }

  return { byId: nextById, order: nextOrder };
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

  return { byId: nextById, order: nextOrder };
};
