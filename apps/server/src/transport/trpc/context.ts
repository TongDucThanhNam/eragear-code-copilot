/**
 * tRPC Context
 *
 * Creates the tRPC context by extracting the DI container.
 * This context is passed to all tRPC procedures and routers.
 *
 * @module transport/trpc/context
 */

import { getContainer } from "../../bootstrap/container";

/**
 * Creates a tRPC context containing the DI container
 *
 * @returns Context object with container for dependency access
 *
 * @example
 * ```typescript
 * const context = createTrpcContext();
 * const projects = context.container.getProjects().findAll();
 * ```
 */
export function createTrpcContext() {
  return {
    container: getContainer(),
  };
}

/** Type representing the tRPC context */
export type TRPCContext = ReturnType<typeof createTrpcContext>;
