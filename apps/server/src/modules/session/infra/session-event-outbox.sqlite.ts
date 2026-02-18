import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { getSqliteDb } from "@/platform/storage/sqlite-store";
import { enqueueSqliteWrite } from "@/platform/storage/sqlite-write-queue";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { createId } from "@/shared/utils/id.util";
import { withTimeout } from "@/shared/utils/timeout.util";
import type {
  SessionEventOutboxDispatchPolicy,
  SessionEventOutboxDispatchResult,
  SessionEventOutboxEnqueueInput,
  SessionEventOutboxPort,
} from "../application/ports/session-event-outbox.port";

const logger = createLogger("Storage");
const DEFAULT_DISPATCH_BATCH_SIZE = 100;
const DEFAULT_DISPATCH_MAX_ATTEMPTS = 10;

interface SessionOutboxRow {
  id: string;
  eventJson: string;
  attemptCount: number;
}

function toPublishTimeoutMs(policy: SessionEventOutboxDispatchPolicy): number {
  const configured = Math.max(1, Math.trunc(policy.publishTimeoutMs));
  return Number.isFinite(configured)
    ? configured
    : ENV.sessionEventBusPublishTimeoutMs;
}

function toBatchSize(policy: SessionEventOutboxDispatchPolicy): number {
  const configured = Math.max(1, Math.trunc(policy.batchSize));
  return Number.isFinite(configured) ? configured : DEFAULT_DISPATCH_BATCH_SIZE;
}

function toMaxAttempts(policy: SessionEventOutboxDispatchPolicy): number {
  const configured = Math.max(1, Math.trunc(policy.maxAttempts));
  return Number.isFinite(configured)
    ? configured
    : DEFAULT_DISPATCH_MAX_ATTEMPTS;
}

function toRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  return Math.min(60_000, 100 * 2 ** Math.min(8, safeAttempt - 1));
}

export class SessionEventOutboxSqliteAdapter implements SessionEventOutboxPort {
  async enqueue(input: SessionEventOutboxEnqueueInput): Promise<void> {
    const createdAt = Date.now();
    const event: DomainEvent = {
      type: "session_broadcast",
      chatId: input.chatId,
      userId: input.userId,
      event: input.event,
    };

    await enqueueSqliteWrite("session.event_outbox.enqueue", async () => {
      const db = await getSqliteDb();
      db.query(
        `INSERT INTO session_event_outbox (
          id,
          chat_id,
          user_id,
          event_json,
          status,
          attempt_count,
          next_attempt_at,
          created_at,
          published_at,
          last_error
        ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, NULL, NULL)`
      ).run(
        createId("outbox"),
        input.chatId,
        input.userId,
        JSON.stringify(event),
        createdAt,
        createdAt
      );
    });
  }

  async dispatch(
    eventBus: EventBusPort,
    policy: SessionEventOutboxDispatchPolicy
  ): Promise<SessionEventOutboxDispatchResult> {
    const now = Date.now();
    const publishTimeoutMs = toPublishTimeoutMs(policy);
    const batchSize = toBatchSize(policy);
    const maxAttempts = toMaxAttempts(policy);
    let dispatched = 0;
    let retried = 0;
    let failed = 0;

    const db = await getSqliteDb();
    const rows = db
      .query(
        `SELECT id, event_json AS eventJson, attempt_count AS attemptCount
         FROM session_event_outbox
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(now, batchSize) as SessionOutboxRow[];

    for (const row of rows) {
      let event: DomainEvent;
      try {
        event = JSON.parse(row.eventJson) as DomainEvent;
      } catch (error) {
        failed += 1;
        db.query(
          `UPDATE session_event_outbox
           SET status = 'failed',
               attempt_count = ?,
               last_error = ?,
               next_attempt_at = ?
           WHERE id = ?`
        ).run(
          Math.max(row.attemptCount + 1, maxAttempts),
          `invalid_event_json: ${error instanceof Error ? error.message : String(error)}`,
          now,
          row.id
        );
        continue;
      }

      try {
        await withTimeout(
          eventBus.publish(event),
          publishTimeoutMs,
          `Session outbox publish timed out after ${publishTimeoutMs}ms`
        );
        dispatched += 1;
        db.query(
          `UPDATE session_event_outbox
           SET status = 'published',
               published_at = ?,
               last_error = NULL
           WHERE id = ?`
        ).run(Date.now(), row.id);
      } catch (error) {
        const nextAttempt = row.attemptCount + 1;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (nextAttempt >= maxAttempts) {
          failed += 1;
          db.query(
            `UPDATE session_event_outbox
             SET status = 'failed',
                 attempt_count = ?,
                 last_error = ?,
                 next_attempt_at = ?
             WHERE id = ?`
          ).run(nextAttempt, errorMessage, Date.now(), row.id);
          logger.error(
            "Session event outbox publish permanently failed",
            error instanceof Error ? error : new Error(errorMessage),
            { outboxId: row.id, attempts: nextAttempt, maxAttempts }
          );
          continue;
        }

        retried += 1;
        db.query(
          `UPDATE session_event_outbox
           SET attempt_count = ?,
               last_error = ?,
               next_attempt_at = ?
           WHERE id = ?`
        ).run(
          nextAttempt,
          errorMessage,
          Date.now() + toRetryDelayMs(nextAttempt),
          row.id
        );
      }
    }

    const pendingRow = db
      .query(
        "SELECT COUNT(*) AS count FROM session_event_outbox WHERE status = 'pending'"
      )
      .get() as { count?: number } | null;
    const pending = Math.max(0, Number(pendingRow?.count ?? 0));

    return {
      dispatched,
      failed,
      retried,
      pending,
    };
  }
}
