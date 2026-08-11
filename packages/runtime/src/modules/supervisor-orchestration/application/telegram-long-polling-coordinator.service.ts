import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { TelegramManagerBridgeService } from "./telegram-manager-bridge.service";

const RETRY_DELAY_MS = 5000;

export class TelegramLongPollingCoordinator {
  private stopped = true;
  private loopPromise: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;
  private abortController: AbortController | null = null;
  private readonly bridge: TelegramManagerBridgeService;
  private readonly eventBus: EventBusPort;
  private readonly userIds: () => string[];

  constructor(
    bridge: TelegramManagerBridgeService,
    eventBus: EventBusPort,
    userIds: () => string[]
  ) {
    this.bridge = bridge;
    this.eventBus = eventBus;
    this.userIds = userIds;
  }

  start(): void {
    if (
      !this.stopped ||
      process.env.ERAGEAR_RUNTIME_TRANSPORT !== "user-daemon"
    ) {
      return;
    }
    this.stopped = false;
    this.abortController = new AbortController();
    this.unsubscribe = this.eventBus.subscribe((event) => {
      if (event.type === "supervisor_run_updated") {
        this.bridge
          .notifyRunUpdate(event.userId, event.update)
          .catch(() => undefined);
      }
    });
    this.loopPromise = this.pollLoop();
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    this.abortController?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.loopPromise;
    this.loopPromise = null;
    this.abortController = null;
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        for (const userId of this.userIds()) {
          await this.bridge.pollOnce(userId, this.abortController?.signal);
        }
      } catch {
        // Network failures are retried; secrets and Telegram payloads are never logged.
      }
      if (!this.stopped) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
}
