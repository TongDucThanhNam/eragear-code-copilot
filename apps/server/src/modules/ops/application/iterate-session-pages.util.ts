import type { SessionRepositoryPort } from "@/modules/session";
import type { StoredSession } from "@/shared/types/session.types";

const DASHBOARD_AGGREGATION_PAGE_SIZE = 500;

export async function forEachSessionPage(
  sessionRepo: SessionRepositoryPort,
  userId: string,
  handler: (sessions: StoredSession[]) => void | Promise<void>
): Promise<void> {
  let offset = 0;

  while (true) {
    const sessions = await sessionRepo.findAll(userId, {
      limit: DASHBOARD_AGGREGATION_PAGE_SIZE,
      offset,
    });
    if (sessions.length === 0) {
      break;
    }

    await handler(sessions);

    if (sessions.length < DASHBOARD_AGGREGATION_PAGE_SIZE) {
      break;
    }
    offset += sessions.length;
  }
}
