export type SessionRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: string };

interface SessionRoutePayload {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is SessionRoutePayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseSessionActionRouteInput(
  payload: unknown
): SessionRouteInputResult<{ chatId: string }> {
  if (!isRecord(payload) || typeof payload.chatId !== "string") {
    return { ok: false, error: "chatId is required" };
  }
  if (payload.chatId.length === 0) {
    return { ok: false, error: "chatId is required" };
  }
  return { ok: true, input: { chatId: payload.chatId } };
}
