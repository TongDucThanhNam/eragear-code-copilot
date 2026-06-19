import type {
  EventBusPort,
  EventBusPublishContext,
} from "../ports/event-bus.port";
import type { DomainEvent } from "../types/domain-events.types";

type DomainEventType = DomainEvent["type"];
type DomainEventOfType<T extends DomainEventType> = Extract<
  DomainEvent,
  { type: T }
>;

export function subscribeDomainEvents<
  const TEventTypes extends readonly DomainEventType[],
>(params: {
  eventBus: EventBusPort;
  types: TEventTypes;
  defer?: boolean;
  filter?: (event: DomainEventOfType<TEventTypes[number]>) => boolean;
  handler: (
    event: DomainEventOfType<TEventTypes[number]>,
    context: EventBusPublishContext
  ) => void | Promise<void>;
  onError?: (
    error: unknown,
    event: DomainEventOfType<TEventTypes[number]>
  ) => void;
}): () => void {
  const eventTypes = new Set<DomainEventType>(params.types);
  return params.eventBus.subscribe((event, context) => {
    if (context.signal.aborted || !eventTypes.has(event.type)) {
      return;
    }
    const typedEvent = event as DomainEventOfType<TEventTypes[number]>;
    if (params.filter && !params.filter(typedEvent)) {
      return;
    }
    const run = async () => {
      await params.handler(typedEvent, context);
    };
    const handleError = (error: unknown) => {
      if (params.onError) {
        params.onError(error, typedEvent);
        return;
      }
      throw error;
    };
    if (params.defer) {
      queueMicrotask(() => {
        run().catch(handleError);
      });
      return;
    }
    return run().catch(handleError);
  });
}
