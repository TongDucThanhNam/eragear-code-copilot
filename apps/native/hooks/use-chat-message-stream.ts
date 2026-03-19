import type { BroadcastEvent, UIMessage } from "@repo/shared";
import { findPendingPermission } from "@repo/shared";
import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/store/chat-store";

const STREAM_FLUSH_MS = 80;

interface MessagePartUpdatePayload {
  messageId: string;
  messageRole: UIMessage["role"];
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

function findMessagePartIndexByIdentity(params: {
  message: UIMessage;
  partIndex: number;
  partId?: string;
  part: Extract<BroadcastEvent, { type: "ui_message_part_removed" }>["part"];
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

export function useChatMessageStream({
  getMessageById,
}: UseChatMessageStreamParams) {
  const pendingMessagesRef = useRef<Map<string, UIMessage>>(new Map());
  const messageFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    return () => {
      if (messageFlushTimerRef.current) {
        clearTimeout(messageFlushTimerRef.current);
      }
    };
  }, []);

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

  const applyMessagesImmediate = useCallback(
    (message: UIMessage) => {
      if (messageFlushTimerRef.current) {
        clearTimeout(messageFlushTimerRef.current);
        messageFlushTimerRef.current = null;
      }
      pendingMessagesRef.current.set(message.id, message);
      flushMessages();
    },
    [flushMessages]
  );

  const scheduleMessagesUpdate = useCallback(
    (message: UIMessage) => {
      pendingMessagesRef.current.set(message.id, message);
      if (messageFlushTimerRef.current) {
        return;
      }
      messageFlushTimerRef.current = setTimeout(() => {
        messageFlushTimerRef.current = null;
        flushMessages();
      }, STREAM_FLUSH_MS);
    },
    [flushMessages]
  );

  const applyMessagePartUpdate = useCallback(
    (payload: MessagePartUpdatePayload) => {
      const current =
        pendingMessagesRef.current.get(payload.messageId) ??
        getMessageById(payload.messageId);
      if (!current) {
        if (!payload.isNew && payload.partIndex > 0) {
          return;
        }
        applyMessagesImmediate({
          id: payload.messageId,
          role: payload.messageRole,
          parts: [payload.part],
          ...(typeof payload.createdAt === "number"
            ? { createdAt: payload.createdAt }
            : {}),
        });
        return;
      }

      const nextParts = [...current.parts];
      if (payload.isNew) {
        if (payload.partIndex < 0) {
          return;
        }
        if (payload.partIndex <= nextParts.length) {
          if (payload.partIndex === nextParts.length) {
            nextParts.push(payload.part);
          } else {
            nextParts.splice(payload.partIndex, 0, payload.part);
          }
        } else {
          nextParts.push(payload.part);
        }
      } else {
        if (payload.partIndex < 0) {
          return;
        }
        if (payload.partIndex < nextParts.length) {
          nextParts[payload.partIndex] = payload.part;
        } else {
          nextParts.push(payload.part);
        }
      }

      const updated: UIMessage = { ...current, parts: nextParts };
      const partState =
        "state" in payload.part
          ? (payload.part as { state?: string }).state
          : undefined;
      if (partState === "streaming" || partState === "input-streaming") {
        scheduleMessagesUpdate(updated);
        return;
      }
      applyMessagesImmediate(updated);
    },
    [applyMessagesImmediate, getMessageById, scheduleMessagesUpdate]
  );

  const getMessageByIdWithPending = useCallback(
    (id: string) => pendingMessagesRef.current.get(id) ?? getMessageById(id),
    [getMessageById]
  );

  const applyMessagePartRemoval = useCallback(
    (payload: MessagePartRemovalPayload) => {
      const current =
        pendingMessagesRef.current.get(payload.messageId) ??
        getMessageById(payload.messageId);
      if (!current) {
        return;
      }
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
    if (messageFlushTimerRef.current) {
      clearTimeout(messageFlushTimerRef.current);
      messageFlushTimerRef.current = null;
    }
  }, []);

  return {
    applyMessagesImmediate,
    applyMessagePartUpdate,
    applyMessagePartRemoval,
    getMessageByIdWithPending,
    resetPendingMessages,
  };
}
