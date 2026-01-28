import type { SessionAcpPort } from "@/modules/session/application/ports/session-acp.port";
import { createSessionHandlers } from "./handlers";
import { SessionBuffering } from "./update";

export class SessionAcpAdapter implements SessionAcpPort {
  createBuffer() {
    return new SessionBuffering();
  }

  createHandlers(params: Parameters<typeof createSessionHandlers>[0]) {
    return createSessionHandlers(params);
  }
}
