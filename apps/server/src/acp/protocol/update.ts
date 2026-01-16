import type * as acp from "@agentclientprotocol/sdk";
import { broadcastToSession, chats } from "../../session/events";
import { appendMessage, updateSessionMetadata } from "../../session/storage";
import { createId } from "../../utils/id";

export type LegacySessionUpdate = { sessionUpdate: "turn_end" | "prompt_end" };
export type SessionUpdateWithLegacy = acp.SessionUpdate | LegacySessionUpdate;

function contentToText(content: acp.ContentBlock) {
	if (content.type !== "text") return "";
	return content.text;
}

function isReplayChunk(update: SessionUpdateWithLegacy) {
	return (
		update.sessionUpdate === "user_message_chunk" ||
		update.sessionUpdate === "agent_message_chunk" ||
		update.sessionUpdate === "agent_thought_chunk"
	);
}

export class SessionBuffering {
	private content = "";
	private reasoning = "";
	private messageId: string | null = null;
	replayEventCount = 0;

	appendContent(text: string) {
		this.appendText("content", text);
	}

	appendReasoning(text: string) {
		this.appendText("reasoning", text);
	}

	flush() {
		if (!this.hasContent()) {
			this.reset();
			return null;
		}

		const messageId = this.messageId ?? createId("msg");
		const content = this.content;
		const reasoning = this.reasoning || undefined;
		this.reset();

		return { id: messageId, content, reasoning };
	}

	hasContent() {
		return this.content.length > 0 || this.reasoning.length > 0;
	}

	reset() {
		this.content = "";
		this.reasoning = "";
		this.messageId = null;
	}

	private appendText(target: "content" | "reasoning", text: string) {
		if (!text) return;
		this[target] += text;
		if (!this.messageId) {
			this.messageId = createId("msg");
		}
	}
}

export function handleSessionUpdate(params: {
	chatId: string;
	buffer: SessionBuffering;
	isReplayingHistory: boolean;
	update: SessionUpdateWithLegacy;
}) {
	const { chatId, buffer, isReplayingHistory, update } = params;

	if (isReplayingHistory && isReplayChunk(update)) {
		buffer.replayEventCount += 1;
	}

	if (!isReplayingHistory) {
		if (update.sessionUpdate === "agent_message_chunk") {
			buffer.appendContent(contentToText(update.content));
		}

		if (update.sessionUpdate === "agent_thought_chunk") {
			buffer.appendReasoning(contentToText(update.content));
		}
	}

	if (
		update.sessionUpdate === "turn_end" ||
		update.sessionUpdate === "prompt_end"
	) {
		const message = buffer.flush();
		if (!isReplayingHistory && message) {
			appendMessage(chatId, {
				id: message.id,
				role: "assistant",
				content: message.content,
				reasoning: message.reasoning,
				timestamp: Date.now(),
			});
		}
	}

	if (update.sessionUpdate === "current_mode_update") {
		const session = chats.get(chatId);
		if (session?.modes) {
			session.modes.currentModeId = update.modeId;
		}
		updateSessionMetadata(chatId, { modeId: update.modeId });
		console.log(`[Server] Received mode update: ${update.modeId}`);
		broadcastToSession(chatId, {
			type: "current_mode_update",
			modeId: update.modeId,
		});
		return;
	}

	if (update.sessionUpdate === "available_commands_update") {
		const session = chats.get(chatId);
		if (session) {
			session.commands = update.availableCommands;
		}
		console.log(`[Server] Received commands update`, update.availableCommands);
		broadcastToSession(chatId, { type: "session_update", update });
		return;
	}

	if (update.sessionUpdate !== "agent_message_chunk") {
		console.log(
			`[Server] Received session update: ${update.sessionUpdate}`,
			JSON.stringify(update, null, 2),
		);
	}

	broadcastToSession(chatId, { type: "session_update", update });
}
