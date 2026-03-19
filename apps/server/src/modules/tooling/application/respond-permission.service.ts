/**
 * Respond Permission Service
 *
 * Handles permission request responses from users, resolving pending
 * permission requests with the appropriate outcome based on user decision.
 *
 * @module modules/tooling/application/respond-permission.service
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { SessionRuntimePort } from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { settlePendingPermission } from "@/shared/utils/pending-permission.util";

const OP = "tooling.permission.respond";
const TOKENIZE_REGEX = /[^a-z0-9]+/;
const ALLOW_KEYWORDS = [
  "allow",
  "approve",
  "approved",
  "accept",
  "accepted",
  "grant",
  "granted",
  "yes",
  "ok",
];
const REJECT_KEYWORDS = [
  "reject",
  "rejected",
  "deny",
  "denying",
  "denied",
  "block",
  "blocked",
  "cancel",
  "cancelled",
  "decline",
  "declined",
  "disallow",
  "no",
];
type PermissionIntent = "allow" | "reject";

function normalizeToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  const words = value.split(TOKENIZE_REGEX).filter((part) => part.length > 0);
  return [value, ...words];
}

function includesKeyword(value: string, keywords: readonly string[]): boolean {
  const tokens = tokenize(normalizeToken(value));
  return keywords.some((keyword) => tokens.includes(keyword));
}

function inferDecisionIntent(decision: string): PermissionIntent | null {
  if (decision.length === 0) {
    return null;
  }
  const hasReject = includesKeyword(decision, REJECT_KEYWORDS);
  const hasAllow = includesKeyword(decision, ALLOW_KEYWORDS);
  if (hasReject === hasAllow) {
    return null;
  }
  if (hasReject) {
    return "reject";
  }
  if (hasAllow) {
    return "allow";
  }
  return null;
}

function getOptionTokens(option: acp.PermissionOption): string[] {
  return [
    normalizeToken(option.optionId),
    normalizeToken(option.kind),
    normalizeToken(option.name),
  ].filter((value) => value.length > 0);
}

function getOptionId(option: acp.PermissionOption): string | null {
  if (typeof option.optionId !== "string") {
    return null;
  }
  return option.optionId.trim().length > 0 ? option.optionId : null;
}

function inferOptionIntent(
  option: acp.PermissionOption
): PermissionIntent | null {
  const kind = normalizeToken(option.kind);
  if (kind.startsWith("reject_")) {
    return "reject";
  }
  if (kind.startsWith("allow_")) {
    return "allow";
  }
  const tokens = getOptionTokens(option);
  let hasReject = false;
  let hasAllow = false;
  for (const token of tokens) {
    if (includesKeyword(token, REJECT_KEYWORDS)) {
      hasReject = true;
    }
    if (includesKeyword(token, ALLOW_KEYWORDS)) {
      hasAllow = true;
    }
  }
  if (hasReject === hasAllow) {
    return null;
  }
  return hasReject ? "reject" : "allow";
}

function scoreIntentOption(
  option: acp.PermissionOption,
  intent: PermissionIntent
): number {
  const kind = normalizeToken(option.kind);
  if (intent === "allow") {
    if (kind === "allow_once" || kind === "allow_always") {
      return 4;
    }
    if (kind.startsWith("allow_")) {
      return 3;
    }
  } else {
    if (kind === "reject_once" || kind === "reject_always") {
      return 4;
    }
    if (kind.startsWith("reject_")) {
      return 3;
    }
  }
  return inferOptionIntent(option) === intent ? 1 : 0;
}

function resolvePermissionSelection(params: {
  decision: string;
  options: acp.PermissionOption[];
}): {
  optionId: string;
  approved: boolean;
} {
  const decision = normalizeToken(params.decision);
  const decisionIntent = inferDecisionIntent(decision);
  const options = params.options;

  if (options.length === 0) {
    if (decisionIntent === "allow") {
      return { optionId: "allow-once", approved: true };
    }
    return { optionId: "reject-once", approved: false };
  }

  const exactMatch =
    decision.length > 0
      ? options.find((option) => {
          return getOptionTokens(option).some((token) => token === decision);
        })
      : undefined;
  if (exactMatch) {
    const exactOptionId = getOptionId(exactMatch);
    if (exactOptionId) {
      const optionIntent = inferOptionIntent(exactMatch);
      return {
        optionId: exactOptionId,
        approved: optionIntent !== "reject",
      };
    }
  }

  if (decisionIntent) {
    const intentMatch = options
      .map((option, index) => ({
        option,
        index,
        score: scoreIntentOption(option, decisionIntent),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.index - right.index;
      })[0]?.option;
    const intentOptionId = intentMatch ? getOptionId(intentMatch) : null;
    if (intentOptionId) {
      return {
        optionId: intentOptionId,
        approved: decisionIntent === "allow",
      };
    }
  }

  const fallbackReject = options.find(
    (option) => inferOptionIntent(option) === "reject"
  );
  const fallbackRejectId = fallbackReject ? getOptionId(fallbackReject) : null;
  if (fallbackRejectId) {
    return {
      optionId: fallbackRejectId,
      approved: false,
    };
  }

  const firstOption = options.find((option) => getOptionId(option) !== null);
  const firstOptionId = firstOption ? getOptionId(firstOption) : null;
  if (firstOption && firstOptionId) {
    return {
      optionId: firstOptionId,
      approved: inferOptionIntent(firstOption) !== "reject",
    };
  }

  if (decisionIntent === "allow") {
    return { optionId: "allow-once", approved: true };
  }

  return { optionId: "reject-once", approved: false };
}

/**
 * RespondPermissionService
 *
 * Service for handling user responses to permission requests.
 * Resolves pending permission requests with the selected option.
 *
 * @example
 * ```typescript
 * const service = new RespondPermissionService(sessionRuntime);
 * const response = service.execute({
 *   userId: "user-1",
 *   chatId: "chat-123",
 *   requestId: "req-456",
 *   decision: "allow"
 * });
 * ```
 */
