// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import {
  AlertCircle,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type BetterAuthClient,
  createBetterAuthClientForServer,
} from "@/lib/auth-client";
import { DEFAULT_SERVER_URL, normalizeServerUrl } from "@/lib/server-url";
import { useServerConfigStore } from "@/store/server-config-store";

function normalizeErrorMessage(error: unknown, normalizedTarget: string) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const isNetworkError =
    lowered.includes("load failed") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("network") ||
    lowered.includes("timed out") ||
    lowered.includes("unable to connect") ||
    lowered.includes("unreachable") ||
    lowered.includes("refused");

  if (isNetworkError) {
    return `Cannot reach runtime host at ${normalizedTarget}. Start desktop Remote Connect or the configured runtime host and retry.`;
  }

  return message || "Authentication failed";
}

interface ConnectionSetupDialogProps {
  authClient?: BetterAuthClient;
}

type UsernameSignInClient = BetterAuthClient & {
  signIn: BetterAuthClient["signIn"] & {
    username: (
      credentials: { username: string; password: string },
      options?: {
        onError?: (context: { error: { message?: string } }) => void;
      }
    ) => Promise<{ error?: { message?: string } | null }>;
  };
};

interface PublicOAuthProvider {
  id: string;
  name: string;
  configured: boolean;
}

interface OAuthProvidersResponse {
  providers?: PublicOAuthProvider[];
}

interface OAuthRedirectResponse {
  data?: { url?: string; redirect?: boolean } | null;
  error?: { message?: string } | null;
}

type OAuthSignInClient = BetterAuthClient & {
  signIn: BetterAuthClient["signIn"] & {
    social: (
      input: {
        provider: string;
        callbackURL?: string;
        disableRedirect?: boolean;
      },
      options?: {
        onError?: (context: { error: { message?: string } }) => void;
      }
    ) => Promise<OAuthRedirectResponse>;
  };
};

