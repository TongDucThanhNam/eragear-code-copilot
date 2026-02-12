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
import { NotFoundError, ValidationError } from "@/shared/errors";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import {
  buildToolApprovalResponsePart,
  upsertToolPart,
} from "@/shared/utils/ui-message.util";

const OP = "tooling.permission.respond";

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
    /** The chat session identifier */
    chatId: string;
    /** The permission request identifier */
    requestId: string;
    /** The user's decision ("allow", "reject", or specific option ID) */
    decision: string;
  }): Promise<acp.RequestPermissionResponse> {
    const session = this.sessionRuntime.get(input.chatId);
    if (!session) {
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

    // Determine the option ID based on user decision
    let optionId = input.decision === "allow" ? "allow-once" : "reject-once";

    const options = Array.isArray(pending.options)
      ? (pending.options as acp.PermissionOption[])
      : [];
    if (options.length > 0) {
      // Check for exact match
      const exactMatch = options.find(
        (opt: acp.PermissionOption) => opt.optionId === input.decision
      );

      if (exactMatch) {
        optionId = exactMatch.optionId;
      } else {
        // Heuristic matching based on keywords
        const isAllow = input.decision === "allow";
        const keywords = isAllow
          ? ["allow", "yes", "confirm", "approve"]
          : ["reject", "no", "cancel", "deny", "block"];

        const heuristicMatch = options.find((opt: acp.PermissionOption) => {
          const id = String(opt.optionId || opt.kind || "").toLowerCase();
          const name = String(opt.name || "").toLowerCase();

          if (isAllow) {
            if (id === "allow" || id === "allow_once") {
              return true;
            }
            return keywords.some(
              (keyword) => id.includes(keyword) || name.includes(keyword)
            );
          }

          return keywords.some(
            (keyword) => id.includes(keyword) || name.includes(keyword)
          );
        });

        if (heuristicMatch) {
          optionId = heuristicMatch.optionId;
        }
      }
    }

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
    pending.resolve(response);
    session.pendingPermissions.delete(input.requestId);
    let nextStatus = session.chatStatus;
    if (session.pendingPermissions.size > 0) {
      nextStatus = "awaiting_permission";
    } else if (session.chatStatus === "awaiting_permission") {
      nextStatus = "streaming";
    }
    if (nextStatus !== session.chatStatus) {
      await updateChatStatus({
        chatId: input.chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: nextStatus,
      });
    }
    if (pending.toolCallId) {
      const approved = optionId.toLowerCase().includes("allow");
      const toolPart = buildToolApprovalResponsePart({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName ?? "tool",
        title: pending.title,
        input: pending.input,
        approvalId: input.requestId,
        approved,
        reason: optionId,
        meta: pending.meta,
      });
      const { message } = upsertToolPart({
        state: session.uiState,
        part: toolPart,
      });
      await this.sessionRuntime.broadcast(input.chatId, {
        type: "ui_message",
        message,
      });
    }
    return response;
  }
}
