import type {
  AgentRuntimePort,
  SessionRepositoryPort,
  SessionRuntimePort,
  SettingsRepositoryPort,
} from "../../../shared/types/ports";
import { CreateSessionService } from "./create-session.service";

export class ResumeSessionService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort,
    private agentRuntime: AgentRuntimePort,
    private settingsRepo: SettingsRepositoryPort
  ) {}

  async execute(chatId: string) {
    const stored = this.sessionRepo.findById(chatId);
    if (!stored) {
      throw new Error("Session not found in store");
    }
    if (!stored.sessionId) {
      throw new Error("Session is missing ACP sessionId");
    }

    const existing = this.sessionRuntime.get(chatId);
    if (existing) {
      return {
        ok: true,
        alreadyRunning: true,
        modes: existing.modes,
        models: existing.models,
        promptCapabilities: existing.promptCapabilities,
        loadSessionSupported: existing.loadSessionSupported ?? false,
      };
    }

    const res = await new CreateSessionService(
      this.sessionRepo,
      this.sessionRuntime,
      this.agentRuntime,
      this.settingsRepo
    ).execute({
      projectId: stored.projectId,
      projectRoot: stored.projectRoot,
      command: stored.command,
      args: stored.args,
      env: stored.env,
      chatId: stored.id,
      sessionIdToLoad: stored.sessionId,
    });

    return {
      ok: true,
      chatId: res.id,
      modes: res.modes,
      models: res.models,
      promptCapabilities: res.promptCapabilities,
      loadSessionSupported: res.loadSessionSupported ?? false,
    };
  }
}
