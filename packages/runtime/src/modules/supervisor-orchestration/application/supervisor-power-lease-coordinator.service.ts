import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  evaluateSupervisorPowerPolicy,
  type SupervisorPowerPolicyDecision,
} from "./supervisor-power-policy.service";

export interface SupervisorPowerLeasePort {
  isOnAcPower(): Promise<boolean>;
  apply(decision: SupervisorPowerPolicyDecision): Promise<void>;
  dispose(): Promise<void>;
}

export class SupervisorPowerLeaseCoordinator {
  private unsubscribe: (() => void) | null = null;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly runs: SupervisorRunRepositoryPort;
  private readonly eventBus: EventBusPort;
  private readonly power: SupervisorPowerLeasePort;

  constructor(
    runs: SupervisorRunRepositoryPort,
    eventBus: EventBusPort,
    power: SupervisorPowerLeasePort
  ) {
    this.runs = runs;
    this.eventBus = eventBus;
    this.power = power;
  }

  start(): void {
    if (this.unsubscribe) {
      return;
    }
    this.unsubscribe = this.eventBus.subscribe((event) => {
      if (event.type !== "supervisor_run_updated") {
        return;
      }
      const previous = this.pending.get(event.userId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          await this.reconcile(event.userId);
        })
        .finally(() => {
          if (this.pending.get(event.userId) === next) {
            this.pending.delete(event.userId);
          }
        });
      this.pending.set(event.userId, next);
    });
  }

  async reconcile(userId: string): Promise<SupervisorPowerPolicyDecision> {
    const [runs, onAcPower] = await Promise.all([
      this.runs.list({ userId, includeTerminal: false }),
      this.power.isOnAcPower(),
    ]);
    const decision = evaluateSupervisorPowerPolicy({ runs, onAcPower });
    await this.power.apply(decision);
    return decision;
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.allSettled(this.pending.values());
    this.pending.clear();
    await this.power.dispose();
  }
}
