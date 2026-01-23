import type { SessionRuntimePort } from "../../../shared/types/ports";

export class SetModeService {
  constructor(private sessionRuntime: SessionRuntimePort) {}

  async execute(chatId: string, modeId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    await session.conn.setSessionMode({
      sessionId: session.sessionId,
      modeId,
    });

    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    return { ok: true };
  }
}
