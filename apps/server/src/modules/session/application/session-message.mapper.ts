import type { UIMessage } from "@repo/shared";
import type {
  StoredContentBlock,
  StoredMessage,
} from "@/shared/types/session.types";
import {
  buildAssistantMessageFromBlocks,
  buildUserMessageFromBlocks,
} from "@/shared/utils/ui-message.util";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const USER_COMPACTED_TEXT = "[User message compacted for local retention]";
const ASSISTANT_COMPACTED_TEXT =
  "[Assistant message compacted for local retention]";

export class SessionMessageMapper {
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  async broadcastStoredMessage(
    chatId: string,
    message: StoredMessage
  ): Promise<void> {
    const uiMessage = this.toUiMessage(message);
    if (!uiMessage) {
      return;
    }

    const session = this.sessionRuntime.get(chatId);
    if (session) {
      session.uiState.messages.set(uiMessage.id, uiMessage);
    }

    await this.sessionRuntime.broadcast(chatId, {
      type: "ui_message",
      message: uiMessage,
    });
  }

  private toUiMessage(message: StoredMessage): UIMessage | null {
    if (message.parts && message.parts.length > 0) {
      return {
        id: message.id,
        role: message.role,
        parts: message.parts,
      };
    }

    const contentBlocks = this.resolveContentBlocks(message);
    if (message.role === "user") {
      if (contentBlocks.length === 0) {
        return null;
      }
      return buildUserMessageFromBlocks({
        messageId: message.id,
        contentBlocks,
      });
    }

    return buildAssistantMessageFromBlocks({
      messageId: message.id,
      contentBlocks,
      reasoningBlocks: this.resolveReasoningBlocks(message),
    });
  }

  private resolveContentBlocks(message: StoredMessage): StoredContentBlock[] {
    if (message.contentBlocks) {
      return message.contentBlocks;
    }
    if (message.content) {
      return [{ type: "text", text: message.content }];
    }
    if (message.isCompacted) {
      return [
        {
          type: "text",
          text:
            message.role === "assistant"
              ? ASSISTANT_COMPACTED_TEXT
              : USER_COMPACTED_TEXT,
        },
      ];
    }
    return [];
  }

  private resolveReasoningBlocks(message: StoredMessage): StoredContentBlock[] {
    if (message.reasoningBlocks) {
      return message.reasoningBlocks;
    }
    if (message.reasoning) {
      return [{ type: "text", text: message.reasoning }];
    }
    return [];
  }
}
