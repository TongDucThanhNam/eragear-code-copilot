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
import { createLogger } from "@/infra/logging/structured-logger";
import type { SessionBufferingPort } from "@/modules/session/application/ports/session-acp.port";
import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import { createPermissionHandler } from "./permission";
import { createToolCallHandlers } from "./tool-calls";
import { createSessionUpdateHandler } from "./update";

const logger = createLogger("Debug");

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
  return {
    /** Handles session updates (messages, tool calls, plans, etc.) */
    async sessionUpdate(params: acp.SessionNotification) {
      logger.debug("ACP handler sessionUpdate", {
        chatId,
        hasUpdate: Boolean(params?.update),
        updateType: params?.update?.sessionUpdate,
      });
      await handleSessionUpdate({
        chatId,
        buffer,
        isReplayingHistory: getIsReplaying(),
        update: params.update,
      });
    },

    /** Handles permission requests from the agent */
    async requestPermission(
      params: acp.RequestPermissionRequest
    ): Promise<acp.RequestPermissionResponse> {
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
    },

    /** Handles file reading requests */
    async readTextFile(params: acp.ReadTextFileRequest) {
      logger.debug("ACP handler readTextFile", {
        chatId,
        path: params.path,
      });
      return await toolCalls.readTextFileForChat(chatId, params);
    },

    /** Handles file writing requests */
    async writeTextFile(params: acp.WriteTextFileRequest) {
      const hasContent = typeof params.content === "string";
      logger.debug("ACP handler writeTextFile", {
        chatId,
        path: params.path,
        hasContent,
        contentLength: hasContent ? params.content.length : undefined,
      });
      return await toolCalls.writeTextFileForChat(chatId, params);
    },

    /** Handles terminal creation */
    async createTerminal(params: acp.CreateTerminalRequest) {
      logger.debug("ACP handler createTerminal", {
        chatId,
        command: params.command,
        argsCount: params.args?.length ?? 0,
      });
      return await toolCalls.createTerminal(chatId, params);
    },

    /** Handles waiting for terminal exit */
    async waitForTerminalExit(params: acp.WaitForTerminalExitRequest) {
      logger.debug("ACP handler waitForTerminalExit", {
        chatId,
        terminalId: params.terminalId,
      });
      return await toolCalls.waitForTerminalExit(chatId, params);
    },

    /** Handles terminal output retrieval */
    async terminalOutput(params: acp.TerminalOutputRequest) {
      logger.debug("ACP handler terminalOutput", {
        chatId,
        terminalId: params.terminalId,
      });
      return await toolCalls.terminalOutput(chatId, params);
    },

    /** Handles terminal termination */
    async killTerminal(params: acp.KillTerminalCommandRequest) {
      logger.debug("ACP handler killTerminal", {
        chatId,
        terminalId: params.terminalId,
      });
      return await toolCalls.killTerminal(chatId, params);
    },

    /** Handles terminal resource release */
    async releaseTerminal(params: acp.ReleaseTerminalRequest) {
      logger.debug("ACP handler releaseTerminal", {
        chatId,
        terminalId: params.terminalId,
      });
      return await toolCalls.releaseTerminal(chatId, params);
    },
  };
}
