/**
 * Serializes workflow effect I/O and authority-changing controls per run.
 *
 * Effect execution holds this boundary through its durable result commit. A
 * pause, cancellation, or authority rotation uses the same boundary before it
 * is accepted. This gives those operations one process-local linearization
 * point while the workflow journal supplies crash recovery for started work.
 */
export interface SupervisorWorkflowRunBoundaryPort {
  runExclusive<T>(runId: string, operation: () => T | Promise<T>): Promise<T>;
}

interface PendingRunOperation {
  readonly ready: Promise<void>;
  release(): void;
}

export class SupervisorWorkflowRunBoundary
  implements SupervisorWorkflowRunBoundaryPort
{
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(
    runId: string,
    operation: () => T | Promise<T>
  ): Promise<T> {
    const previous = this.tails.get(runId) ?? Promise.resolve();
    const pending = createPendingRunOperation();
    const tail = previous.catch(() => undefined).then(() => pending.ready);
    this.tails.set(runId, tail);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      pending.release();
      if (this.tails.get(runId) === tail) {
        this.tails.delete(runId);
      }
    }
  }
}

function createPendingRunOperation(): PendingRunOperation {
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}
