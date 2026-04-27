import type * as acp from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type { PendingPermissionRequest } from "@/shared/types/session.types";
import type { SupervisorSessionState } from "@/shared/types/supervisor.types";
import { settlePendingPermission } from "@/shared/utils/pending-permission.util";
import type { SupervisorDecisionPort } from "./ports/supervisor-decision.port";
import type {
  SupervisorMemoryContext,
  SupervisorMemoryPort,
} from "./ports/supervisor-memory.port";
import type { SupervisorPolicy } from "./supervisor-policy";
import { normalizeSupervisorState } from "./supervisor-state.util";

const SUPERVISOR_PERMISSION_MEMORY_QUERY_MAX_CHARS = 400;
const PERSISTENT_ALLOW_KINDS = new Set(["allow_always", "allowalways"]);
const ONE_TIME_ALLOW_KINDS = new Set(["allow_once", "allowonce"]);
const REJECT_KINDS = new Set([
  "reject_once",
  "reject_always",
  "rejectOnce",
  "rejectAlways",
  "deny",
  "cancel",
]);

export class SupervisorPermissionService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly decisionPort: SupervisorDecisionPort;
  private readonly memoryPort: SupervisorMemoryPort;
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;
  private readonly clock: ClockPort;

  constructor(deps: {
    sessionRuntime: SessionRuntimePort;
    sessionRepo: SessionRepositoryPort;
    decisionPort: SupervisorDecisionPort;
    memoryPort: SupervisorMemoryPort;
    policy: SupervisorPolicy;
    logger: LoggerPort;
    clock: ClockPort;
  }) {
    this.sessionRuntime = deps.sessionRuntime;
    this.sessionRepo = deps.sessionRepo;
    this.decisionPort = deps.decisionPort;
    this.memoryPort = deps.memoryPort;
    this.policy = deps.policy;
    this.logger = deps.logger;
    this.clock = deps.clock;
  }

  async handlePermissionRequest(input: {
    chatId: string;
    requestId: string;
  }): Promise<void> {
    this.logger.info("Supervisor permission request received", {
      chatId: input.chatId,
      requestId: input.requestId,
    });
    const snapshot = await this.createSnapshot(input.chatId, input.requestId);
    if (!snapshot) {
      this.logger.info("Supervisor permission request skipped", {
        chatId: input.chatId,
        requestId: input.requestId,
      });
      return;
    }

    let decision: Awaited<
      ReturnType<SupervisorDecisionPort["decidePermission"]>
    >;
    try {
      decision = await this.decisionPort.decidePermission(snapshot);
    } catch (error) {
      this.logger.warn("Supervisor permission decision failed closed", {
        chatId: input.chatId,
        requestId: input.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      decision = {
        action: "reject",
        reason: "Supervisor permission decision failed",
      };
    }

    await this.applyPermissionDecision({
      chatId: input.chatId,
      requestId: input.requestId,
      decision,
    });
    this.logger.info("Supervisor permission decision applied", {
      chatId: input.chatId,
      requestId: input.requestId,
      action: decision.action,
    });
  }

  private async createSnapshot(chatId: string, requestId: string) {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      return null;
    }
    const supervisor = normalizeSupervisorState(session.supervisor);
    if (
      supervisor.mode !== "full_autopilot" ||
      !this.policy.enabled ||
      this.policy.model.trim().length === 0
    ) {
      return null;
    }

    const pending = session.pendingPermissions.get(requestId);
    if (!pending) {
      return null;
    }
    const options = Array.isArray(pending.options)
      ? (pending.options as acp.PermissionOption[])
      : [];
    const taskGoal = await this.getTaskGoal(chatId, session.userId);
    const memoryContext = await this.lookupPermissionMemory({
      chatId,
      projectRoot: session.projectRoot,
      taskGoal,
      pending,
    });
    return {
      chatId,
      taskGoal,
      ...(memoryContext.projectBlueprint
        ? { projectBlueprint: memoryContext.projectBlueprint }
        : {}),
      requestId,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      title: pending.title,
      input: pending.input,
      meta: pending.meta,
      options,
      supervisor,
    };
  }

  private async getTaskGoal(chatId: string, userId: string): Promise<string> {
    try {
      const firstPage = await this.sessionRepo.getMessagesPage(chatId, userId, {
        direction: "forward",
        limit: 1,
        includeCompacted: true,
      });
      return (
        firstPage.messages.find((message) => message.role === "user")
          ?.content ?? ""
      );
    } catch (error) {
      this.logger.warn("Supervisor permission task goal lookup failed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }

  private async lookupPermissionMemory(input: {
    chatId: string;
    projectRoot: string;
    taskGoal: string;
    pending: PendingPermissionRequest;
  }): Promise<SupervisorMemoryContext> {
    if (this.policy.memoryProvider === "none") {
      return { results: [] };
    }
    const query = [
      input.taskGoal,
      input.pending.toolName ?? "",
      input.pending.title ?? "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SUPERVISOR_PERMISSION_MEMORY_QUERY_MAX_CHARS);
    try {
      return await this.memoryPort.lookup({
        query,
        chatId: input.chatId,
        projectRoot: input.projectRoot,
      });
    } catch (error) {
      this.logger.warn("Supervisor permission memory lookup failed", {
        chatId: input.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { results: [] };
    }
  }

  private async applyPermissionDecision(params: {
    chatId: string;
    requestId: string;
    decision: { action: "approve" | "reject" | "defer"; reason: string };
  }): Promise<void> {
    const { chatId, requestId, decision } = params;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      const session = this.sessionRuntime.get(chatId);
      if (!session) {
        return;
      }
      const pending = session.pendingPermissions.get(requestId);
      if (!pending) {
        return;
      }
      const options = Array.isArray(pending.options)
        ? (pending.options as acp.PermissionOption[])
        : [];
      const selection = selectPermissionOption(decision.action, options);
      const supervisorStatus = selection
        ? toSupervisorPermissionStatus(selection.approved)
        : "needs_user";
      const decisionAction = selection
        ? toSupervisorPermissionAction(selection.approved)
        : "needs_user";
      const supervisor: SupervisorSessionState = {
        ...normalizeSupervisorState(session.supervisor),
        status: supervisorStatus,
        reason: selection
          ? `Permission ${decision.action}: ${decision.reason}`
          : `Permission deferred: ${decision.reason}`,
        updatedAt: this.clock.nowMs(),
      };
      session.supervisor = supervisor;
      await this.sessionRepo.updateMetadata(chatId, session.userId, {
        supervisor,
      });
      await this.sessionRuntime.broadcast(chatId, {
        type: "supervisor_status",
        supervisor,
      });

      await this.sessionRuntime.broadcast(chatId, {
        type: "supervisor_decision",
        decision: {
          action: decisionAction,
          reason: decision.reason,
        },
        supervisor,
        turnId: pending.turnId,
      });

      if (!selection) {
        return;
      }

      await settlePendingPermission({
        chatId,
        requestId,
        pending: pending as PendingPermissionRequest,
        session,
        response: selection.response,
        approved: selection.approved,
        reason: selection.reason,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        syncStatusAfterPermissionDecision: (turnId) =>
          new SessionRuntimeEntity(session).syncStatusAfterPermissionDecision(
            {
              chatId,
              broadcast: this.sessionRuntime.broadcast.bind(
                this.sessionRuntime
              ),
            },
            turnId
          ),
      });
    });
  }
}

export function selectPermissionOption(
  action: "approve" | "reject" | "defer",
  options: acp.PermissionOption[]
): {
  response: acp.RequestPermissionResponse;
  approved: boolean;
  reason: string;
} | null {
  if (action === "defer") {
    return null;
  }
  if (action === "approve") {
    const allowOnce = findOption(options, (option) => {
      const kind = normalizeOptionToken(option.kind);
      return ONE_TIME_ALLOW_KINDS.has(kind);
    });
    if (allowOnce) {
      return {
        response: { outcome: { outcome: "selected", optionId: allowOnce } },
        approved: true,
        reason: allowOnce,
      };
    }
    const nonPersistentAllow = findOption(options, (option) => {
      const kind = normalizeOptionToken(option.kind);
      return kind.startsWith("allow") && !PERSISTENT_ALLOW_KINDS.has(kind);
    });
    if (nonPersistentAllow) {
      return {
        response: {
          outcome: { outcome: "selected", optionId: nonPersistentAllow },
        },
        approved: true,
        reason: nonPersistentAllow,
      };
    }
    return null;
  }

  const reject = findOption(options, (option) => {
    const kind = normalizeOptionToken(option.kind);
    const name = normalizeOptionToken(option.name);
    const optionId = normalizeOptionToken(option.optionId);
    return (
      REJECT_KINDS.has(kind) ||
      kind.startsWith("reject") ||
      name.includes("reject") ||
      name.includes("deny") ||
      optionId.includes("reject") ||
      optionId.includes("deny")
    );
  });
  if (reject) {
    return {
      response: { outcome: { outcome: "selected", optionId: reject } },
      approved: false,
      reason: reject,
    };
  }
  return {
    response: { outcome: { outcome: "cancelled" } },
    approved: false,
    reason: "cancelled",
  };
}

function findOption(
  options: acp.PermissionOption[],
  predicate: (option: acp.PermissionOption) => boolean
): string | null {
  for (const option of options) {
    const optionId =
      typeof option.optionId === "string" && option.optionId.trim().length > 0
        ? option.optionId
        : null;
    if (!(optionId && predicate(option))) {
      continue;
    }
    return optionId;
  }
  return null;
}

function normalizeOptionToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toSupervisorPermissionStatus(approved: boolean) {
  return approved ? "continuing" : "aborted";
}

function toSupervisorPermissionAction(approved: boolean) {
  return approved ? "continue" : "abort";
}
