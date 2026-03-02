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
  const { connStatus, status } = params;
  if (connStatus === "connected" && status === "error") {
    return "ready";
  }
  return status;
}

export function isPromptSubmitDisabled(params: {
  connStatus: SubmitConnectionStatus;
  status: SubmitChatStatus;
}): boolean {
  if (params.connStatus !== "connected") {
    return true;
  }
  return (
    params.status === "submitted" ||
    params.status === "connecting" ||
    params.status === "cancelling"
  );
}
