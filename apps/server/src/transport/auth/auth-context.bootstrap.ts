export interface AuthBootstrapRequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
}

interface UserScopedAuthContext {
  userId: string;
}

export interface AuthContextBootstrapDependencies<TAuthContext> {
  resolveAuthContext: (
    req: AuthBootstrapRequestLike
  ) => Promise<TAuthContext | null>;
  ensureUserDefaults: (userId: string) => Promise<void>;
}

export async function resolveAuthContextWithBootstrap<
  TAuthContext extends UserScopedAuthContext,
>(
  deps: AuthContextBootstrapDependencies<TAuthContext>,
  req: AuthBootstrapRequestLike
): Promise<TAuthContext | null> {
  const authContext = await deps.resolveAuthContext(req);
  if (!authContext) {
    return null;
  }
  await deps.ensureUserDefaults(authContext.userId);
  return authContext;
}
