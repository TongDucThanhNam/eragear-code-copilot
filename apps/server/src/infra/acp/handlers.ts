import type * as acp from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../shared/types/ports";
import { createPermissionHandler } from "./permission";
import { createToolCallHandlers } from "./tool-calls";
import { createSessionUpdateHandler, type SessionBuffering } from "./update";

export function createSessionHandlers(params: {
  chatId: string;
  buffer: SessionBuffering;
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
    async sessionUpdate(params: acp.SessionNotification) {
      await handleSessionUpdate({
        chatId,
        buffer,
        isReplayingHistory: getIsReplaying(),
        update: params.update,
      });
    },

    async requestPermission(
      params: acp.RequestPermissionRequest
    ): Promise<acp.RequestPermissionResponse> {
      return await handlePermissionRequest({
        chatId,
        isReplayingHistory: getIsReplaying(),
        request: params,
      });
    },

    async readTextFile(params: acp.ReadTextFileRequest) {
      return await toolCalls.readTextFileForChat(chatId, params);
    },

    async writeTextFile(params: acp.WriteTextFileRequest) {
      return await toolCalls.writeTextFileForChat(chatId, params);
    },

    async createTerminal(params: acp.CreateTerminalRequest) {
      return await toolCalls.createTerminal(chatId, params);
    },

    async waitForTerminalExit(params: acp.WaitForTerminalExitRequest) {
      return await toolCalls.waitForTerminalExit(chatId, params);
    },

    async terminalOutput(params: acp.TerminalOutputRequest) {
      return await toolCalls.terminalOutput(chatId, params);
    },

    async killTerminal(params: acp.KillTerminalCommandRequest) {
      return await toolCalls.killTerminal(chatId, params);
    },

    async releaseTerminal(params: acp.ReleaseTerminalRequest) {
      return await toolCalls.releaseTerminal(chatId, params);
    },
  };
}
