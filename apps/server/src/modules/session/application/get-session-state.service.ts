import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "../../../shared/types/ports";

export class GetSessionStateService {
  constructor(
    private sessionRepo: SessionRepositoryPort,
    private sessionRuntime: SessionRuntimePort
  ) {}

  execute(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      return {
        status: "running" as const,
        modes: session.modes,
        models: session.models,
        commands: session.commands,
        promptCapabilities: session.promptCapabilities,
        loadSessionSupported: session.loadSessionSupported,
      };
    }

    const stored = this.sessionRepo.findById(chatId);
    if (stored) {
      return {
        status: "stopped" as const,
        modes: null,
        models: null,
        commands: null,
        promptCapabilities: null,
        loadSessionSupported: stored.loadSessionSupported,
      };
    }

    throw new Error("Chat not found");
  }
}
