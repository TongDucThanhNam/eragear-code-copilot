import type { UIMessage } from "@eragear-code-copilot/shared";
import {
  DEFAULT_MAX_VISIBLE_MODEL_COUNT,
  DEFAULT_SESSION_LIST_PAGE_LIMIT,
  DEFAULT_SESSION_MESSAGES_PAGE_LIMIT,
} from "#runtime/config/constants";
import type { ProjectRepositoryPort } from "#runtime/modules/project/application/ports/project-repository.port";
import type {
  StoredContentBlock,
  StoredMessage,
  StoredSession,
} from "#runtime/modules/session/domain/stored-session.types";
import { NotFoundError, ValidationError } from "#runtime/shared/errors";
import type { SupervisorSessionState } from "#runtime/shared/types/supervisor.types";
import {
  diagnosticsLog,
  isDiagnosticsEnabled,
} from "#runtime/shared/utils/diagnostics.util";
import {
  capSessionSelectionState,
  shouldStripAvailableModelsForAgent,
} from "#runtime/shared/utils/session-config-options.util";
import {
  buildAssistantMessageFromBlocks,
  buildUserMessageFromBlocks,
} from "#runtime/shared/utils/ui-message/content";
import type {
  SessionListPageQuery,
  SessionListQuery,
  SessionRepositoryPort,
} from "../ports/session-repository.port";
import type { SessionRuntimePort } from "../ports/session-runtime.port";

const STATE_OP = "session.state.get";
const LIST_OP = "session.list";
const PAGE_OP = "session.page";
const MESSAGES_OP = "session.messages.get";
const MESSAGE_BY_ID_OP = "session.message.get_by_id";
const USER_COMPACTED_TEXT = "[User message compacted for local retention]";
const ASSISTANT_COMPACTED_TEXT =
  "[Assistant message compacted for local retention]";
const COMPACTION_SESSION_PAGE_SIZE = 500;
type SupervisorCapabilityProvider = () => boolean;

/**
 * Request for one persisted session message page.
 *
 * Caller contract: `maxLimit` is the runtime policy cap supplied by transport
 * config; this query validates requested limits before touching storage.
 */
export interface SessionMessagesInput {
  userId: string;
  chatId: string;
  cursor?: number;
  direction?: "forward" | "backward";
  limit?: number;
  maxLimit: number;
  includeCompacted?: boolean;
}

/**
 * Request for one stored message by id.
 *
 * Error mode: a missing chat throws `NotFoundError`; a missing message returns
 * `{ message: undefined }` so callers can distinguish session ownership from
 * message absence.
 */
export interface SessionMessageLookupInput {
  userId: string;
  chatId: string;
  messageId: string;
}

/**
 * Cold-message compaction request.
 *
 * Side effect: compaction rewrites eligible stopped-session message payloads but
 * must preserve message identity and listability.
 */
export interface SessionMessagesCompactionInput {
  beforeTimestamp: number;
  batchSize: number;
}

/**
 * Summary of one compaction pass.
 *
 * Invariant: candidate counts come from maintenance pagination before the
 * repository compaction batch is applied.
 */
export interface SessionMessagesCompactionResult {
  compacted: number;
  candidateCount: number;
  stoppedSessionCount: number;
}

/**
 * Convert a stored message into the UI message contract.
 *
 * Invariant: compacted messages produce explicit retention placeholders so the
 * UI never renders missing content as an empty assistant/user turn.
 */
export function mapStoredMessageToUiMessage(message: StoredMessage): UIMessage {
  if (message.parts && message.parts.length > 0) {
    return {
      id: message.id,
      role: message.role,
      createdAt: message.timestamp,
      parts: message.parts,
    };
  }

  let contentBlocks: StoredContentBlock[];
  if (message.contentBlocks) {
    contentBlocks = message.contentBlocks;
  } else if (message.content) {
    contentBlocks = [{ type: "text", text: message.content }];
  } else if (message.isCompacted) {
    contentBlocks = [
      {
        type: "text",
        text:
          message.role === "assistant"
            ? ASSISTANT_COMPACTED_TEXT
            : USER_COMPACTED_TEXT,
      },
    ];
  } else {
    contentBlocks = [];
  }
  const reasoningBlocks: StoredContentBlock[] =
    message.reasoningBlocks ??
    (message.reasoning ? [{ type: "text", text: message.reasoning }] : []);

  if (message.role === "user") {
    return buildUserMessageFromBlocks({
      messageId: message.id,
      contentBlocks,
      createdAt: message.timestamp,
    });
  }
  return buildAssistantMessageFromBlocks({
    messageId: message.id,
    contentBlocks,
    reasoningBlocks,
    createdAt: message.timestamp,
  });
}

/**
 * Canonical read/maintenance surface for session state, lists, messages, and
 * storage statistics.
 *
 * Invariants: live session state wins over persisted state, client-visible
 * model/config lists are capped here, and message compaction only targets
 * stopped sessions discovered through maintenance pagination.
 */
