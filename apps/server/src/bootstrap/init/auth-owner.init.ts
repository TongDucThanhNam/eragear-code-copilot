import {
  type AuthRuntime,
  type AuthRuntimePolicy,
  createAuthRuntime,
} from "@/platform/auth/auth";
import { createLogger } from "@/platform/logging/structured-logger";

const logger = createLogger("Server");

export interface AuthOwner {
  authRuntime: AuthRuntime;
  dispose(): void;
}

export function initializeAuthOwner(policy: AuthRuntimePolicy): AuthOwner {
  const authRuntime = createAuthRuntime(policy);

  return {
    authRuntime,
    dispose() {
      try {
        authRuntime.authDb.close();
      } catch (error) {
        logger.warn("Failed to close auth database during dispose", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
