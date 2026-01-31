export type AuthConfig = {
  serverUrl?: string;
  apiKey?: string | null;
};

export function isAuthConfigured(config: AuthConfig): boolean {
  const serverUrl = config.serverUrl?.trim();
  const apiKey = config.apiKey?.trim();
  return Boolean(serverUrl && apiKey);
}
