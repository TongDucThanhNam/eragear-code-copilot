import { buildPrompt } from "../../../services/ai-bridge";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

export class SendMessageService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort
  ) {}

  async execute(input: {
    chatId: string;
    text: string;
    images?: Array<{ base64: string; mimeType: string }>;
    resources?: Array<{
      uri: string;
      text?: string;
      blob?: string;
      mimeType?: string;
    }>;
  }) {
    const session = this.sessionRuntime.get(input.chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msgTimestamp = Date.now();

    this.sessionRepo.appendMessage(input.chatId, {
      id: msgId,
      role: "user",
      content: input.text,
      timestamp: msgTimestamp,
    });

    this.sessionRuntime.broadcast(input.chatId, {
      type: "user_message",
      id: msgId,
      text: input.text,
      timestamp: msgTimestamp,
    });

    const prompt = buildPrompt({
      text: input.text,
      images: input.images,
      resources: input.resources,
    });

    const res = await session.conn.prompt({
      sessionId: session.sessionId,
      prompt,
    });

    if (session.buffer) {
      const message = session.buffer.flush();
      if (message) {
        this.sessionRepo.appendMessage(input.chatId, {
          id: message.id,
          role: "assistant",
          content: message.content,
          reasoning: message.reasoning,
          timestamp: Date.now(),
        });
      }
    }

    this.sessionRuntime.broadcast(input.chatId, {
      type: "session_update",
      update: { sessionUpdate: "prompt_end" },
    });

    return { stopReason: res.stopReason };
  }
}
