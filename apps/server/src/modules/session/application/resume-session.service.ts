/**
 * Resume Session Service
 *
 * Reactivates a previously stored session by spawning a new agent process
 * and loading the existing session state from the agent.
 *
 * @module modules/session/application/resume-session.service
 */

import { NotFoundError, ValidationError } from "@/shared/errors";
import type { CreateSessionService } from "./create-session.service";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.lifecycle.resume";

/**
 * ResumeSessionService
 *
 * Handles the resumption of a previously saved session.
 * If the session is already active in the runtime, returns immediately.
 * Otherwise, creates a new session using the stored session ID.
 */
export class ResumeSessionService {
  /** Repository for session persistence */
  private readonly sessionRepo: SessionRepositoryPort;
  /** Runtime store for active sessions */
  private readonly sessionRuntime: SessionRuntimePort;
  /** Create session orchestration service */
  private readonly createSession: CreateSessionService;

  /**
   * Creates a ResumeSessionService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    createSession: CreateSessionService
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.createSession = createSession;
  }

  /**
   * Resumes a previously stored session
   *
   * @param chatId - The chat session identifier to resume
   * @returns Object containing session state and status information
   * @throws Error if session not found in store or missing session ID
   *
   * @example
   * ```typescript
   * const result = await service.execute("chat-123");
   * if (result.ok && !result.alreadyRunning) {
   *   console.log("Session resumed:", result.chatId);
   * }
   * ```
   */
  async execute(userId: string, chatId: string) {
    const stored = await this.sessionRepo.findById(chatId, userId);
    if (!stored) {
      throw new NotFoundError("Session not found in store", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }
    if (!stored.sessionId) {
      throw new ValidationError("Session is missing ACP sessionId", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }

    const existing = this.sessionRuntime.get(chatId);
    if (existing) {
      return {
        ok: true,
        alreadyRunning: true,
        modes: existing.modes,
        models: existing.models,
        configOptions: existing.configOptions ?? null,
        sessionInfo: existing.sessionInfo ?? null,
        promptCapabilities: existing.promptCapabilities,
        loadSessionSupported: existing.loadSessionSupported ?? false,
        supportsModelSwitching: existing.supportsModelSwitching ?? false,
        plan: existing.plan ?? stored.plan ?? null,
      };
    }

    const res = await this.createSession.execute({
      userId,
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
      configOptions: res.configOptions ?? null,
      sessionInfo: res.sessionInfo ?? null,
      promptCapabilities: res.promptCapabilities,
      loadSessionSupported: res.loadSessionSupported ?? false,
      supportsModelSwitching: res.supportsModelSwitching ?? false,
      plan: res.plan ?? stored.plan ?? null,
    };
  }
}
