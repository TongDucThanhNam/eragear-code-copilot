import { AppError } from "@/shared/errors";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

export function assertSessionMutationLock(params: {
  sessionRuntime: SessionRuntimePort;
  chatId: string;
  op: string;
}): void {
  if (params.sessionRuntime.isLockHeld(params.chatId)) {
    return;
  }
  throw new AppError({
    message:
      "Session mutation invariant violated: mutation must run inside sessionRuntime.runExclusive",
    code: "SESSION_LOCK_REQUIRED",
    statusCode: 500,
    module: "session",
    op: params.op,
    details: { chatId: params.chatId },
  });
}