export class RespondPermissionService {
  /** Runtime store for accessing active sessions */
  private readonly sessionRuntime: SessionRuntimePort;

  /**
   * Creates a RespondPermissionService with required dependencies
   */
  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  /**
   * Processes a user's permission decision and resolves the request
   *
   * @param input - Permission response input parameters
   * @returns The ACP permission response object
   * @throws Error if session or permission request is not found
   * @throws Error if the resolver is invalid
   */
  async execute(input: {
    /** The owning user identifier */
    userId: string;
    /** The chat session identifier */
    chatId: string;
    /** The permission request identifier */
    requestId: string;
    /** The user's decision ("allow", "reject", or specific option ID) */
    decision: string;
  }): Promise<acp.RequestPermissionResponse> {
    let resolvedResponse: acp.RequestPermissionResponse | undefined;

    await this.sessionRuntime.runExclusive(input.chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId: input.chatId,
        op: OP,
      });
      const session = this.sessionRuntime.get(input.chatId);
      if (!session || session.userId !== input.userId) {
        throw new NotFoundError("Chat not found", {
          module: "tooling",
          op: OP,
          details: { chatId: input.chatId, requestId: input.requestId },
        });
      }

      const pending = session.pendingPermissions.get(input.requestId);
      if (!pending) {
        throw new NotFoundError(
          "Permission request not found or already handled",
          {
            module: "tooling",
            op: OP,
            details: { chatId: input.chatId, requestId: input.requestId },
          }
        );
      }

      const options = Array.isArray(pending.options)
        ? (pending.options as acp.PermissionOption[])
        : [];
      const selection = resolvePermissionSelection({
        decision: input.decision,
        options,
      });
      const optionId = selection.optionId;

      if (typeof pending.resolve !== "function") {
        throw new ValidationError("Invalid permission resolver", {
          module: "tooling",
          op: OP,
          details: { chatId: input.chatId, requestId: input.requestId },
        });
      }

      const response: acp.RequestPermissionResponse = {
        outcome: { outcome: "selected", optionId },
      };
      const runtime = new SessionRuntimeEntity(session);
      await settlePendingPermission({
        chatId: input.chatId,
        requestId: input.requestId,
        pending,
        session,
        response,
        approved: selection.approved,
        reason: optionId,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        syncStatusAfterPermissionDecision: (turnId) =>
          runtime.syncStatusAfterPermissionDecision(
            {
              chatId: input.chatId,
              broadcast: this.sessionRuntime.broadcast.bind(
                this.sessionRuntime
              ),
            },
            turnId
          ),
      });
      resolvedResponse = response;
    });

    if (!resolvedResponse) {
      throw new NotFoundError("Chat not found", {
        module: "tooling",
        op: OP,
        details: { chatId: input.chatId, requestId: input.requestId },
      });
    }

    return resolvedResponse;
  }
}
