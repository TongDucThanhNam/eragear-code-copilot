import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

export class DeleteSessionService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort
  ) {}

  execute(chatId: string): { ok: true } {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      session.proc.kill();
      this.sessionRuntime.delete(chatId);
    }
    this.sessionRepo.delete(chatId);
    return { ok: true };
  }
}
