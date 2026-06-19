export interface ServerRuntimePolicy {
  wsHost: string;
  wsPort: number;
  wsMaxPayloadBytes: number;
  wsAuthTimeoutMs: number;
  wsSessionRevalidateIntervalMs: number;
  httpMaxBodyBytes: number;
  corsStrictOrigin: boolean;
  authAllowSignup: boolean;
  authRequireCloudflareAccess: boolean;
  authCloudflareAccessClientId?: string;
  authCloudflareAccessClientSecret?: string;
  authCloudflareAccessJwtPublicKeyPem?: string;
  authCloudflareAccessJwtAudience?: string;
  authCloudflareAccessJwtIssuer?: string;
  isDev: boolean;
  defaultAdminUsername: string;
  runtimeNodeRole: "writer" | "reader";
  runtimeWriterUrl?: string;
  runtimeInternalToken?: string;
}
