/**
 * Get Session State Service
 *
 * Retrieves the current state of a session from either the runtime store
 * (for active sessions) or persistent storage (for stopped sessions).
 *
 * @module modules/session/application/get-session-state.service
 */

import { NotFoundError } from "@/shared/errors";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.state.get";

/**
 * GetSessionStateService
 *
 * Provides access to session state information, preferring runtime data
 * for active sessions falling back to stored data for stopped sessions.
 */
export class GetSessionStateService {
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a GetSessionStateService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Retrieves the current state of a session
   *
   * @param chatId - The chat session identifier
   * @returns Session state object containing status, modes, models, and capabilities
   * @throws Error if the session is not found
   *
   * @example
   * ```typescript
   * const state = service.execute("chat-123");
   * console.log(state.status); // "running" or "stopped"
   * console.log(state.modes); // Available modes if running
   * ```
   */
  async execute(chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (session) {
      return {
        status: "running" as const,
        chatStatus: session.chatStatus,
        modes: session.modes,
        models: session.models,
        commands: session.commands,
        promptCapabilities: session.promptCapabilities,
        loadSessionSupported: session.loadSessionSupported,
        supportsModelSwitching: session.supportsModelSwitching ?? false,
        agentInfo: session.agentInfo ?? null,
        plan: session.plan ?? null,
      };
    }

    const stored = await this.sessionRepo.findById(chatId);
    if (stored) {
      return {
        status: "stopped" as const,
        chatStatus: "inactive" as const,
        modes: null,
        models: null,
        commands: stored.commands ?? null,
        promptCapabilities: null,
        loadSessionSupported: stored.loadSessionSupported,
        supportsModelSwitching: stored.supportsModelSwitching ?? false,
        agentInfo: stored.agentInfo ?? null,
        plan: stored.plan ?? null,
      };
    }

    throw new NotFoundError("Chat not found", {
      module: "session",
      op: OP,
      details: { chatId },
    });
  }
}
