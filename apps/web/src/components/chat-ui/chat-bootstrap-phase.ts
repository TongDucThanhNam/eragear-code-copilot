import type { ConnectionStatus } from "@repo/shared";
import type { SessionBootstrapPhase } from "@/store/chat-status-store";

export function resolveSessionBootstrapPhase(params: {
  phase: SessionBootstrapPhase;
  connStatus: ConnectionStatus;
  hasMessages: boolean;
}): SessionBootstrapPhase {
  const { phase, connStatus, hasMessages } = params;

  if (phase === "creating_session") {
    return phase;
  }

  if (hasMessages) {
    return "idle";
  }

  if (connStatus === "connecting") {
    if (phase === "initializing_agent" || phase === "restoring_history") {
      return phase;
    }
    return "restoring_history";
  }

  if (connStatus === "connected") {
    return "idle";
  }

  if ((connStatus === "idle" || connStatus === "error") && phase !== "idle") {
    return "idle";
  }

  return phase;
}
