/**
 * tRPC Context
 *
 * Creates the tRPC context by extracting the DI container.
 * This context is passed to all tRPC procedures and routers.
 *
 * @module transport/trpc/context
 */

import { getContainer } from "../../bootstrap/container";
import { getAuthContext } from "../../infra/auth/guards";

type RequestLike = {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
};

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
export async function createTrpcContext(opts?: { req?: RequestLike }) {
  const auth = opts?.req ? await getAuthContext(opts.req) : null;
  return {
    container: getContainer(),
    auth,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