export function ConnectionSetupDialog({
  authClient,
}: ConnectionSetupDialogProps = {}) {
  const { serverUrl, isConfigured, setServerUrl, setConfigured } =
    useServerConfigStore();
  const [localUrl, setLocalUrl] = useState(serverUrl || DEFAULT_SERVER_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    "idle" | "connecting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [oauthProviders, setOauthProviders] = useState<PublicOAuthProvider[]>(
    []
  );
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    if (!serverUrl) {
      return;
    }
    setLocalUrl(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadOAuthProviders() {
      let normalizedServerUrl: string;
      try {
        normalizedServerUrl = normalizeServerUrl(localUrl);
      } catch {
        setOauthProviders([]);
        return;
      }

      setOauthLoading(true);
      try {
        const response = await fetch(
          `${normalizedServerUrl}/api/auth/oauth/providers`,
          { credentials: "include" }
        );
        if (!response.ok) {
          throw new Error("OAuth provider metadata unavailable");
        }
        const payload = (await response.json()) as OAuthProvidersResponse;
        if (!cancelled) {
          setOauthProviders(
            (payload.providers ?? []).filter((provider) => provider.configured)
          );
        }
      } catch {
        if (!cancelled) {
          setOauthProviders([]);
        }
      } finally {
        if (!cancelled) {
          setOauthLoading(false);
        }
      }
    }

    void loadOAuthProviders();

    return () => {
      cancelled = true;
    };
  }, [localUrl]);

  const normalizedConfiguredServerUrl = useMemo(() => {
    if (!serverUrl.trim()) {
      return null;
    }

    try {
      return normalizeServerUrl(serverUrl);
    } catch {
      return null;
    }
  }, [serverUrl]);

  const isReady = Boolean(
    localUrl.trim() && username.trim().length > 0 && password.length > 0
  );
  const dialogTitle = isConfigured ? "Sign in to Server" : "Connect to Server";
  const dialogDescription = isConfigured
    ? "Your session is missing or expired. Sign in with your server account."
    : "Enter the server URL and your username/password to start using the application.";

  async function handleSubmit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!localUrl.trim()) {
      setStatus("error");
      setErrorMessage("Server URL is required.");
      return;
    }

    if (!username.trim()) {
      setStatus("error");
      setErrorMessage("Username is required.");
      return;
    }

    if (!password) {
      setStatus("error");
      setErrorMessage("Password is required.");
      return;
    }

    let normalizedServerUrl: string;
    try {
      normalizedServerUrl = normalizeServerUrl(localUrl);
    } catch {
      setStatus("error");
      setErrorMessage("Server URL is invalid.");
      return;
    }

    const signInClient =
      authClient &&
      normalizedConfiguredServerUrl &&
      normalizedConfiguredServerUrl === normalizedServerUrl
        ? authClient
        : createBetterAuthClientForServer(normalizedServerUrl);

    setStatus("connecting");
    setErrorMessage(null);

    try {
      let signInError: string | null = null;

      const result = await (
        signInClient as UsernameSignInClient
      ).signIn.username(
        {
          username: username.trim(),
          password,
        },
        {
          onError(context: { error: { message?: string } }) {
            signInError =
              context.error.message || "Invalid username or password.";
          },
        }
      );

      if (result.error) {
        throw new Error(
          result.error.message || "Invalid username or password."
        );
      }

      if (signInError) {
        throw new Error(signInError);
      }

      setServerUrl(normalizedServerUrl);
      setConfigured(true);
      setPassword("");
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(normalizeErrorMessage(error, normalizedServerUrl));
    }
  }

  async function handleOAuthSignIn(provider: PublicOAuthProvider) {
    let normalizedServerUrl: string;
    try {
      normalizedServerUrl = normalizeServerUrl(localUrl);
    } catch {
      setStatus("error");
      setErrorMessage("Server URL is invalid.");
      return;
    }

    const signInClient =
      authClient &&
      normalizedConfiguredServerUrl &&
      normalizedConfiguredServerUrl === normalizedServerUrl
        ? authClient
        : createBetterAuthClientForServer(normalizedServerUrl);

    setStatus("connecting");
    setErrorMessage(null);

    try {
      let signInError: string | null = null;
      const result = await (signInClient as OAuthSignInClient).signIn.social(
        {
          provider: provider.id,
          callbackURL: window.location.href,
          disableRedirect: true,
        },
        {
          onError(context) {
            signInError =
              context.error.message || `Failed to start ${provider.name} OAuth`;
          },
        }
      );

      if (result.error || signInError) {
        throw new Error(
          result.error?.message ||
            signInError ||
            `Failed to start ${provider.name} OAuth`
        );
      }

      const redirectUrl = result.data?.url;
      if (!redirectUrl) {
        throw new Error(`${provider.name} did not return a redirect URL`);
      }

      setServerUrl(normalizedServerUrl);
      setConfigured(true);
      window.location.assign(redirectUrl);
    } catch (error) {
      setStatus("error");
      setErrorMessage(normalizeErrorMessage(error, normalizedServerUrl));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2 text-center">
            <h2 className="font-semibold text-xl">{dialogTitle}</h2>
            <p className="text-muted-foreground text-sm">{dialogDescription}</p>
          </div>

          {status === "error" && errorMessage ? (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="setup-serverUrl"
              >
                <Globe className="h-4 w-4" /> Server URL
              </label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                disabled={status === "connecting"}
                id="setup-serverUrl"
                onChange={(event) => {
                  setLocalUrl(event.target.value);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage(null);
                  }
                }}
                placeholder={DEFAULT_SERVER_URL}
                type="text"
                value={localUrl}
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="setup-username"
              >
                <UserRound className="h-4 w-4" /> Username
              </label>
              <input
                autoComplete="username"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                disabled={status === "connecting"}
                id="setup-username"
                onChange={(event) => {
                  setUsername(event.target.value);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage(null);
                  }
                }}
                placeholder="admin"
                type="text"
                value={username}
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="setup-password"
              >
                <Lock className="h-4 w-4" /> Password
              </label>
              <input
                autoComplete="current-password"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                disabled={status === "connecting"}
                id="setup-password"
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage(null);
                  }
                }}
                placeholder="Enter your password"
                type="password"
                value={password}
              />
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-muted-foreground text-xs">
            Browser login now uses `better-auth` session cookies. API keys are
            reserved for automation and non-interactive clients.
          </div>

          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            disabled={!isReady || status === "connecting"}
            type="submit"
          >
            {status === "connecting" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Authenticating...
              </>
            ) : (
              "Sign In"
            )}
          </button>

          {oauthProviders.length > 0 ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-muted-foreground text-xs">OAuth</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-2">
                {oauthProviders.map((provider) => (
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={status === "connecting"}
                    key={provider.id}
                    onClick={() => void handleOAuthSignIn(provider)}
                    type="button"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Continue with {provider.name}
                  </button>
                ))}
              </div>
            </div>
          ) : oauthLoading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking OAuth providers...
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