export class SessionQueries {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort | undefined;
  private readonly projectRepo: ProjectRepositoryPort | undefined;
  private readonly supervisorCapable: SupervisorCapabilityProvider;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime?: SessionRuntimePort,
    projectRepo?: ProjectRepositoryPort,
    supervisorCapable?: boolean | SupervisorCapabilityProvider
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
    this.projectRepo = projectRepo;
    this.supervisorCapable =
      typeof supervisorCapable === "function"
        ? supervisorCapable
        : () => supervisorCapable ?? false;
  }

  async state(userId: string, chatId: string) {
    const sessionRuntime = this.requireSessionRuntime(STATE_OP);
    const session = sessionRuntime.get(chatId);
    if (session?.userId === userId) {
      const capped = capSessionSelectionState({
        models: session.models,
        configOptions: session.configOptions,
        maxVisible: DEFAULT_MAX_VISIBLE_MODEL_COUNT,
        stripAvailableModels: shouldStripAvailableModelsForAgent(
          session.agentInfo
        ),
      });

      if (isDiagnosticsEnabled()) {
        diagnosticsLog("get-session-state-cap", {
          chatId,
          preCapModelCount: session.models?.availableModels?.length ?? 0,
          postCapModelCount: capped.models?.availableModels.length ?? 0,
          preCapConfigCount: session.configOptions?.length ?? 0,
          postCapConfigCount: capped.configOptions.length,
        });
      }

      return {
        status: "running" as const,
        chatStatus: session.chatStatus,
        modes: session.modes,
        models: capped.models,
        commands: session.commands,
        configOptions: capped.configOptions,
        sessionInfo: session.sessionInfo ?? null,
        promptCapabilities: session.promptCapabilities,
        loadSessionSupported: session.loadSessionSupported,
        supportsModelSwitching: session.supportsModelSwitching ?? false,
        agentInfo: session.agentInfo ?? null,
        plan: session.plan ?? null,
        supervisor: normalizeSupervisorForState(session.supervisor),
        supervisorCapable: this.supervisorCapable(),
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
        supervisorCapable: this.supervisorCapable(),
      };
    }

    throw new NotFoundError("Chat not found", {
      module: "session",
      op: STATE_OP,
      details: { chatId },
    });
  }

  async list(
    userId: string,
    query: SessionListQuery | undefined,
    maxLimit: number
  ) {
    const projectRepo = this.requireProjectRepo(LIST_OP);
    const sessionRuntime = this.requireSessionRuntime(LIST_OP);
    const normalizedQuery = this.normalizeOffsetLimit(query, maxLimit);
    const projects = await projectRepo.findAll(userId);
    const storedSessions = await this.sessionRepo.findAll(
      userId,
      normalizedQuery
    );
    return await this.hydrateSessions(
      userId,
      storedSessions,
      projects,
      sessionRuntime
    );
  }

  async listPage(
    userId: string,
    query: SessionListPageQuery | undefined,
    maxLimit: number
  ) {
    const projectRepo = this.requireProjectRepo(PAGE_OP);
    const sessionRuntime = this.requireSessionRuntime(PAGE_OP);
    const normalizedQuery = this.normalizeCursorLimit(query, maxLimit);
    const projects = await projectRepo.findAll(userId);
    const page = await this.sessionRepo.findPage(userId, normalizedQuery);
    const items = await this.hydrateSessions(
      userId,
      page.sessions,
      projects,
      sessionRuntime
    );

    return {
      items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async messages(input: SessionMessagesInput) {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: MESSAGES_OP,
        details: { chatId: input.chatId },
      });
    }
    const normalizedMaxLimit = Math.max(1, Math.trunc(input.maxLimit));
    if (
      input.limit !== undefined &&
      Number.isFinite(input.limit) &&
      input.limit > normalizedMaxLimit
    ) {
      throw new ValidationError(`limit must be <= ${normalizedMaxLimit}`, {
        module: "session",
        op: MESSAGES_OP,
        details: {
          chatId: input.chatId,
          limit: input.limit,
          maxLimit: normalizedMaxLimit,
        },
      });
    }

    const page = await this.sessionRepo.getMessagesPage(
      input.chatId,
      input.userId,
      {
        cursor: input.cursor,
        direction: input.direction,
        limit:
          input.limit ??
          Math.min(DEFAULT_SESSION_MESSAGES_PAGE_LIMIT, normalizedMaxLimit),
        includeCompacted: input.includeCompacted,
      }
    );

    return {
      messages: page.messages.map((message) =>
        mapStoredMessageToUiMessage(message)
      ),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async messageById(input: SessionMessageLookupInput) {
    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: MESSAGE_BY_ID_OP,
        details: { chatId: input.chatId },
      });
    }

    const message = await this.sessionRepo.getMessageById(
      input.chatId,
      input.userId,
      input.messageId
    );

    return {
      message: message ? mapStoredMessageToUiMessage(message) : undefined,
    };
  }

  storageStats() {
    return this.sessionRepo.getStorageStats();
  }

  async compact(
    input: SessionMessagesCompactionInput
  ): Promise<SessionMessagesCompactionResult> {
    let candidateCount = 0;
    const stoppedSessionIds: string[] = [];
    let cursor: string | undefined;

    while (true) {
      const page = await this.sessionRepo.findPageForMaintenance({
        limit: COMPACTION_SESSION_PAGE_SIZE,
        cursor,
      });
      if (page.sessions.length === 0) {
        break;
      }

      candidateCount += page.sessions.length;
      for (const session of page.sessions) {
        if (session.status === "stopped") {
          stoppedSessionIds.push(session.id);
        }
      }

      if (!(page.hasMore && page.nextCursor)) {
        break;
      }
      cursor = page.nextCursor;
    }

    if (stoppedSessionIds.length === 0) {
      return {
        compacted: 0,
        candidateCount,
        stoppedSessionCount: 0,
      };
    }

    const result = await this.sessionRepo.compactMessages({
      beforeTimestamp: input.beforeTimestamp,
      batchSize: input.batchSize,
      sessionIds: stoppedSessionIds,
    });

    return {
      compacted: result.compacted,
      candidateCount,
      stoppedSessionCount: stoppedSessionIds.length,
    };
  }

  private normalizeOffsetLimit(
    query: SessionListQuery | undefined,
    maxLimit: number
  ): SessionListQuery {
    const normalizedMaxLimit = Math.max(1, Math.trunc(maxLimit));
    if (
      query?.limit !== undefined &&
      Number.isFinite(query.limit) &&
      query.limit > normalizedMaxLimit
    ) {
      throw new ValidationError(`limit must be <= ${normalizedMaxLimit}`, {
        module: "session",
        op: LIST_OP,
        details: {
          limit: query.limit,
          maxLimit: normalizedMaxLimit,
        },
      });
    }

    return {
      limit:
        query?.limit ??
        Math.min(DEFAULT_SESSION_LIST_PAGE_LIMIT, normalizedMaxLimit),
      offset: query?.offset ?? 0,
    };
  }

  private normalizeCursorLimit(
    query: SessionListPageQuery | undefined,
    maxLimit: number
  ): SessionListPageQuery {
    const normalizedMaxLimit = Math.max(1, Math.trunc(maxLimit));
    if (
      query?.limit !== undefined &&
      Number.isFinite(query.limit) &&
      query.limit > normalizedMaxLimit
    ) {
      throw new ValidationError(`limit must be <= ${normalizedMaxLimit}`, {
        module: "session",
        op: PAGE_OP,
        details: {
          limit: query.limit,
          maxLimit: normalizedMaxLimit,
        },
      });
    }

    return {
      limit:
        query?.limit ??
        Math.min(DEFAULT_SESSION_LIST_PAGE_LIMIT, normalizedMaxLimit),
      cursor: query?.cursor,
    };
  }

  private async hydrateSessions(
    userId: string,
    sessions: StoredSession[],
    projects: Array<{ id: string; path: string }>,
    sessionRuntime: SessionRuntimePort
  ) {
    return await Promise.all(
      sessions.map(async (session) => {
        const activeSession =
          session.status === "running"
            ? sessionRuntime.get(session.id)
            : undefined;
        const isActive = Boolean(activeSession);
        const loadSessionSupported =
          activeSession?.loadSessionSupported ?? session.loadSessionSupported;
        const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
        const agentName = agentInfo?.title ?? agentInfo?.name;
        const plan = activeSession?.plan ?? session.plan ?? null;
        const agentCapabilities =
          activeSession?.agentCapabilities ?? session.agentCapabilities;
        const authMethods = activeSession?.authMethods ?? session.authMethods;
        const runtimeTitle = activeSession?.sessionInfo?.title ?? undefined;
        const supportsModelSwitching =
          activeSession?.supportsModelSwitching ??
          session.supportsModelSwitching ??
          false;
        const derivedProjectId =
          session.projectId ??
          projects.find((project) => project.path === session.projectRoot)?.id;

        if (!session.projectId && derivedProjectId) {
          await this.sessionRepo.updateMetadata(session.id, userId, {
            projectId: derivedProjectId,
          });
        }

        return {
          id: session.id,
          name: session.name ?? runtimeTitle,
          agentId: session.agentId,
          sessionId: activeSession?.sessionId ?? session.sessionId,
          projectId: derivedProjectId ?? session.projectId ?? null,
          projectRoot: session.projectRoot,
          modeId: session.modeId,
          status: session.status,
          isActive,
          createdAt: session.createdAt,
          lastActiveAt: session.lastActiveAt,
          loadSessionSupported,
          supportsModelSwitching,
          agentInfo,
          agentName,
          agentCapabilities,
          authMethods,
          plan,
          pinned: session.pinned ?? false,
          archived: session.archived ?? false,
        };
      })
    );
  }

  private requireSessionRuntime(op: string): SessionRuntimePort {
    if (!this.sessionRuntime) {
      throw new Error(`${op} requires a session runtime dependency`);
    }
    return this.sessionRuntime;
  }

  private requireProjectRepo(op: string): ProjectRepositoryPort {
    if (!this.projectRepo) {
      throw new Error(`${op} requires a project repository dependency`);
    }
    return this.projectRepo;
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
