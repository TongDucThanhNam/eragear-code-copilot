import type { UIMessage } from "@repo/shared";
import {
  finalizeToolPartAsCancelled,
  finalizeToolPartAsPreliminaryOutput,
  findUiMessageInsertIndex,
} from "@repo/shared";

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
  partId?: string;
  partIndex: number;
  part: UIMessage["parts"][number];
  isNew: boolean;
  createdAt?: number;
}

function areStructurallyEqualParts(
  left: UIMessage["parts"][number],
  right: UIMessage["parts"][number]
): boolean {
  if (left === right) {
    return true;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

const TOOL_PART_STATE_RANK: Record<string, number> = {
  "input-streaming": 1,
  "input-available": 2,
  "approval-requested": 3,
  "approval-responded": 4,
  "output-available": 5,
  "output-error": 5,
  "output-denied": 5,
  "output-cancelled": 5,
};

function shouldKeepExistingPart(
  existing: UIMessage["parts"][number],
  incoming: UIMessage["parts"][number]
): boolean {
  if (existing.type !== incoming.type) {
    return true;
  }

  if (
    (existing.type === "text" || existing.type === "reasoning") &&
    (incoming.type === "text" || incoming.type === "reasoning")
  ) {
    const existingDone = existing.state === "done";
    const incomingDone = incoming.state === "done";
    if (existingDone && !incomingDone) {
      return true;
    }
    return existing.text.length > incoming.text.length;
  }

  if (existing.type.startsWith("tool-") && incoming.type.startsWith("tool-")) {
    const existingState = (existing as { state?: string }).state;
    const incomingState = (incoming as { state?: string }).state;
    if (
      typeof existingState === "string" &&
      typeof incomingState === "string"
    ) {
      // Never block approval-requested — server is authoritative for
      // permission state. Premature finalization can push a tool to
      // output-available (rank 5) before the live permission event
      // (approval-requested, rank 3) arrives. The anti-regression guard
      // must yield to the server's permission request.
      if (incomingState === "approval-requested") {
        return false;
      }
      const existingRank = TOOL_PART_STATE_RANK[existingState] ?? 0;
      const incomingRank = TOOL_PART_STATE_RANK[incomingState] ?? 0;
      return existingRank > incomingRank;
    }
  }

  return false;
}

function shouldKeepExistingSnapshotPart(
  existing: UIMessage["parts"][number],
  incoming: UIMessage["parts"][number]
): boolean {
  if (existing.type !== incoming.type) {
    return false;
  }

  if (
    (existing.type === "text" || existing.type === "reasoning") &&
    (incoming.type === "text" || incoming.type === "reasoning")
  ) {
    const existingDone = existing.state === "done";
    const incomingDone = incoming.state === "done";
    if (existingDone && !incomingDone) {
      return true;
    }
    return existing.text.length > incoming.text.length;
  }

  if (existing.type.startsWith("tool-") && incoming.type.startsWith("tool-")) {
    const existingToolPart = existing as Extract<
      UIMessage["parts"][number],
      { type: `tool-${string}` }
    >;
    const incomingToolPart = incoming as Extract<
      UIMessage["parts"][number],
      { type: `tool-${string}` }
    >;
    if (existingToolPart.toolCallId !== incomingToolPart.toolCallId) {
      return false;
    }
    const existingState = (existing as { state?: string }).state;
    const incomingState = (incoming as { state?: string }).state;
    if (
      typeof existingState === "string" &&
      typeof incomingState === "string"
    ) {
      // Never block approval-requested from snapshots — same rationale
      // as shouldKeepExistingPart: server authority overrides premature
      // client finalization.
      if (incomingState === "approval-requested") {
        return false;
      }
      const existingRank = TOOL_PART_STATE_RANK[existingState] ?? 0;
      const incomingRank = TOOL_PART_STATE_RANK[incomingState] ?? 0;
      return existingRank > incomingRank;
    }
  }

  return false;
}

function readPartId(part: UIMessage["parts"][number]): string | undefined {
  const id = (part as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function attachPartId(
  part: UIMessage["parts"][number],
  partId?: string
): UIMessage["parts"][number] {
  if (!(typeof partId === "string" && partId.length > 0)) {
    return part;
  }
  if (readPartId(part) === partId) {
    return part;
  }
  return {
    ...(part as Record<string, unknown>),
    id: partId,
  } as UIMessage["parts"][number];
}

function findPartIndexByIdentity(params: {
  parts: UIMessage["parts"];
  part: UIMessage["parts"][number];
  partId?: string;
}): number {
  const { parts, part, partId } = params;
  if (typeof partId === "string" && partId.length > 0) {
    const byIdIndex = parts.findIndex(
      (candidate) => readPartId(candidate) === partId
    );
    if (byIdIndex >= 0) {
      return byIdIndex;
    }
  }

  if (part.type.startsWith("tool-")) {
    return parts.findIndex(
      (candidate) =>
        candidate.type.startsWith("tool-") &&
        (
          candidate as Extract<
            UIMessage["parts"][number],
            { type: `tool-${string}` }
          >
        ).toolCallId ===
          (
            part as Extract<
              UIMessage["parts"][number],
              { type: `tool-${string}` }
            >
          ).toolCallId
    );
  }

  if (part.type === "data-permission-options") {
    const incomingRequestId = (part.data as { requestId?: unknown } | undefined)
      ?.requestId;
    if (
      typeof incomingRequestId !== "string" ||
      incomingRequestId.length === 0
    ) {
      return -1;
    }
    return parts.findIndex((candidate) => {
      if (candidate.type !== "data-permission-options") {
        return false;
      }
      const candidateRequestId = (
        candidate.data as { requestId?: unknown } | undefined
      )?.requestId;
      return candidateRequestId === incomingRequestId;
    });
  }

  if (part.type === "data-tool-locations") {
    const incomingToolCallId = (
      part.data as { toolCallId?: unknown } | undefined
    )?.toolCallId;
    if (
      typeof incomingToolCallId !== "string" ||
      incomingToolCallId.length === 0
    ) {
      return -1;
    }
    return parts.findIndex((candidate) => {
      if (candidate.type !== "data-tool-locations") {
        return false;
      }
      const candidateToolCallId = (
        candidate.data as { toolCallId?: unknown } | undefined
      )?.toolCallId;
      return candidateToolCallId === incomingToolCallId;
    });
  }

  return -1;
}

function shouldRecoverMissingPartFromUpdate(
  part: UIMessage["parts"][number]
): boolean {
  return (
    part.type.startsWith("tool-") ||
    part.type === "data-permission-options" ||
    part.type === "data-tool-locations"
  );
}

function replacePartAtIndex(
  parts: UIMessage["parts"],
  index: number,
  incomingPart: UIMessage["parts"][number]
): UIMessage["parts"] | null {
  const existingPart = parts[index];
  if (!existingPart) {
    return null;
  }
  const nextPart = attachPartId(incomingPart, readPartId(existingPart));
  if (
    !areStructurallyEqualParts(existingPart, nextPart) &&
    shouldKeepExistingPart(existingPart, nextPart)
  ) {
    return null;
  }
  if (areStructurallyEqualParts(existingPart, nextPart)) {
    return parts;
  }
  const nextParts = [...parts];
  nextParts[index] = nextPart;
  return nextParts;
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

function mergeMessageParts(
  existingParts: UIMessage["parts"],
  incomingParts: UIMessage["parts"]
): UIMessage["parts"] {
  if (incomingParts.length === 0) {
    return existingParts.length > 0 ? existingParts : incomingParts;
  }

  let nextParts = incomingParts;
  let changed = false;

  for (
    let partIndex = 0;
    partIndex < Math.max(existingParts.length, incomingParts.length);
    partIndex += 1
  ) {
    const existingPart = existingParts[partIndex];
    const incomingPart = incomingParts[partIndex];

    if (!existingPart) {
      continue;
    }

    if (!incomingPart) {
      if (!changed) {
        nextParts = [...incomingParts];
        changed = true;
      }
      nextParts.push(existingPart);
      continue;
    }

    const stablePartId = readPartId(existingPart) ?? readPartId(incomingPart);
    const normalizedExistingPart = attachPartId(existingPart, stablePartId);
    const normalizedIncomingPart = attachPartId(incomingPart, stablePartId);

    if (
      areStructurallyEqualParts(normalizedExistingPart, normalizedIncomingPart)
    ) {
      if (normalizedIncomingPart !== incomingPart) {
        if (!changed) {
          nextParts = [...incomingParts];
          changed = true;
        }
        nextParts[partIndex] = normalizedIncomingPart;
      }
      continue;
    }

    if (
      shouldKeepExistingSnapshotPart(
        normalizedExistingPart,
        normalizedIncomingPart
      )
    ) {
      if (!changed) {
        nextParts = [...incomingParts];
        changed = true;
      }
      nextParts[partIndex] = normalizedExistingPart;
      continue;
    }

    if (normalizedIncomingPart !== incomingPart) {
      if (!changed) {
        nextParts = [...incomingParts];
        changed = true;
      }
      nextParts[partIndex] = normalizedIncomingPart;
    }
  }

  return changed ? nextParts : incomingParts;
}

function mergeMessageSnapshots(
  existingMessage: UIMessage,
  incomingMessage: UIMessage
): UIMessage {
  const nextParts = mergeMessageParts(
    existingMessage.parts,
    incomingMessage.parts
  );
  const nextCreatedAt = incomingMessage.createdAt ?? existingMessage.createdAt;
  const nextMetadata = incomingMessage.metadata ?? existingMessage.metadata;

  if (
    existingMessage.role === incomingMessage.role &&
    nextParts === existingMessage.parts &&
    nextCreatedAt === existingMessage.createdAt &&
    nextMetadata === existingMessage.metadata
  ) {
    return existingMessage;
  }

  if (
    nextParts === incomingMessage.parts &&
    nextCreatedAt === incomingMessage.createdAt &&
    nextMetadata === incomingMessage.metadata
  ) {
    return incomingMessage;
  }

  return {
    ...incomingMessage,
    parts: nextParts,
    ...(typeof nextCreatedAt === "number" ? { createdAt: nextCreatedAt } : {}),
    ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
  };
}

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
    const nextMessage =
      prevMessage && prevMessage !== message
        ? mergeMessageSnapshots(prevMessage, message)
        : message;

    if (prevMessage !== nextMessage) {
      if (!byIdChanged) {
        nextById = new Map(nextById);
        byIdChanged = true;
      }
      nextById.set(message.id, nextMessage);
    }

    if (!hasMessage) {
      if (!orderChanged) {
        nextOrder = [...nextOrder];
        orderChanged = true;
      }
      const insertIndex = findUiMessageInsertIndex(
        nextOrderedMessages,
        nextMessage
      );
      nextOrder.splice(insertIndex, 0, nextMessage.id);
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
      nextOrderedMessages.splice(insertIndex, 0, nextMessage);
      continue;
    }

    if (prevMessage !== nextMessage && index !== undefined) {
      if (!orderedMessagesChanged) {
        nextOrderedMessages = [...nextOrderedMessages];
        orderedMessagesChanged = true;
      }
      nextOrderedMessages[index] = nextMessage;
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
    const nextMessage =
      prevMessage && prevMessage !== message
        ? mergeMessageSnapshots(prevMessage, message)
        : message;

    if (prevMessage !== nextMessage) {
      if (!byIdChanged) {
        nextById = new Map(nextById);
        byIdChanged = true;
      }
      nextById.set(message.id, nextMessage);
      if (index !== undefined) {
        if (!orderedMessagesChanged) {
          nextOrderedMessages = [...nextOrderedMessages];
          orderedMessagesChanged = true;
        }
        nextOrderedMessages[index] = nextMessage;
      }
    }

    if (!(hasMessage || seenPrepended.has(message.id))) {
      prependMessages.push(nextMessage);
      seenPrepended.add(nextMessage.id);
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

function replaceMessageAtKnownIndex(
  state: MessageState,
  nextMessage: UIMessage
): MessageState {
  const currentMessage = state.byId.get(nextMessage.id);
  if (currentMessage === nextMessage) {
    return state;
  }

  const index = state.indexById.get(nextMessage.id);
  if (index === undefined) {
    return mergeMessagesIntoState(state, [nextMessage]);
  }

  const nextById = new Map(state.byId);
  nextById.set(nextMessage.id, nextMessage);

  const nextOrderedMessages = [...state.orderedMessages];
  nextOrderedMessages[index] = nextMessage;

  return {
    byId: nextById,
    order: state.order,
    indexById: state.indexById,
    orderedMessages: nextOrderedMessages,
  };
}

/**
 * Apply part-level stream updates. If an update cannot be applied safely
 * without regressing already newer state, keep the current state and wait for
 * the next authoritative `ui_message` snapshot.
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
      parts: [attachPartId(update.part, update.partId)],
      ...(typeof update.createdAt === "number"
        ? { createdAt: update.createdAt }
        : {}),
    };
    return mergeMessagesIntoState(state, [created]);
  }

  const nextParts = [...existing.parts];
  const incomingPart = attachPartId(update.part, update.partId);
  const identityIndex = findPartIndexByIdentity({
    parts: nextParts,
    part: incomingPart,
    partId: update.partId,
  });
  if (update.isNew) {
    if (update.partIndex < 0) {
      return state;
    }
    if (update.partIndex === nextParts.length) {
      nextParts.push(incomingPart);
    } else if (update.partIndex < nextParts.length) {
      const existingPart = nextParts[update.partIndex];
      if (
        existingPart &&
        existingPart.type !== incomingPart.type &&
        shouldRecoverMissingPartFromUpdate(incomingPart)
      ) {
        if (identityIndex >= 0) {
          const recoveredParts = replacePartAtIndex(
            nextParts,
            identityIndex,
            incomingPart
          );
          if (recoveredParts === nextParts) {
            return state;
          }
          if (recoveredParts) {
            const nextMessage: UIMessage = {
              ...existing,
              parts: recoveredParts,
            };
            return replaceMessageAtKnownIndex(state, nextMessage);
          }
        }
        nextParts.push(incomingPart);
      } else {
        const nextPart = attachPartId(incomingPart, readPartId(existingPart));
        if (existingPart && areStructurallyEqualParts(existingPart, nextPart)) {
          return state;
        }
        if (existingPart && shouldKeepExistingPart(existingPart, nextPart)) {
          if (update.partIndex === 0) {
            return state;
          }
          nextParts.push(nextPart);
        } else {
          nextParts[update.partIndex] = nextPart;
        }
      }
    } else if (identityIndex >= 0) {
      const existingPart = nextParts[identityIndex];
      const nextPart = attachPartId(incomingPart, readPartId(existingPart));
      if (existingPart && areStructurallyEqualParts(existingPart, nextPart)) {
        return state;
      }
      nextParts[identityIndex] = nextPart;
    } else {
      // Out-of-order isNew update beyond current array length.
      nextParts.push(incomingPart);
    }
  } else {
    if (update.partIndex < 0) {
      return state;
    }
    if (update.partIndex < nextParts.length) {
      const existingPart = nextParts[update.partIndex];
      if (
        existingPart &&
        existingPart.type !== incomingPart.type &&
        shouldRecoverMissingPartFromUpdate(incomingPart)
      ) {
        if (identityIndex >= 0) {
          const recoveredParts = replacePartAtIndex(
            nextParts,
            identityIndex,
            incomingPart
          );
          if (recoveredParts === nextParts) {
            return state;
          }
          if (recoveredParts) {
            const nextMessage: UIMessage = {
              ...existing,
              parts: recoveredParts,
            };
            return replaceMessageAtKnownIndex(state, nextMessage);
          }
        }
        nextParts.push(incomingPart);
      } else {
        const nextPart = attachPartId(incomingPart, readPartId(existingPart));
        if (
          existingPart &&
          !areStructurallyEqualParts(existingPart, nextPart) &&
          shouldKeepExistingPart(existingPart, nextPart)
        ) {
          return state;
        }
        if (existingPart && areStructurallyEqualParts(existingPart, nextPart)) {
          return state;
        }
        nextParts[update.partIndex] = nextPart;
      }
    } else if (identityIndex >= 0) {
      const existingPart = nextParts[identityIndex];
      const nextPart = attachPartId(incomingPart, readPartId(existingPart));
      if (
        existingPart &&
        !areStructurallyEqualParts(existingPart, nextPart) &&
        shouldKeepExistingPart(existingPart, nextPart)
      ) {
        return state;
      }
      if (existingPart && areStructurallyEqualParts(existingPart, nextPart)) {
        return state;
      }
      nextParts[identityIndex] = nextPart;
    } else if (shouldRecoverMissingPartFromUpdate(incomingPart)) {
      nextParts.push(incomingPart);
    } else {
      return state;
    }
  }

  const nextMessage: UIMessage = {
    ...existing,
    parts: nextParts,
  };
  return replaceMessageAtKnownIndex(state, nextMessage);
};

function finalizeToolPartAfterReady(
  part: Extract<UIMessage["parts"][number], { type: `tool-${string}` }>
): UIMessage["parts"][number] {
  if (part.state === "approval-requested") {
    return finalizeToolPartAsCancelled(part);
  }
  return finalizeToolPartAsPreliminaryOutput(part);
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
 * Check whether the message has any tool part waiting for user approval.
 * Used to guard against premature finalization of permission-related messages.
 */
export function messageHasPendingApproval(message: UIMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state === "approval-requested"
  );
}

/**
 * Force-close lingering streaming parts after server emits terminal readiness
 * status for the turn.
 *
 * Skips messages that contain `approval-requested` tool parts to prevent
 * premature finalization from destroying live permission state.
 */
export const finalizeStreamingMessagesInState = (
  state: MessageState
): MessageState => {
  const finalized: UIMessage[] = [];
  for (const message of state.orderedMessages) {
    // Never finalize a message that is awaiting user approval.
    // Premature finalization would convert approval-requested → output-cancelled
    // which blocks later live permission events via the anti-regression guard.
    if (messageHasPendingApproval(message)) {
      continue;
    }
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
