import { createSessionHandlers } from "@/platform/acp/handlers";
import { SessionBuffering } from "@/platform/acp/update";
import type { SessionAcpPort } from "../application/ports/session-acp.port";

export class SessionAcpAdapter implements SessionAcpPort {
  private permissionAutoResolver:
    | ((input: { chatId: string; requestId: string }) => Promise<void>)
    | undefined;

  createBuffer() {
    return new SessionBuffering();
  }

  setPermissionAutoResolver(
    resolver:
      | ((input: { chatId: string; requestId: string }) => Promise<void>)
      | undefined
  ): void {
    this.permissionAutoResolver = resolver;
  }

  createHandlers(params: Parameters<typeof createSessionHandlers>[0]) {
    return createSessionHandlers({
      ...params,
      permissionAutoResolver: (input) =>
        this.permissionAutoResolver?.(input) ?? Promise.resolve(),
    });
  }
}
