/**
 * ACP Session Handlers
 *
 * Creates the client handlers for ACP session events.
 * Handles session updates, permission requests, and tool calls (file operations,
 * terminal management) for agent processes.
 *
 * @module infra/acp/handlers
 */

import type * as acp from "@agentclientprotocol/sdk";
import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import { withObservabilityContext } from "@/shared/utils/observability-context.util";
import { createPermissionHandler } from "./permission";
import { createToolCallHandlers } from "./tool-calls";
import { createSessionUpdateHandler } from "./update";
import { parseSessionUpdatePayload } from "./update-schema";

const logger = createLogger("Debug");

/** Maximum characters to sample from raw ACP payloads for debug logging. */
const RAW_PAYLOAD_LOG_LIMIT = 4000;
const RAW_PAYLOAD_STRING_LIMIT = 240;
const RAW_PAYLOAD_MAX_DEPTH = 4;
const RAW_PAYLOAD_MAX_ARRAY_ITEMS = 20;
const RAW_REDACTED_KEYS = new Set([
  "text",
  "blob",
  "data",
  "input",
  "output",
  "rawInput",
  "rawOutput",
]);

/**
 * Creates ACP client handlers for managing a session
 *
 * @param params - Handler creation parameters
 * @param params.chatId - The session/chat identifier
 * @param params.buffer - Session buffering for message aggregation
 * @param params.getIsReplaying - Function to check if replaying history
 * @param params.sessionRuntime - Runtime port for session operations
 * @param params.sessionRepo - Repository port for session persistence
 * @returns ACP Client instance with all event handlers
 *
 * @example
 * ```typescript
 * const handlers = createSessionHandlers({
 *   chatId: "session-123",
 *   buffer: new SessionBuffering(),
 *   getIsReplaying: () => false,
 *   sessionRuntime: runtimePort,
 *   sessionRepo: repositoryPort,
 * });
 * ```
 */
