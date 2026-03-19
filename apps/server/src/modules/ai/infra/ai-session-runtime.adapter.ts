import path from "node:path";
import type {
  ContentBlock,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { assertSessionMutationLock } from "@/modules/session/application/session-runtime-lock.assert";
import { SessionRuntimeEntity } from "@/modules/session/domain/session-runtime.entity";
import { AppError, NotFoundError } from "@/shared/errors";
import type { ChatSession } from "@/shared/types/session.types";
import type { AppConfig } from "@/shared/types/settings.types";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { normalizeExecutablePathForPlatform } from "@/shared/utils/runtime-platform.util";
import type {
  AiAssertSessionRunningInput,
  AiRequireSessionInput,
  AiSessionRuntimePort,
  AiStopSessionInput,
} from "../application/ports/ai-session-runtime.port";
import { AiSessionRuntimeError } from "../application/ports/ai-session-runtime.port";
import {
  classifyAcpError,
  getAcpErrorText,
  isMethodNotFound,
} from "./acp-error.mapper";

interface ConnWithUnstableModel {
  unstable_setSessionModel: (params: {
    sessionId: string;
    modelId: string;
  }) => Promise<void>;
}

interface PromptMetaPolicySnapshot {
  acpPromptMetaPolicy: AppConfig["acpPromptMetaPolicy"];
  acpPromptMetaAllowlist: string[];
}

interface AiSessionRuntimeAdapterOptions {
  promptMetaPolicyProvider?: () => PromptMetaPolicySnapshot;
}

const DEFAULT_PROMPT_META_POLICY: PromptMetaPolicySnapshot = {
  acpPromptMetaPolicy: "allowlist",
  acpPromptMetaAllowlist: [],
};
const PROMPT_META_COMPATIBILITY_ERROR_PATTERNS = [
  "prompt parameter was not received normally",
  "invalid params",
  "unknown field",
  "unexpected property",
  "validation",
  "_meta",
] as const;

function normalizePromptMetaAllowlistEntry(entry: string): string {
  const normalized = entry.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    return normalizeExecutablePathForPlatform(normalized);
  }
  return normalized.toLowerCase();
}

function buildPromptMetaIdentifiers(session: ChatSession): string[] {
  const identifiers: string[] = [];
  const push = (value: string | undefined) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return;
    }
    identifiers.push(normalizePromptMetaAllowlistEntry(value));
  };

  if (typeof session.proc.spawnfile === "string") {
    push(session.proc.spawnfile);
    push(path.basename(session.proc.spawnfile));
  }
  const firstSpawnArg = Array.isArray(session.proc.spawnargs)
    ? session.proc.spawnargs[0]
    : undefined;
  if (typeof firstSpawnArg === "string") {
    push(firstSpawnArg);
    push(path.basename(firstSpawnArg));
  }
  push(session.agentInfo?.name);
  return [...new Set(identifiers)];
}

