// Session runtime store - in-memory storage for active sessions

import type {
  EventBusPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";
import type {
  BroadcastEvent,
  ChatSession,
} from "../../../shared/types/session.types";

export class SessionRuntimeStore implements SessionRuntimePort {
  private sessions = new Map<string, ChatSession>();
  private eventBus: EventBusPort;

  constructor(eventBus: EventBusPort) {
    this.eventBus = eventBus;
  }

  set(chatId: string, session: ChatSession): void {
    this.sessions.set(chatId, session);
  }

  get(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: string): void {
    this.sessions.delete(chatId);
  }

  has(chatId: string): boolean {
    return this.sessions.has(chatId);
  }

  getAll(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  broadcast(chatId: string, event: BroadcastEvent): void {
    const session = this.sessions.get(chatId);
    if (!session) {
      return;
    }

    // Buffer the event
    session.messageBuffer.push(event);

    // Emit to subscribers
    session.emitter.emit("data", event);

    // Publish to event bus
    this.eventBus.publish({ type: "session_broadcast", chatId, event });
  }
}
