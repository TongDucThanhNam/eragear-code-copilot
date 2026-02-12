export class DashboardEventVisibilityService {
  isVisible(event: unknown, userId: string): boolean {
    if (!event || typeof event !== "object" || !("userId" in event)) {
      return true;
    }
    const eventUserId = (event as { userId?: unknown }).userId;
    return typeof eventUserId === "string" && eventUserId === userId;
  }
}
