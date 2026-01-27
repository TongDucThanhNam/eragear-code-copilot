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
import { auth } from "../../infra/auth/auth";

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
export async function createTrpcContext(opts?: {
  req?: RequestLike;
  connectionParams?: Record<string, unknown> | null;
}) {
  const apiKey =
    typeof opts?.connectionParams?.apiKey === "string"
      ? (opts.connectionParams.apiKey as string)
      : undefined;
  const authContext = apiKey
    ? await (async () => {
        const session = await auth.api.getSession({
          headers: new Headers({ "x-api-key": apiKey }),
        });
        if (session) {
          return {
            type: "apiKey",
            userId: session.user.id,
            user: session.user,
            session: session.session,
          };
        }

        const result = await auth.api.verifyApiKey({
          body: { key: apiKey },
        });
        if (!result?.valid || !result.key?.userId) {
          return null;
        }
        return {
          type: "apiKey",
          userId: result.key.userId,
        };
      })()
    : opts?.req
      ? await getAuthContext(opts.req)
      : null;
  return {
    container: getContainer(),
    auth: authContext,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
