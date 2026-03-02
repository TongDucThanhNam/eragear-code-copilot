import type { UIMessage } from "@repo/shared";
import { findUiMessageInsertIndex } from "@repo/shared";

/**
 * Normalized message state optimized for id-based upsert plus stable render
 * order lookup.
 */
export interface MessageState {
  byId: Map<string, UIMessage>;
  order: string[];
  indexById: Map<string, number>;
  orderedMessages: UIMessage[];
}

export interface MessagePartUpdateChunk {
  messageId: string;
  messageRole: UIMessage["role"];
  partIndex: number;
  part: UIMessage["parts"][number];
  isNew: boolean;
  createdAt?: number;
}

export const createEmptyMessageState = (): MessageState => ({
  byId: new Map<string, UIMessage>(),
  order: [],
  indexById: new Map<string, number>(),
  orderedMessages: [],
});

/** Return memo-friendly ordered messages array from normalized state. */
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
      const insertIndex = findUiMessageInsertIndex(
        nextOrderedMessages,
        message
      );
      nextOrder.splice(insertIndex, 0, message.id);
      if (!indexChanged) {
        nextIndexById = new Map(nextIndexById);
        indexChanged = true;
      }
      for (
        let reorderIndex = insertIndex;
        reorderIndex < nextOrder.length;
        reorderIndex += 1
      ) {
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

  if (
    !(byIdChanged || orderChanged || orderedMessagesChanged || indexChanged)
  ) {
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

    if (!(hasMessage || seenPrepended.has(message.id))) {
      prependMessages.push(message);
      seenPrepended.add(message.id);
    }
  }

  if (
    !(byIdChanged || orderedMessagesChanged) &&
    prependMessages.length === 0
  ) {
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

/**
 * Apply part-level stream updates. Out-of-order parts are appended and later
 * corrected by the next `ui_message` snapshot.
 */
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
      ...(typeof update.createdAt === "number"
        ? { createdAt: update.createdAt }
        : {}),
    };
    return mergeMessagesIntoState(state, [created]);
  }

  const nextParts = [...existing.parts];
  if (update.isNew) {
    if (update.partIndex < 0) {
      return state;
    }
    if (update.partIndex <= nextParts.length) {
      if (update.partIndex === nextParts.length) {
        nextParts.push(update.part);
      } else {
        nextParts.splice(update.partIndex, 0, update.part);
      }
    } else {
      // Out-of-order: index beyond current array length.
      // Append to end to avoid data loss; the full ui_message
      // snapshot will correct the position.
      nextParts.push(update.part);
    }
  } else {
    if (update.partIndex < 0) {
      return state;
    }
    if (update.partIndex < nextParts.length) {
      nextParts[update.partIndex] = update.part;
    } else {
      // Out-of-order: part doesn't exist at this index yet.
      // Append to avoid data loss; the full ui_message
      // snapshot will correct the position.
      nextParts.push(update.part);
    }
  }

  const nextMessage: UIMessage = {
    ...existing,
    parts: nextParts,
  };
  return mergeMessagesIntoState(state, [nextMessage]);
};

function finalizeToolPartAfterReady(
  part: Extract<UIMessage["parts"][number], { type: `tool-${string}` }>
): UIMessage["parts"][number] {
  if (
    part.state !== "input-streaming" &&
    part.state !== "input-available" &&
    part.state !== "approval-requested" &&
    part.state !== "approval-responded"
  ) {
    return part;
  }

  const withMetadata =
    "callProviderMetadata" in part && part.callProviderMetadata
      ? { callProviderMetadata: part.callProviderMetadata }
      : {};

  return {
    type: part.type,
    toolCallId: part.toolCallId,
    ...(part.title ? { title: part.title } : {}),
    ...(part.providerExecuted !== undefined
      ? { providerExecuted: part.providerExecuted }
      : {}),
    state: "output-available" as const,
    input: part.input ?? null,
    output: null,
    preliminary: true,
    ...withMetadata,
  };
}

function finalizeMessageAfterReady(message: UIMessage): UIMessage {
  let changed = false;
  const parts = message.parts.map((part) => {
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.state === "streaming"
    ) {
      changed = true;
      return {
        ...part,
        state: "done" as const,
      };
    }
    if (part.type.startsWith("tool-")) {
      const nextToolPart = finalizeToolPartAfterReady(
        part as Extract<UIMessage["parts"][number], { type: `tool-${string}` }>
      );
      if (nextToolPart !== part) {
        changed = true;
      }
      return nextToolPart;
    }
    return part;
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    parts,
  };
}

/**
 * Force-close lingering streaming parts after server emits terminal readiness
 * status for the turn.
 */
export const finalizeStreamingMessagesInState = (
  state: MessageState
): MessageState => {
  const finalized: UIMessage[] = [];
  for (const message of state.orderedMessages) {
    const nextMessage = finalizeMessageAfterReady(message);
    if (nextMessage !== message) {
      finalized.push(nextMessage);
    }
  }
  if (finalized.length === 0) {
    return state;
  }
  return mergeMessagesIntoState(state, finalized);
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
