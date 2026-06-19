import { SessionEventsInputSchema } from "#runtime/modules/session";
// biome-ignore lint/style/noRestrictedImports: Platform logging required for router subscription adapter
import { createLogger } from "#runtime/platform/logging/structured-logger";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";
import { createSessionEventsObservable } from "./session-events-observable";

const logger = createLogger("tRPC");

export const sessionEventsRouter = router({
  /** Subscribe to real-time session events */
  onSessionEvents: protectedProcedure
    .input(SessionEventsInputSchema)
    .subscription(({ input, ctx }) => {
      return createSessionEventsObservable({
        service: ctx.useCases.session.events,
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        logger,
      });
    }),
});
