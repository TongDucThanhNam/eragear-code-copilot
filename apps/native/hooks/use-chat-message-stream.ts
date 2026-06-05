import type { BroadcastEvent, UIMessage } from "@repo/shared";
import { findPendingPermission } from "@repo/shared";
import { useCallback, useRef } from "react";
import { useChatStore } from "@/store/chat-store";

interface MessagePartUpdatePayload {
  messageId: string;
  messageRole: UIMessage["role"];
  partId?: string;
  partIndex: number;
  part: UIMessage["parts"][number];
  isNew: boolean;
  createdAt?: number;
}

interface MessagePartRemovalPayload {
  messageId: string;
  messageRole: UIMessage["role"];
  partIndex: number;
  partId?: string;
  part: Extract<BroadcastEvent, { type: "ui_message_part_removed" }>["part"];
}

interface UseChatMessageStreamParams {
  getMessageById: (id: string) => UIMessage | undefined;
}

function readPartId(part: UIMessage["parts"][number]): string | undefined {
  const id = (part as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function attachOptionalPartId(
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

function findMessagePartIndexByIdentity(params: {
  message: UIMessage;
  partIndex: number;
  partId?: string;
  part: UIMessage["parts"][number];
}): number {
  const { message, partIndex, partId, part } = params;
  if (
    typeof partId === "string" &&
    partId.length > 0 &&
    message.parts.some((candidate) => readPartId(candidate) === partId)
  ) {
    return message.parts.findIndex(
      (candidate) => readPartId(candidate) === partId
    );
  }
  if (partIndex >= 0 && partIndex < message.parts.length) {
    return partIndex;
  }
  if (part.type === "data-tool-locations") {
    const toolCallId = (part.data as { toolCallId?: unknown } | undefined)
      ?.toolCallId;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      return -1;
    }
    return message.parts.findIndex((candidate) => {
      if (candidate.type !== "data-tool-locations") {
        return false;
      }
      const candidateToolCallId = (
        candidate.data as { toolCallId?: unknown } | undefined
      )?.toolCallId;
      return candidateToolCallId === toolCallId;
    });
  }
  return -1;
}

export function removeMessagePartFromMessage(params: {
  message: UIMessage;
  partIndex: number;
  partId?: string;
  part: Extract<BroadcastEvent, { type: "ui_message_part_removed" }>["part"];
}): UIMessage | null {
  const resolvedIndex = findMessagePartIndexByIdentity(params);
  if (resolvedIndex < 0) {
    return null;
  }
  return {
    ...params.message,
    parts: params.message.parts.filter((_, index) => index !== resolvedIndex),
  };
}

function getPartState(part: UIMessage["parts"][number]): string | undefined {
  return "state" in part ? (part as { state?: string }).state : undefined;
}

function isDeferredStreamingPart(part: UIMessage["parts"][number]): boolean {
  const state = getPartState(part);
  return state === "streaming" || state === "input-streaming";
}

function isTextualPart(
  part: UIMessage["parts"][number]
): part is Extract<UIMessage["parts"][number], { type: "text" | "reasoning" }> {
  return part.type === "text" || part.type === "reasoning";
}

export function shouldDeferStreamingPartUpdate(params: {
  current: UIMessage | undefined;
  partId?: string;
  partIndex: number;
  part: UIMessage["parts"][number];
}): boolean {
  if (!isDeferredStreamingPart(params.part)) {
    return false;
  }

  const currentPartIndex = params.current
    ? findMessagePartIndexByIdentity({
        message: params.current,
        partIndex: params.partIndex,
        partId: params.partId,
        part: params.part,
      })
    : -1;
  const currentPart =
    currentPartIndex >= 0 ? params.current?.parts[currentPartIndex] : undefined;
  if (
    currentPart &&
    isTextualPart(currentPart) &&
    isTextualPart(params.part) &&
    currentPart.state === "done" &&
    params.part.text.length > currentPart.text.length
  ) {
    // Late completed-turn tails can arrive as streaming snapshots after the
    // client has already finalized locally. Apply those immediately to avoid
    // truncating the end of the assistant response.
    return false;
  }

  return true;
}

export function applyPartUpdateToMessage(
  current: UIMessage,
  payload: MessagePartUpdatePayload
): UIMessage | null {
  const nextParts = [...current.parts];
  const incomingPart = attachOptionalPartId(payload.part, payload.partId);
  if (payload.isNew) {
    if (payload.partIndex < 0) {
      return null;
    }
    if (payload.partIndex <= nextParts.length) {
      if (payload.partIndex === nextParts.length) {
        nextParts.push(incomingPart);
      } else {
        nextParts.splice(payload.partIndex, 0, incomingPart);
      }
    } else {
      nextParts.push(incomingPart);
    }
    return { ...current, parts: nextParts };
  }

  if (payload.partIndex < 0) {
    return null;
  }
  const resolvedIndex = findMessagePartIndexByIdentity({
    message: current,
    partIndex: payload.partIndex,
    partId: payload.partId,
    part: payload.part,
  });
  if (resolvedIndex >= 0) {
    nextParts[resolvedIndex] = incomingPart;
  } else {
    nextParts.push(incomingPart);
  }
  return { ...current, parts: nextParts };
}

export function useChatMessageStream({
  getMessageById,
}: UseChatMessageStreamParams) {
  const pendingMessagesRef = useRef<Map<string, UIMessage>>(new Map());
  const deferredStreamingMessagesRef = useRef<Map<string, UIMessage>>(
    new Map()
  );

  const syncPendingPermission = useCallback(() => {
    const store = useChatStore.getState();
    store.setPendingPermission(
      findPendingPermission(store.getMessagesForPermission())
    );
  }, []);

  const flushMessages = useCallback(() => {
    const pending = pendingMessagesRef.current;
    if (pending.size === 0) {
      return;
    }
    useChatStore.getState().upsertMessages(Array.from(pending.values()));
    pending.clear();
    syncPendingPermission();
  }, [syncPendingPermission]);

  const flushDeferredStreamingMessages = useCallback(() => {
    const deferred = deferredStreamingMessagesRef.current;
    if (deferred.size === 0) {
      return;
    }
    useChatStore.getState().upsertMessages(Array.from(deferred.values()));
    deferred.clear();
    syncPendingPermission();
  }, [syncPendingPermission]);

  const applyMessagesImmediate = useCallback(
    (message: UIMessage) => {
      deferredStreamingMessagesRef.current.delete(message.id);
      pendingMessagesRef.current.set(message.id, message);
      flushMessages();
    },
    [flushMessages]
  );

  const applyMessagePartUpdate = useCallback(
    (payload: MessagePartUpdatePayload) => {
      const current =
        pendingMessagesRef.current.get(payload.messageId) ??
        deferredStreamingMessagesRef.current.get(payload.messageId) ??
        getMessageById(payload.messageId);
      if (!current) {
        if (!payload.isNew && payload.partIndex > 0) {
          return;
        }
        const nextMessage: UIMessage = {
          id: payload.messageId,
          role: payload.messageRole,
          parts: [attachOptionalPartId(payload.part, payload.partId)],
          ...(typeof payload.createdAt === "number"
            ? { createdAt: payload.createdAt }
            : {}),
        };
        if (shouldDeferStreamingPartUpdate({ ...payload, current })) {
          deferredStreamingMessagesRef.current.set(
            payload.messageId,
            nextMessage
          );
          return;
        }
        applyMessagesImmediate(nextMessage);
        return;
      }

      const updated = applyPartUpdateToMessage(current, payload);
      if (!updated) {
        return;
      }
      if (shouldDeferStreamingPartUpdate({ ...payload, current })) {
        deferredStreamingMessagesRef.current.set(payload.messageId, updated);
        return;
      }
      applyMessagesImmediate(updated);
    },
    [applyMessagesImmediate, getMessageById]
  );

  const getMessageByIdWithPending = useCallback(
    (id: string) =>
      pendingMessagesRef.current.get(id) ??
      deferredStreamingMessagesRef.current.get(id) ??
      getMessageById(id),
    [getMessageById]
  );

  const applyMessagePartRemoval = useCallback(
    (payload: MessagePartRemovalPayload) => {
      const current =
        pendingMessagesRef.current.get(payload.messageId) ??
        deferredStreamingMessagesRef.current.get(payload.messageId) ??
        getMessageById(payload.messageId);
      if (!current) {
        return;
      }
      deferredStreamingMessagesRef.current.delete(payload.messageId);
      const updated = removeMessagePartFromMessage({
        message: current,
        partIndex: payload.partIndex,
        partId: payload.partId,
        part: payload.part,
      });
      if (!updated) {
        return;
      }
      applyMessagesImmediate(updated);
    },
    [applyMessagesImmediate, getMessageById]
  );

  const resetPendingMessages = useCallback(() => {
    pendingMessagesRef.current.clear();
    deferredStreamingMessagesRef.current.clear();
  }, []);

  return {
    applyMessagesImmediate,
    applyMessagePartUpdate,
    applyMessagePartRemoval,
    flushDeferredStreamingMessages,
    getMessageByIdWithPending,
    resetPendingMessages,
  };
}
