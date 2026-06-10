import type { ChatSession } from "@/shared/types/session.types";
import { syncSessionSelectionFromConfigOptions } from "@/shared/utils/session-config-options.util";
import type { CreateSessionParams } from "./create-session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";

/**
 * Metadata snapshot written after ACP initialize succeeds.
 *
 * Invariant: model/mode/config options on `chatSession` are already normalized
 * from the agent response before persistence.
 */
export interface PersistSessionMetadataInput {
  chatId: string;
  params: CreateSessionParams;
  chatSession: ChatSession;
  agentCommand: string;
  agentArgs: string[];
  agentEnv: Record<string, string>;
  projectRoot: string;
}

/**
 * Creates or updates the persisted session metadata for a running runtime.
 *
 * Side effect: preserves existing chat ids on resume/update and only creates a
 * new storage record when the requested chat id does not already belong to user.
 */
export class SessionMetadataPersistenceService {
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.sessionRepo = sessionRepo;
  }

  async persist(input: PersistSessionMetadataInput): Promise<void> {
    const {
      chatId,
      params,
      chatSession,
      agentCommand,
      agentArgs,
      agentEnv,
      projectRoot,
    } = input;
    const selection = syncSessionSelectionFromConfigOptions(chatSession);

    const commonSessionData = {
      projectId: params.projectId ?? chatSession.projectId,
      agentId: params.agentId,
      projectRoot,
      command: agentCommand,
      args: agentArgs,
      env: agentEnv,
      cwd: projectRoot,
      agentInfo: chatSession.agentInfo,
      loadSessionSupported: chatSession.loadSessionSupported,
      useUnstableResume: chatSession.useUnstableResume,
      supportsModelSwitching: chatSession.supportsModelSwitching,
      agentCapabilities: chatSession.agentCapabilities,
      authMethods: chatSession.authMethods,
      status: "running" as const,
      modeId: selection.modeId ?? chatSession.modes?.currentModeId,
      modelId: selection.modelId ?? chatSession.models?.currentModelId,
    };

    const shouldUpdateExistingSession =
      Boolean(params.chatId) &&
      Boolean(await this.sessionRepo.findById(chatId, params.userId));
    if (shouldUpdateExistingSession) {
      await this.sessionRepo.updateMetadata(chatId, params.userId, {
        sessionId: chatSession.sessionId,
        ...commonSessionData,
      });
      return;
    }

    await this.sessionRepo.create({
      id: chatId,
      userId: params.userId,
      sessionId: chatSession.sessionId,
      ...commonSessionData,
      pinned: false,
      archived: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
    });
  }
}
