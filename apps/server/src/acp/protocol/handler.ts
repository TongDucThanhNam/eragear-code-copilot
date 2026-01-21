import type * as acp from "@agentclientprotocol/sdk";
import { handlePermissionRequest } from "./permission";
import {
  createTerminal,
  killTerminal,
  readTextFileForChat,
  releaseTerminal,
  terminalOutput,
  waitForTerminalExit,
  writeTextFileForChat,
} from "./tool-calls";
import { handleSessionUpdate, type SessionBuffering } from "./update";

export { SessionBuffering } from "./update";

export function createSessionHandlers(
  chatId: string,
  buffer: SessionBuffering,
  getIsReplaying: () => boolean
): acp.Client {
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
      return await readTextFileForChat(chatId, params);
    },

    async writeTextFile(params: acp.WriteTextFileRequest) {
      return await writeTextFileForChat(chatId, params);
    },

    async createTerminal(params: acp.CreateTerminalRequest) {
      return await createTerminal(chatId, params);
    },

    async waitForTerminalExit(params: acp.WaitForTerminalExitRequest) {
      return await waitForTerminalExit(chatId, params);
    },

    async terminalOutput(params: acp.TerminalOutputRequest) {
      return await terminalOutput(chatId, params);
    },

    async killTerminal(params: acp.KillTerminalCommandRequest) {
      return await killTerminal(chatId, params);
    },

    async releaseTerminal(params: acp.ReleaseTerminalRequest) {
      return await releaseTerminal(chatId, params);
    },
  };
}
