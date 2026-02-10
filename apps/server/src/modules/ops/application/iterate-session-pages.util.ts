import type { SessionRepositoryPort } from "@/modules/session";
import type { StoredSession } from "@/shared/types/session.types";

const DASHBOARD_AGGREGATION_PAGE_SIZE = 500;

export async function forEachSessionPage(
  sessionRepo: SessionRepositoryPort,
  userId: string,
  handler: (sessions: StoredSession[]) => void | Promise<void>
): Promise<void> {
  let cursor: string | undefined;

  while (true) {
    const page = await sessionRepo.findPage(userId, {
      limit: DASHBOARD_AGGREGATION_PAGE_SIZE,
      cursor,
    });
    if (page.sessions.length === 0) {
      break;
    }

    await handler(page.sessions);

    if (!(page.hasMore && page.nextCursor)) {
      break;
    }
    cursor = page.nextCursor;
  }
}
