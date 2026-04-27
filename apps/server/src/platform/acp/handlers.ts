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
import { ENV } from "@/config/environment";
import type {
  SessionBufferingPort,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import {
  diagnosticsLog,
  estimateJsonBytes,
  isDiagnosticsEnabled,
} from "@/shared/utils/diagnostics.util";
import { withObservabilityContext } from "@/shared/utils/observability-context.util";
import { createPermissionHandler } from "./permission";
import { serializeRawPayloadForLog } from "./raw-payload-log.util";
import { createToolCallHandlers } from "./tool-calls";
import { createSessionUpdateHandler } from "./update";
import { parseSessionUpdatePayload } from "./update-schema";

const logger = createLogger("Debug");

/** Maximum characters to sample from raw ACP payloads for debug logging. */
const RAW_PAYLOAD_LOG_LIMIT = 4000;

/** [DIAG] Helper: capture ACP update arrival timing and payload metadata. */
interface DiagUpdateContext {
  chatId: string;
  updateType: string;
  start: number;
  payloadBytes: number | null;
}

function diagnosticsBeginUpdate(
  chatId: string,
  update: { sessionUpdate: string }
): DiagUpdateContext | null {
  if (!isDiagnosticsEnabled()) {
    return null;
  }
  const payloadBytes = estimateJsonBytes(update);
  diagnosticsLog("acp-update-received", {
    chatId,
    updateType: update.sessionUpdate,
    payloadBytes,
  });
  return {
    chatId,
    updateType: update.sessionUpdate,
    start: performance.now(),
    payloadBytes,
  };
}

function diagnosticsEndUpdate(ctx: DiagUpdateContext | null): void {
  if (!ctx) {
    return;
  }
  const duration = performance.now() - ctx.start;
  diagnosticsLog("acp-update-handler-done", {
    chatId: ctx.chatId,
    updateType: ctx.updateType,
    payloadBytes: ctx.payloadBytes,
    durationMs: duration.toFixed(2),
  });
}

function createCapabilityDisabledError(method: string): never {
  throw new Error(
    `${method} is disabled by server ACP capability policy. Enable the corresponding ACP tool setting before advertising this method to agents.`
  );
}

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
  permissionAutoResolver?: (input: {
    chatId: string;
    requestId: string;
  }) => Promise<void>;
}): acp.Client {
  const {
    chatId,
    buffer,
    getIsReplaying,
    sessionRuntime,
    sessionRepo,
    permissionAutoResolver,
  } = params;
  const handlePermissionRequest = createPermissionHandler(sessionRuntime, {
    autoResolver: permissionAutoResolver,
  });
  const handleSessionUpdate = createSessionUpdateHandler(
    sessionRuntime,
    sessionRepo
  );
  const toolCalls = createToolCallHandlers(sessionRuntime);
  const withSessionLogContext = async <T>(
    work: () => Promise<T>
  ): Promise<T> => {
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
            rawPayload = serializeRawPayloadForLog(
              params?.update ?? null
            ).slice(0, RAW_PAYLOAD_LOG_LIMIT);
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

        // [DIAG] Measure incoming ACP update payload size, type, and handler duration
        const diagCtx = diagnosticsBeginUpdate(chatId, validatedUpdate);

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
          });

          // [DIAG] Log handler duration
          diagnosticsEndUpdate(diagCtx);
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
        if (!ENV.acpFsWriteEnabled) {
          createCapabilityDisabledError("fs/write_text_file");
        }
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
        if (!ENV.acpTerminalEnabled) {
          createCapabilityDisabledError("terminal/create");
        }
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
// biome-ignore lint/performance/noBarrelFile: Re-export required for platform API surface
export { serializeRawPayloadForLog } from "./raw-payload-log.util";
