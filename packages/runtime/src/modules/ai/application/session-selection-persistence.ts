import type { SessionRepositoryPort } from "#runtime/modules/session";
import type { ChatSession } from "#runtime/shared/types/session.types";
import { syncSessionSelectionFromConfigOptions } from "#runtime/shared/utils/session-config-options.util";

export async function persistSessionSelectionState(params: {
  sessionRepo?: SessionRepositoryPort;
  chatId: string;
  session: ChatSession;
}): Promise<void> {
  const { sessionRepo, chatId, session } = params;
  if (!(sessionRepo && session.userId)) {
    return;
  }

  const selection = syncSessionSelectionFromConfigOptions(session);
  await sessionRepo.updateMetadata(chatId, session.userId, {
    modeId: selection.modeId ?? session.modes?.currentModeId,
    modelId: selection.modelId ?? session.models?.currentModelId,
    modes: session.modes,
    models: session.models,
    configOptions: session.configOptions,
  });
}
