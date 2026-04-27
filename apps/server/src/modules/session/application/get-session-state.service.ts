/**
 * Get Session State Service
 *
 * Retrieves the current state of a session from either the runtime store
 * (for active sessions) or persistent storage (for stopped sessions).
 *
 * @module modules/session/application/get-session-state.service
 */

import { DEFAULT_MAX_VISIBLE_MODEL_COUNT } from "@/config/constants";
import { NotFoundError } from "@/shared/errors";
import type { SupervisorSessionState } from "@/shared/types/supervisor.types";
import {
  diagnosticsLog,
  isDiagnosticsEnabled,
} from "@/shared/utils/diagnostics.util";
import { capModelList } from "@/shared/utils/session-config-options.util";
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
  /** Whether supervisor is enabled at the server level */
  private readonly supervisorEnabled: boolean;

  /**
   * Creates a GetSessionStateService with required dependencies
   */
  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    supervisorEnabled?: boolean
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.supervisorEnabled = supervisorEnabled ?? false;
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
  async execute(userId: string, chatId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (session?.userId === userId) {
      // Cap model/config-option lists at the response boundary to prevent
      // excessive payload sizes. Internal session state remains uncapped
      // so that set-model / set-config-option validation continues to work
      // against the full list.
      const capped = capModelList({
        models: session.models?.availableModels,
        configOptions: session.configOptions,
        currentModelId: session.models?.currentModelId,
        maxVisible: DEFAULT_MAX_VISIBLE_MODEL_COUNT,
      });

      // [DIAG] Log pre/post cap model and config option counts
      if (isDiagnosticsEnabled()) {
        const preCapModelCount = session.models?.availableModels?.length ?? 0;
        const preCapConfigCount = session.configOptions?.length ?? 0;
        const postCapModelCount = capped.models.length;
        const postCapConfigCount = capped.configOptions.length;
        diagnosticsLog("get-session-state-cap", {
          chatId,
          preCapModelCount,
          postCapModelCount,
          preCapConfigCount,
          postCapConfigCount,
        });
      }

      return {
        status: "running" as const,
        chatStatus: session.chatStatus,
        modes: session.modes,
        models: session.models
          ? { ...session.models, availableModels: capped.models }
          : session.models,
        commands: session.commands,
        configOptions: capped.configOptions,
        sessionInfo: session.sessionInfo ?? null,
        promptCapabilities: session.promptCapabilities,
        loadSessionSupported: session.loadSessionSupported,
        supportsModelSwitching: session.supportsModelSwitching ?? false,
        agentInfo: session.agentInfo ?? null,
        plan: session.plan ?? null,
        supervisor: normalizeSupervisorForState(session.supervisor),
        supervisorCapable: this.supervisorEnabled,
      };
    }

    const stored = await this.sessionRepo.findById(chatId, userId);
    if (stored) {
      return {
        status: "stopped" as const,
        chatStatus: "inactive" as const,
        modes: null,
        models: null,
        commands: stored.commands ?? null,
        configOptions: null,
        sessionInfo: null,
        promptCapabilities: null,
        loadSessionSupported: stored.loadSessionSupported,
        supportsModelSwitching: stored.supportsModelSwitching ?? false,
        agentInfo: stored.agentInfo ?? null,
        plan: stored.plan ?? null,
        supervisor: normalizeSupervisorForState(stored.supervisor),
        supervisorCapable: this.supervisorEnabled,
      };
    }

    throw new NotFoundError("Chat not found", {
      module: "session",
      op: OP,
      details: { chatId },
    });
  }
}

function normalizeSupervisorForState(
  supervisor: SupervisorSessionState | undefined
): SupervisorSessionState {
  if (!supervisor || supervisor.mode === "off") {
    return { mode: "off", status: "idle" };
  }
  return supervisor;
}
