import type { SessionRepositoryPort } from "#runtime/modules/session";
import type { AcpManagerResultReaderPort } from "../application/acp-manager-session-coordinator.service";

export class SessionRepositoryAcpManagerResultReaderAdapter
  implements AcpManagerResultReaderPort
{
  private readonly sessions: SessionRepositoryPort;

  constructor(sessions: SessionRepositoryPort) {
    this.sessions = sessions;
  }

  async latestAssistantText(input: {
    userId: string;
    chatId: string;
  }): Promise<string | null> {
    const page = await this.sessions.getMessagesPage(
      input.chatId,
      input.userId,
      {
        direction: "backward",
        limit: 50,
        includeCompacted: false,
      }
    );
    const assistant = [...page.messages]
      .sort((left, right) => right.timestamp - left.timestamp)
      .find(
        (message) => message.role === "assistant" && message.content.trim()
      );
    return assistant?.content.slice(-64_000) ?? null;
  }
}
