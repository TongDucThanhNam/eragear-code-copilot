import type { SessionRuntimePort } from "../../../shared/types/ports";

export class CancelPromptService {
  constructor(private sessionRuntime: SessionRuntimePort) {}

  async execute(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    await session.conn.cancel({ sessionId: session.sessionId });
    for (const [, pending] of session.pendingPermissions) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    session.pendingPermissions.clear();
    return { ok: true };
  }
}
