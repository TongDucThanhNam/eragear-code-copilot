import { observable } from "@trpc/server/observable";
import type { TerminalEvent } from "@/modules/terminal";

export interface TerminalEventsService {
  subscribe(
    userId: string,
    terminalId: string,
    listener: (event: TerminalEvent) => void
  ): () => void;
}

export interface CreateTerminalEventsObservableParams {
  service: TerminalEventsService;
  userId: string;
  terminalId: string;
}

export function createTerminalEventsObservable(
  params: CreateTerminalEventsObservableParams
) {
  return observable<TerminalEvent>((emit) => {
    const unsubscribe = params.service.subscribe(
      params.userId,
      params.terminalId,
      (event) => emit.next(event)
    );
    return () => unsubscribe();
  });
}
