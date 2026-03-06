export type SubmitConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export type SubmitChatStatus =
  | "inactive"
  | "connecting"
  | "ready"
  | "submitted"
  | "streaming"
  | "awaiting_permission"
  | "cancelling"
  | "error";

export function resolvePromptInputSubmitStatus(params: {
  connStatus: SubmitConnectionStatus;
  status: SubmitChatStatus;
}): SubmitChatStatus {
  return params.status;
}

export function isPromptSubmitDisabled(params: {
  connStatus: SubmitConnectionStatus;
  status: SubmitChatStatus;
}): boolean {
  if (params.connStatus !== "connected") {
    return true;
  }
  if (
    params.status === "streaming" ||
    params.status === "awaiting_permission"
  ) {
    return false;
  }
  return params.status !== "ready";
}
