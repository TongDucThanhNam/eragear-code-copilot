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
  const container = getContainer();
  const auth = container.getAuth();
  const apiKey =
    typeof opts?.connectionParams?.apiKey === "string"
      ? (opts.connectionParams.apiKey as string)
      : undefined;
  let authContext: AuthContext | null = null;
  if (apiKey) {
    const session = await auth.api.getSession({
      headers: new Headers({ "x-api-key": apiKey }),
    });
    if (session) {
      authContext = {
        type: "apiKey",
        userId: session.user.id,
        user: session.user,
        session: session.session,
      };
    } else {
      const result = await auth.api.verifyApiKey({
        body: { key: apiKey },
      });
      if (result?.valid && result.key?.userId) {
        authContext = {
          type: "apiKey",
          userId: result.key.userId,
        };
      }
    }
  } else if (opts?.req) {
    authContext = await container.getAuthContext(opts.req);
  }
  return {
    container,
    auth: authContext,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
