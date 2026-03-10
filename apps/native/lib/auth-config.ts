export type AuthConfig = {
  serverUrl?: string;
};

export function isAuthConfigured(config: AuthConfig): boolean {
  const serverUrl = config.serverUrl?.trim();
  return Boolean(serverUrl);
}
