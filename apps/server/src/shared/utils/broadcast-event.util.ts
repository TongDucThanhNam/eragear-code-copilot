import type { BroadcastEvent } from "@/shared/types/session.types";

function cloneWithJsonFallback<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneBroadcastEvent(event: BroadcastEvent): BroadcastEvent {
  try {
    return structuredClone(event);
  } catch {
    return cloneWithJsonFallback(event);
  }
}

export function cloneBroadcastEvents(
  events: BroadcastEvent[]
): BroadcastEvent[] {
  return events.map((event) => cloneBroadcastEvent(event));
}
