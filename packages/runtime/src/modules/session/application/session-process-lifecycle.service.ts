import type { ChildProcess } from "node:child_process";
import { SessionRuntimeEntity } from "#runtime/modules/session/domain/session-runtime.entity";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { ChatSession } from "#runtime/shared/types/session.types";
import { terminateSessionTerminals } from "#runtime/shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type {
  AgentSessionStoppedContext,
  SessionLifecycleNotifier,
} from "./session-lifecycle.notifier";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const EXPECTED_TERMINATION_SIGNALS = new Set<NodeJS.Signals>([
  "SIGTERM",
  "SIGINT",
  "SIGKILL",
]);

type ProcessOutcome =
  | { kind: "error"; message: string }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "close"; code: number | null; signal: NodeJS.Signals | null };

/**
 * Attaches one-shot process lifecycle settlement to a running session process.
 *
 * Ordering invariant: exactly one of error/exit/close settles the runtime,
 * broadcasts any terminal error, updates persisted status, terminates session
 * terminals, then removes the matching runtime entry under the mutation lock.
 */
export class SessionProcessLifecycleService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly logger: LoggerPort;
  private readonly sessionLifecycleNotifier?: SessionLifecycleNotifier;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort,
    logger: LoggerPort,
    sessionLifecycleNotifier?: SessionLifecycleNotifier
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
    this.logger = logger;
    this.sessionLifecycleNotifier = sessionLifecycleNotifier;
  }

  attach(proc: ChildProcess, chatId: string): void {
    let settled = false;
    const settleLifecycle = async (outcome: ProcessOutcome): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        this.logOutcome(chatId, outcome);
        let unexpectedStop: AgentSessionStoppedContext | undefined;
        await this.sessionRuntime.runExclusive(chatId, async () => {
          assertSessionMutationLock({
            sessionRuntime: this.sessionRuntime,
            chatId,
            op: "session.lifecycle.process",
          });
          const session = this.sessionRuntime.get(chatId);
          const transition = this.resolveTransition(outcome);
          unexpectedStop = buildUnexpectedStopContext(
            session,
            chatId,
            transition.errorMessage
          );
          if (transition.errorMessage) {
            await this.sessionRuntime.broadcast(chatId, {
              type: "error",
              error: transition.errorMessage,
            });
          }
          if (session) {
            const runtime = new SessionRuntimeEntity(session);
            if (transition.status === "inactive") {
              await runtime.markInactive({
                chatId,
                broadcast: this.sessionRuntime.broadcast.bind(
                  this.sessionRuntime
                ),
              });
            } else {
              await runtime.markError({
                chatId,
                broadcast: this.sessionRuntime.broadcast.bind(
                  this.sessionRuntime
                ),
              });
            }
          }

          if (session?.userId) {
            await this.sessionRepo.updateStatus(
              chatId,
              session.userId,
              "stopped"
            );
          }
          if (session) {
            await terminateSessionTerminals(session);
            this.sessionRuntime.deleteIfMatch(chatId, session);
          }
        });
        if (unexpectedStop) {
          await this.sessionLifecycleNotifier?.agentSessionStopped(
            unexpectedStop
          );
        }
      } catch (error) {
        this.logger.error("Failed to process agent lifecycle event", {
          chatId,
          outcome: outcome.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    proc.on("error", (error: Error) => {
      settleLifecycle({ kind: "error", message: error.message }).catch(
        (lifecycleError: unknown) => {
          this.logger.error("Failed to settle process lifecycle", {
            chatId,
            outcome: "error",
            error:
              lifecycleError instanceof Error
                ? lifecycleError.message
                : String(lifecycleError),
          });
        }
      );
    });
    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      settleLifecycle({ kind: "exit", code, signal }).catch(
        (lifecycleError: unknown) => {
          this.logger.error("Failed to settle process lifecycle", {
            chatId,
            outcome: "exit",
            code,
            signal,
            error:
              lifecycleError instanceof Error
                ? lifecycleError.message
                : String(lifecycleError),
          });
        }
      );
    });
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      settleLifecycle({ kind: "close", code, signal }).catch(
        (lifecycleError: unknown) => {
          this.logger.error("Failed to settle process lifecycle", {
            chatId,
            outcome: "close",
            code,
            signal,
            error:
              lifecycleError instanceof Error
                ? lifecycleError.message
                : String(lifecycleError),
          });
        }
      );
    });
  }

  private logOutcome(chatId: string, outcome: ProcessOutcome): void {
    if (outcome.kind === "error") {
      this.logger.error("Agent process error", {
        chatId,
        error: outcome.message,
      });
      return;
    }

    this.logger.info(
      outcome.kind === "exit" ? "Agent process exited" : "Agent process closed",
      {
        chatId,
        code: outcome.code,
        signal: outcome.signal,
      }
    );
  }

  private resolveTransition(outcome: ProcessOutcome): {
    status: "inactive" | "error";
    errorMessage?: string;
  } {
    if (outcome.kind === "error") {
      return {
        status: "error",
        errorMessage: `Agent process error: ${outcome.message}`,
      };
    }

    if (isCleanExit(outcome.code, outcome.signal)) {
      return {
        status: "inactive",
      };
    }

    return {
      status: "error",
      errorMessage: `Agent process exited with ${formatExitReason(outcome.code, outcome.signal)}`,
    };
  }
}

function buildUnexpectedStopContext(
  session: ChatSession | undefined,
  chatId: string,
  errorMessage: string | undefined
): AgentSessionStoppedContext | undefined {
  if (
    !(session?.userId && (session.activePromptTask || session.activeTurnId))
  ) {
    return undefined;
  }
  return {
    userId: session.userId,
    projectRoot: session.projectRoot,
    ...(session.projectId ? { projectId: session.projectId } : {}),
    chatId,
    ...(session.sessionId ? { agentSessionId: session.sessionId } : {}),
    stopReason:
      errorMessage ??
      "Agent process stopped before completing its active prompt",
  };
}

function isCleanExit(
  code: number | null,
  signal: NodeJS.Signals | null
): boolean {
  if (code === 0) {
    return true;
  }
  return (
    code === null && Boolean(signal && EXPECTED_TERMINATION_SIGNALS.has(signal))
  );
}

function formatExitReason(
  code: number | null,
  signal: NodeJS.Signals | null
): string {
  if (signal) {
    return `signal ${signal}`;
  }
  return `code ${code ?? "unknown"}`;
}
