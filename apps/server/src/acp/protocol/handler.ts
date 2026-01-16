import type * as acp from "@agentclientprotocol/sdk";
import { handlePermissionRequest } from "./permission";
import { handleSessionUpdate } from "./update";
import type { SessionBuffering } from "./update";
import {
	createTerminal,
	killTerminal,
	releaseTerminal,
	readTextFile,
	terminalOutput,
	waitForTerminalExit,
	writeTextFile,
} from "./tool-calls";

export { SessionBuffering } from "./update";

export function createSessionHandlers(
	chatId: string,
	buffer: SessionBuffering,
	getIsReplaying: () => boolean,
): acp.Client {
	return {
		async sessionUpdate(params: acp.SessionNotification) {
			handleSessionUpdate({
				chatId,
				buffer,
				isReplayingHistory: getIsReplaying(),
				update: params.update,
			});
		},

		async requestPermission(
			params: acp.RequestPermissionRequest,
		): Promise<acp.RequestPermissionResponse> {
			return handlePermissionRequest({
				chatId,
				isReplayingHistory: getIsReplaying(),
				request: params,
			});
		},

		readTextFile,
		writeTextFile,

		async createTerminal(params: acp.CreateTerminalRequest) {
			return createTerminal(chatId, params);
		},

		async waitForTerminalExit(params: acp.WaitForTerminalExitRequest) {
			return waitForTerminalExit(chatId, params);
		},

		async terminalOutput(params: acp.TerminalOutputRequest) {
			return terminalOutput(chatId, params);
		},

		async killTerminal(params: acp.KillTerminalCommandRequest) {
			return killTerminal(chatId, params);
		},

		async releaseTerminal(params: acp.ReleaseTerminalRequest) {
			return releaseTerminal(chatId, params);
		},
	};
}
