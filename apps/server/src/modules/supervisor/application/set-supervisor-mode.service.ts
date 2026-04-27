import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import type { SupervisorMode } from "@/shared/types/supervisor.types";
import type { SupervisorPolicy } from "./supervisor-policy";
import { createSupervisorStatePatch } from "./supervisor-state.util";

const OP = "supervisor.mode.set";

export class SetSupervisorModeService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly policy: SupervisorPolicy;
  private readonly clock: ClockPort;

  constructor(deps: {
    sessionRepo: SessionRepositoryPort;
    sessionRuntime: SessionRuntimePort;
    policy: SupervisorPolicy;
    clock: ClockPort;
  }) {
    this.sessionRepo = deps.sessionRepo;
    this.sessionRuntime = deps.sessionRuntime;
    this.policy = deps.policy;
    this.clock = deps.clock;
  }

  async execute(input: {
    userId: string;
    chatId: string;
    mode: SupervisorMode;
  }) {
    if (input.mode === "full_autopilot") {
      this.assertSupervisorCanRun();
    }

    const now = this.clock.nowMs();
    const runtimeSession = this.sessionRuntime.get(input.chatId);
    if (runtimeSession?.userId === input.userId) {
      let supervisor = createSupervisorStatePatch({
        current: runtimeSession.supervisor,
        mode: input.mode,
        status: input.mode === "off" ? "idle" : "idle",
        reason:
          input.mode === "off"
            ? "Supervisor disabled for session"
            : "Supervisor enabled for session",
        now,
      });
      await this.sessionRuntime.runExclusive(input.chatId, async () => {
        const session = this.sessionRuntime.get(input.chatId);
        if (!session || session.userId !== input.userId) {
          return;
        }
        supervisor = createSupervisorStatePatch({
          current: session.supervisor,
          mode: input.mode,
          status: input.mode === "off" ? "idle" : "idle",
          reason:
            input.mode === "off"
              ? "Supervisor disabled for session"
              : "Supervisor enabled for session",
          now,
        });
        session.supervisor = supervisor;
        await this.sessionRepo.updateMetadata(input.chatId, input.userId, {
          supervisor,
        });
        await this.sessionRuntime.broadcast(input.chatId, {
          type: "supervisor_status",
          supervisor,
        });
      });
      return { supervisor };
    }

    const stored = await this.sessionRepo.findById(input.chatId, input.userId);
    if (!stored) {
      throw new NotFoundError("Chat not found", {
        module: "supervisor",
        op: OP,
        details: { chatId: input.chatId },
      });
    }

    const supervisor = createSupervisorStatePatch({
      current: stored.supervisor,
      mode: input.mode,
      status: input.mode === "off" ? "idle" : "idle",
      reason:
        input.mode === "off"
          ? "Supervisor disabled for session"
          : "Supervisor enabled for session",
      now,
    });
    await this.sessionRepo.updateMetadata(input.chatId, input.userId, {
      supervisor,
    });
    return { supervisor };
  }

  private assertSupervisorCanRun(): void {
    if (!this.policy.enabled) {
      throw new ValidationError("Supervisor is disabled by configuration", {
        module: "supervisor",
        op: OP,
      });
    }
    if (this.policy.model.trim().length === 0) {
      throw new ValidationError("SUPERVISOR_MODEL is required", {
        module: "supervisor",
        op: OP,
      });
    }
  }
}
