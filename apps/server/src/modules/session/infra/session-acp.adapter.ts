import { createSessionHandlers } from "@/platform/acp/handlers";
import { SessionBuffering } from "@/platform/acp/update";
import type { SessionAcpPort } from "../application/ports/session-acp.port";

export class SessionAcpAdapter implements SessionAcpPort {
  createBuffer() {
    return new SessionBuffering();
  }

  createHandlers(params: Parameters<typeof createSessionHandlers>[0]) {
    return createSessionHandlers(params);
  }
}