export class AiSessionRuntimeAdapter implements AiSessionRuntimePort {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly promptMetaPolicyProvider: () => PromptMetaPolicySnapshot;
  private readonly promptMetaDisabledSessions = new WeakSet<ChatSession>();

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort,
    options?: AiSessionRuntimeAdapterOptions
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
    this.promptMetaPolicyProvider =
      options?.promptMetaPolicyProvider ?? (() => DEFAULT_PROMPT_META_POLICY);
  }

  requireAuthorizedSession(input: AiRequireSessionInput): ChatSession {
    const session = this.sessionRuntime.get(input.chatId);
    if (!session?.sessionId || session.userId !== input.userId) {
      throw new NotFoundError("Chat not found", {
        module: input.module,
        op: input.op,
        details: { chatId: input.chatId, ...input.details },
      });
    }
    return session;
  }

  requireAuthorizedRuntime(input: AiRequireSessionInput): SessionRuntimeEntity {
    return new SessionRuntimeEntity(this.requireAuthorizedSession(input));
  }

  assertSessionRunning(input: AiAssertSessionRunningInput): void {
    const { session, module, op, chatId, details } = input;
    const runtime = new SessionRuntimeEntity(session);
    try {
      runtime.assertProcessRunning(module, op, chatId);
      runtime.assertConnectionOpen(module, op, chatId);
    } catch (error) {
      if (error instanceof AppError && details) {
        throw new AppError({
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
          module: error.module,
          op: error.op,
          details: { ...(error.details ?? {}), ...details },
          cause: error,
        });
      }
      throw error;
    }
  }

  async prompt(
    session: ChatSession,
    prompt: ContentBlock[],
    options?: { maxTokens?: number; signal?: AbortSignal }
  ): Promise<{ stopReason: string }> {
    const maxTokens =
      options?.maxTokens !== undefined
        ? Math.max(1, Math.trunc(options.maxTokens))
        : undefined;
    const signal = options?.signal;
    const meta =
      maxTokens !== undefined
        ? {
            maxTokens,
            max_tokens: maxTokens,
          }
        : undefined;
    const promptRequest = {
      sessionId: session.sessionId ?? "",
      prompt,
    };
    const shouldAttachMeta =
      meta !== undefined && this.shouldAttachPromptMeta(session);
    if (!shouldAttachMeta) {
      return await this.runAbortablePromptRequest(session, signal, () =>
        this.wrapAcpCall(() => session.conn.prompt(promptRequest))
      );
    }
    try {
      return await this.runAbortablePromptRequest(session, signal, () =>
        this.wrapAcpCall(() =>
          session.conn.prompt({
            ...promptRequest,
            _meta: meta,
          })
        )
      );
    } catch (error) {
      if (!this.shouldRetryPromptWithoutMeta(error)) {
        throw error;
      }
      this.promptMetaDisabledSessions.add(session);
      return await this.runAbortablePromptRequest(session, signal, () =>
        this.wrapAcpCall(() => session.conn.prompt(promptRequest))
      );
    }
  }

  async cancelPrompt(session: ChatSession): Promise<void> {
    await this.wrapAcpCall(() =>
      session.conn.cancel({
        sessionId: session.sessionId ?? "",
      })
    );
  }

  async setSessionMode(session: ChatSession, modeId: string): Promise<void> {
    await this.wrapAcpCall(
      () =>
        session.conn.setSessionMode({
          sessionId: session.sessionId ?? "",
          modeId,
        }),
      { classifyMethodNotSupported: true }
    );
  }

  async setSessionModel(session: ChatSession, modelId: string): Promise<void> {
    await this.wrapAcpCall(
      () =>
        (
          session.conn as unknown as ConnWithUnstableModel
        ).unstable_setSessionModel({
          sessionId: session.sessionId ?? "",
          modelId,
        }),
      { classifyMethodNotSupported: true }
    );
  }

  async setSessionConfigOption(
    session: ChatSession,
    configId: string,
    value: string
  ): Promise<SessionConfigOption[]> {
    const response = await this.wrapAcpCall(
      () =>
        session.conn.setSessionConfigOption({
          sessionId: session.sessionId ?? "",
          configId,
          value,
        }),
      { classifyMethodNotSupported: true }
    );
    return response.configOptions ?? [];
  }

  async stopAndCleanup(input: AiStopSessionInput): Promise<void> {
    const { chatId, session, reason, killProcess, turnId } = input;
    await this.sessionRuntime.runExclusive(chatId, async () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: "ai.session.stop_and_cleanup",
      });
      const currentSession = this.sessionRuntime.get(chatId);
      if (!currentSession || currentSession !== session) {
        return;
      }
      await this.sessionRuntime.broadcast(chatId, {
        type: "error",
        error: reason,
      });
      await new SessionRuntimeEntity(currentSession).markError(
        {
          chatId,
          broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        },
        turnId
      );
      await this.sessionRepo.updateStatus(
        chatId,
        currentSession.userId,
        "stopped"
      );
      if (currentSession.activePromptTask?.noSubscriberAbortTimer) {
        clearTimeout(currentSession.activePromptTask.noSubscriberAbortTimer);
      }
      currentSession.activeTurnId = undefined;
      currentSession.activePromptTask = undefined;
    });
    if (killProcess) {
      await terminateProcessGracefully(session.proc, {
        forceWindowsTreeTermination: true,
      });
    }
    await this.sessionRuntime.runExclusive(chatId, () => {
      assertSessionMutationLock({
        sessionRuntime: this.sessionRuntime,
        chatId,
        op: "ai.session.stop_and_cleanup",
      });
      this.sessionRuntime.deleteIfMatch(chatId, session);
    });
  }

  clearPendingPermissionsAsCancelled(session: ChatSession): void {
    new SessionRuntimeEntity(session).cancelPendingPermissionsAsCancelled();
  }

  private async wrapAcpCall<T>(
    work: () => Promise<T>,
    options?: { classifyMethodNotSupported?: boolean }
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw this.mapAcpError(error, options);
    }
  }

  private async runAbortablePromptRequest<T>(
    session: ChatSession,
    signal: AbortSignal | undefined,
    work: () => Promise<T>
  ): Promise<T> {
    if (!signal) {
      return await work();
    }
    if (signal.aborted) {
      throw createPromptAbortError(signal.reason);
    }

    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };
      const settleResolve = (value: T) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        this.cancelPrompt(session).catch(() => undefined);
        settleReject(createPromptAbortError(signal.reason));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      work().then(settleResolve, settleReject);
    });
  }

  private mapAcpError(
    error: unknown,
    options?: { classifyMethodNotSupported?: boolean }
  ): AiSessionRuntimeError {
    const text = getAcpErrorText(error);
    if (options?.classifyMethodNotSupported && isMethodNotFound(text)) {
      return new AiSessionRuntimeError({
        kind: "method_not_supported",
        message: text || "Method not supported by agent",
        cause: error,
      });
    }

    const classified = classifyAcpError(error);
    if (classified.kind === "retryable_transport") {
      return new AiSessionRuntimeError({
        kind: "retryable_transport",
        message: classified.text || "Transport is temporarily unavailable",
        cause: error,
      });
    }
    if (classified.kind === "fatal_process") {
      return new AiSessionRuntimeError({
        kind: "process_exited",
        message: classified.text || "Agent process exited",
        cause: error,
      });
    }
    if (classified.kind === "fatal_session") {
      return new AiSessionRuntimeError({
        kind: "session_unavailable",
        message: classified.text || "Agent session is unavailable",
        cause: error,
      });
    }

    return new AiSessionRuntimeError({
      kind: "unknown",
      message:
        classified.text ||
        (error instanceof Error ? error.message : "Unknown ACP failure"),
      cause: error,
    });
  }

  private shouldAttachPromptMeta(session: ChatSession): boolean {
    if (this.promptMetaDisabledSessions.has(session)) {
      return false;
    }
    const policy = this.promptMetaPolicyProvider();
    if (policy.acpPromptMetaPolicy === "never") {
      return false;
    }
    if (policy.acpPromptMetaPolicy === "always") {
      return true;
    }
    const allowlist = new Set(
      policy.acpPromptMetaAllowlist
        .map((entry) => normalizePromptMetaAllowlistEntry(entry))
        .filter((entry) => entry.length > 0)
    );
    if (allowlist.size === 0) {
      return false;
    }
    const identifiers = buildPromptMetaIdentifiers(session);
    return identifiers.some((identifier) => allowlist.has(identifier));
  }

  private shouldRetryPromptWithoutMeta(error: unknown): boolean {
    if (!(error instanceof AiSessionRuntimeError)) {
      return false;
    }
    if (error.kind !== "unknown") {
      return false;
    }
    const text = error.message.toLowerCase();
    return PROMPT_META_COMPATIBILITY_ERROR_PATTERNS.some((pattern) =>
      text.includes(pattern)
    );
  }
}

function createPromptAbortError(reason: unknown): AiSessionRuntimeError {
  const message =
    typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "Prompt aborted";
  return new AiSessionRuntimeError({
    kind: "cancelled",
    message,
    details: { reason: reason ?? null },
  });
}
