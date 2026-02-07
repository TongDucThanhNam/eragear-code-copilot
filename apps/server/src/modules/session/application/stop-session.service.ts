import type { EventBusPort } from "@/shared/ports/event-bus.port";
import { updateChatStatus } from "../../../shared/utils/chat-events.util";
import { terminateSessionTerminals } from "../../../shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export class StopSessionService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly eventBus: EventBusPort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    eventBus: EventBusPort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.eventBus = eventBus;
  }

  async execute(chatId: string): Promise<{ ok: true }> {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      console.log(`[tRPC] Stopping session ${chatId}`);
      terminateSessionTerminals(session);
      updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "inactive",
      });
      session.proc.kill();
      // Remove from runtime so getSessionState returns "stopped"
      this.sessionRuntime.delete(chatId);
    }
    await this.sessionRepo.updateStatus(chatId, "stopped");
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "session_stopped",
      chatId,
    });
    return { ok: true };
  }
}
