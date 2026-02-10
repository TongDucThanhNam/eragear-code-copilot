import type { ChildProcess } from "node:child_process";
import type { LoggerPort } from "@/shared/ports/logger.port";
import { updateChatStatus } from "@/shared/utils/chat-events.util";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export class SessionProcessLifecycleService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly logger: LoggerPort;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort,
    logger: LoggerPort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
    this.logger = logger;
  }

  attach(proc: ChildProcess, chatId: string): void {
    proc.on("error", async (err: Error) => {
      this.logger.error("Agent process error", {
        chatId,
        error: err.message,
      });
      this.sessionRuntime.broadcast(chatId, {
        type: "error",
        error: `Agent process error: ${err.message}`,
      });

      const session = this.sessionRuntime.get(chatId);
      updateChatStatus({
        chatId,
        session,
        broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
        status: "error",
      });
      if (session?.userId) {
        await this.sessionRepo.updateStatus(chatId, session.userId, "stopped");
      }
      if (session) {
        terminateSessionTerminals(session);
      }
    });

    proc.on(
      "exit",
      async (code: number | null, signal: NodeJS.Signals | null) => {
        this.logger.info("Agent process exited", {
          chatId,
          code,
          signal,
        });
        const isExpectedSignal = signal === "SIGTERM" || signal === "SIGINT";
        const isCleanExit = code === 0 || (code === null && isExpectedSignal);

        if (isCleanExit) {
          const session = this.sessionRuntime.get(chatId);
          updateChatStatus({
            chatId,
            session,
            broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
            status: "inactive",
          });
        } else {
          const reason = signal
            ? `signal ${signal}`
            : `code ${code ?? "unknown"}`;
          this.sessionRuntime.broadcast(chatId, {
            type: "error",
            error: `Agent process exited with ${reason}`,
          });
          const session = this.sessionRuntime.get(chatId);
          updateChatStatus({
            chatId,
            session,
            broadcast: this.sessionRuntime.broadcast.bind(this.sessionRuntime),
            status: "error",
          });
        }

        const session = this.sessionRuntime.get(chatId);
        if (session?.userId) {
          await this.sessionRepo.updateStatus(chatId, session.userId, "stopped");
        }
        if (session) {
          terminateSessionTerminals(session);
        }
        if (this.sessionRuntime.has(chatId)) {
          this.sessionRuntime.delete(chatId);
        }
      }
    );
  }
}
