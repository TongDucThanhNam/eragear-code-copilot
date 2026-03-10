"use client";

import { AlertCircle, Globe, Loader2, Lock, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createBetterAuthClientForServer,
  type BetterAuthClient,
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
    return `Cannot reach server at ${normalizedTarget}. Start apps/server and retry.`;
  }

  return message || "Authentication failed";
}

interface ConnectionSetupDialogProps {
  authClient?: BetterAuthClient;
}

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

  useEffect(() => {
    if (!serverUrl) {
      return;
    }
    setLocalUrl(serverUrl);
  }, [serverUrl]);

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

      const result = await signInClient.signIn.username(
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
        throw new Error(result.error.message || "Invalid username or password.");
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
        </form>
      </div>
    </div>
  );
}