export function createSessionHandlers(params: {
  chatId: string;
  buffer: SessionBufferingPort;
  getIsReplaying: () => boolean;
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
}): acp.Client {
  const { chatId, buffer, getIsReplaying, sessionRuntime, sessionRepo } =
    params;
  const handlePermissionRequest = createPermissionHandler(sessionRuntime);
  const handleSessionUpdate = createSessionUpdateHandler(
    sessionRuntime,
    sessionRepo
  );
  const toolCalls = createToolCallHandlers(sessionRuntime);
  const withSessionLogContext = async <T>(work: () => Promise<T>): Promise<T> => {
    const sessionUserId = sessionRuntime.get(chatId)?.userId;
    return await withObservabilityContext(
      {
        source: "background",
        chatId,
        userId: sessionUserId,
      },
      work
    );
  };
  return {
    /** Handles session updates (messages, tool calls, plans, etc.) */
    async sessionUpdate(params: acp.SessionNotification) {
      return await withSessionLogContext(async () => {
        if (shouldEmitRuntimeLog("debug")) {
          let rawPayload = "";
          try {
            rawPayload = serializeRawPayloadForLog(params?.update ?? null).slice(
              0,
              RAW_PAYLOAD_LOG_LIMIT
            );
          } catch {
            rawPayload = "[unserializable]";
          }
          logger.debug("ACP raw session update", {
            chatId,
            rawType: params?.update?.sessionUpdate,
            rawPayloadLength: rawPayload.length,
            rawPayload,
          });
        }

        const validatedUpdate = parseSessionUpdatePayload(params?.update);
        if (!validatedUpdate) {
          logger.warn("Dropped invalid ACP session update payload", {
            chatId,
          });
          return;
        }
        logger.debug("ACP handler sessionUpdate", {
          chatId,
          hasUpdate: true,
          updateType: validatedUpdate.sessionUpdate,
        });
        try {
          await handleSessionUpdate({
            chatId,
            buffer,
            isReplayingHistory: getIsReplaying(),
            update: validatedUpdate,
          })
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error("ACP session update pipeline failed", undefined, {
            chatId,
            updateType: validatedUpdate.sessionUpdate,
            error: errorMessage,
          });
          await sessionRuntime
            .broadcast(chatId, {
              type: "error",
              error: `Session update failed: ${errorMessage}`,
            })
            .catch(() => undefined);
          const session = sessionRuntime.get(chatId);
          if (session) {
            await new SessionRuntimeEntity(session)
              .markError({
                chatId,
                broadcast: sessionRuntime.broadcast.bind(sessionRuntime),
              })
              .catch(() => undefined);
          }
        }
      });
    },

    /** Handles permission requests from the agent */
    async requestPermission(
      params: acp.RequestPermissionRequest
    ): Promise<acp.RequestPermissionResponse> {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler requestPermission", {
          chatId,
          toolCallId: params.toolCall.toolCallId,
          toolKind: params.toolCall.kind,
          toolTitle: params.toolCall.title,
        });
        return await handlePermissionRequest({
          chatId,
          isReplayingHistory: getIsReplaying(),
          request: params,
        });
      });
    },

    /** Handles file reading requests */
    async readTextFile(params: acp.ReadTextFileRequest) {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler readTextFile", {
          chatId,
          path: params.path,
        });
        return await toolCalls.readTextFileForChat(chatId, params);
      });
    },

    /** Handles file writing requests */
    async writeTextFile(params: acp.WriteTextFileRequest) {
      return await withSessionLogContext(async () => {
        const hasContent = typeof params.content === "string";
        logger.debug("ACP handler writeTextFile", {
          chatId,
          path: params.path,
          hasContent,
          contentLength: hasContent ? params.content.length : undefined,
        });
        return await toolCalls.writeTextFileForChat(chatId, params);
      });
    },

    /** Handles terminal creation */
    async createTerminal(params: acp.CreateTerminalRequest) {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler createTerminal", {
          chatId,
          command: params.command,
          argsCount: params.args?.length ?? 0,
        });
        return await toolCalls.createTerminal(chatId, params);
      });
    },

    /** Handles waiting for terminal exit */
    async waitForTerminalExit(params: acp.WaitForTerminalExitRequest) {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler waitForTerminalExit", {
          chatId,
          terminalId: params.terminalId,
        });
        return await toolCalls.waitForTerminalExit(chatId, params);
      });
    },

    /** Handles terminal output retrieval */
    async terminalOutput(params: acp.TerminalOutputRequest) {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler terminalOutput", {
          chatId,
          terminalId: params.terminalId,
        });
        return await toolCalls.terminalOutput(chatId, params);
      });
    },

    /** Handles terminal termination */
    async killTerminal(params: acp.KillTerminalCommandRequest) {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler killTerminal", {
          chatId,
          terminalId: params.terminalId,
        });
        return await toolCalls.killTerminal(chatId, params);
      });
    },

    /** Handles terminal resource release */
    async releaseTerminal(params: acp.ReleaseTerminalRequest) {
      return await withSessionLogContext(async () => {
        logger.debug("ACP handler releaseTerminal", {
          chatId,
          terminalId: params.terminalId,
        });
        return await toolCalls.releaseTerminal(chatId, params);
      });
    },
  };
}

export function serializeRawPayloadForLog(value: unknown): string {
  return JSON.stringify(normalizeRawPayloadForLog(value));
}

function normalizeRawPayloadForLog(
  value: unknown,
  depth = 0,
  active = new WeakSet<object>()
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return truncateRawPayloadString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (depth >= RAW_PAYLOAD_MAX_DEPTH) {
    return "[max-depth]";
  }
  if (active.has(value)) {
    return "[circular]";
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const limited = value.slice(0, RAW_PAYLOAD_MAX_ARRAY_ITEMS);
      const normalized = limited.map((item) =>
        normalizeRawPayloadForLog(item, depth + 1, active)
      );
      if (value.length > RAW_PAYLOAD_MAX_ARRAY_ITEMS) {
        normalized.push(
          `[...${value.length - RAW_PAYLOAD_MAX_ARRAY_ITEMS} more items]`
        );
      }
      return normalized;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (RAW_REDACTED_KEYS.has(key)) {
        normalized[key] = redactRawPayloadValue(entryValue);
        continue;
      }
      normalized[key] = normalizeRawPayloadForLog(entryValue, depth + 1, active);
    }
    return normalized;
  } finally {
    active.delete(value);
  }
}

function truncateRawPayloadString(value: string): string {
  if (value.length <= RAW_PAYLOAD_STRING_LIMIT) {
    return value;
  }
  return `${value.slice(0, RAW_PAYLOAD_STRING_LIMIT)}...[${value.length} chars]`;
}

function redactRawPayloadValue(value: unknown): string | unknown {
  if (typeof value === "string") {
    return `[redacted:${value.length} chars]`;
  }
  if (Array.isArray(value)) {
    return `[redacted:array(${value.length})]`;
  }
  if (value && typeof value === "object") {
    return "[redacted:object]";
  }
  return value;
}
