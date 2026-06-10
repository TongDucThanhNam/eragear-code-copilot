/**
 * Filters dashboard events for one authenticated user.
 *
 * Invariant: events without a `userId` are treated as global; user-scoped events
 * are visible only to the matching user.
 */
export class DashboardEventVisibilityService {
  isVisible(event: unknown, userId: string): boolean {
    if (!event || typeof event !== "object" || !("userId" in event)) {
      return true;
    }
    const eventUserId = (event as { userId?: unknown }).userId;
    return typeof eventUserId === "string" && eventUserId === userId;
  }
}
