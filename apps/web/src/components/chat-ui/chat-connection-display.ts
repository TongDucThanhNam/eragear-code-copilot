import type { ChatStatus, ConnectionStatus } from "@repo/shared";

export type ChatDisplayConnectionStatus = ConnectionStatus | "inactive";

interface ResolveDisplayConnStatusParams {
  status: ChatStatus;
  connStatus: ConnectionStatus;
  sessionIsActive?: boolean | null;
}

// The runtime snapshot from the server is authoritative for whether the ACP
// session still exists. If it says the session is inactive, never render the
// header as connected just because the local transport state is stale.
export function resolveDisplayConnStatus({
  status,
  connStatus,
  sessionIsActive,
}: ResolveDisplayConnStatusParams): ChatDisplayConnectionStatus {
  if (status === "inactive" || sessionIsActive === false) {
    return "inactive";
  }
  return connStatus;
}

export function normalizeInteractionConnStatus(
  displayStatus: ChatDisplayConnectionStatus
): ConnectionStatus {
  return displayStatus === "inactive" ? "idle" : displayStatus;
}
