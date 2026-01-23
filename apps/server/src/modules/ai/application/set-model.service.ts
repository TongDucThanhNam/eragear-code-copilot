import type { SessionRuntimePort } from "../../../shared/types/ports";

interface ConnWithUnstableModel {
  unstable_setSessionModel: (params: {
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
}

export class SetModelService {
  constructor(private sessionRuntime: SessionRuntimePort) {}

  async execute(chatId: string, modelId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session?.sessionId) {
      throw new Error("Chat not found");
    }

    await (
      session.conn as unknown as ConnWithUnstableModel
    ).unstable_setSessionModel({
      sessionId: session.sessionId,
      modelId,
    });

    if (session.models) {
      session.models.currentModelId = modelId;
    }
    return { ok: true };
  }
}
