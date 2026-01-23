import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

export class StopSessionService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort
  ) {}

  execute(chatId: string): { ok: true } {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      console.log(`[tRPC] Stopping session ${chatId}`);
      session.proc.kill();
    }
    this.sessionRepo.updateStatus(chatId, "stopped");
    return { ok: true };
  }
}
