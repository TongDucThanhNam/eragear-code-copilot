/**
 * tRPC Context
 *
 * Creates the tRPC context by extracting the DI container.
 * This context is passed to all tRPC procedures and routers.
 *
 * @module transport/trpc/context
 */

import { getContainer } from "../../bootstrap/container";

interface RequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
}

export interface AuthContext {
  type: "session" | "apiKey";
  userId: string;
  user?: unknown;
  session?: unknown;
}

/**
 * Creates a tRPC context containing the DI container
 *
 * @param opts - Optional request and connection parameters
 * @returns Context object with container for dependency access
 *
 * @example
 * ```typescript
 * const context = createTrpcContext();
 * const projects = context.container.getProjects().findAll();
 * ```
 */
export async function createTrpcContext(opts?: { req?: RequestLike }) {
  const container = getContainer();
  const authContext = opts?.req
    ? await container.getAuthContext(opts.req)
    : null;

  return {
    container,
    auth: authContext,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
