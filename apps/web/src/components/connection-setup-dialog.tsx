"use client";

import { AlertCircle, Globe, Key, Loader2 } from "lucide-react";
import { useState } from "react";
import { createWSClient, wsLink } from "@trpc/client";
import {
  buildTrpcWsUrl,
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
} from "@/lib/server-url";
import { trpc } from "@/lib/trpc";
import { useServerConfigStore } from "@/store/server-config-store";

const verifyApiKeyViaTrpc = async (serverUrl: string, apiKey: string) => {
  const wsClient = createWSClient({
    url: buildTrpcWsUrl(serverUrl),
    connectionParams: async () => ({ apiKey }),
  });

  const client = trpc.createClient({
    links: [wsLink({ client: wsClient })],
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    window.setTimeout(
      () => reject(new Error("WebSocket connection timed out")),
      5000
    );
  });

  try {
    const me = await Promise.race([client.auth.getMe.query(), timeoutPromise]);
    if (!me?.user) {
      throw new Error("Invalid API key");
    }
    return me;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);
    if (message.includes("unauthorized")) {
      throw new Error("Invalid API key");
    }
    throw error;
  } finally {
    wsClient.close();
  }
};

export function ConnectionSetupDialog() {
  const {
    serverUrl,
    apiKey,
    isConfigured,
    setServerUrl,
    setApiKey,
    setConfigured,
  } = useServerConfigStore();
  const [localUrl, setLocalUrl] = useState(serverUrl || DEFAULT_SERVER_URL);
  const [localApiKey, setLocalApiKey] = useState(apiKey);

  const [status, setStatus] = useState<
    "idle" | "connecting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastVerifyAt, setLastVerifyAt] = useState<number>(0);

  const isReady = Boolean(serverUrl?.trim() && apiKey?.trim());

  const normalizeApiKey = (value?: string | null) => {
    if (!value) {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as { key?: string };
        if (parsed?.key && typeof parsed.key === "string") {
          return parsed.key.trim();
        }
      } catch {
        // Fall through to use trimmed input as-is.
      }
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  const handleConnect = () => {
    if (!localUrl.trim()) {
      return;
    }

    const normalizedApiKey = normalizeApiKey(localApiKey);
    const now = Date.now();
    if (now - lastVerifyAt < 5000) {
      setStatus("error");
      setErrorMessage("Please wait a few seconds before retrying.");
      return;
    }
    setLastVerifyAt(now);

    console.info("[Connect] Attempting connection", {
      serverUrl: localUrl,
      hasApiKey: Boolean(normalizedApiKey),
    });

    setStatus("connecting");
    setErrorMessage(null);
    setConfigured(false);
    setApiKey("");

    // Don't persist config until verification succeeds.

    setTimeout(async () => {
      try {
        const result = await verifyApiKeyViaTrpc(localUrl, normalizedApiKey);
        const normalizedServerUrl = normalizeServerUrl(localUrl);

        console.info("[Connect] API key verified", {
          userId: result.user?.id,
        });
        setServerUrl(normalizedServerUrl);
        setApiKey(normalizedApiKey);
        setConfigured(true);
        console.info("[Connect] Stored server config");
        setStatus("success");
        setTimeout(() => {
          setStatus("idle");
        }, 500);
      } catch (err) {
        console.error("[Connect] API key verification failed", err);
        setStatus("error");
        setConfigured(false);
        // Clear the invalid config
        setApiKey("");
        // Set error message
        const msg =
          err instanceof Error ? err.message : "Authentication failed";
        if (msg.toLowerCase().includes("key")) {
          setErrorMessage("Invalid API key. Please check your credentials.");
          return;
        }

        const normalizedTarget = (() => {
          try {
            return normalizeServerUrl(localUrl);
          } catch {
            return DEFAULT_SERVER_URL;
          }
        })();
        const lowered = msg.toLowerCase();
        const isNetworkError =
          lowered.includes("load failed") ||
          lowered.includes("fetch") ||
          lowered.includes("unable to connect") ||
          lowered.includes("timed out") ||
          lowered.includes("unreachable") ||
          lowered.includes("rejected") ||
          lowered.includes("refused");
        if (isNetworkError) {
          setErrorMessage(
            `Cannot reach server at ${normalizedTarget}. Start apps/server and retry.`
          );
          return;
        }

        setErrorMessage(msg);
      }
    }, 500);
  };

  // Don't render if configuration is verified
  if (isConfigured && isReady) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 text-center">
            <h2 className="font-semibold text-xl">Connect to Server</h2>
            <p className="text-muted-foreground text-sm">
              {status === "error"
                ? "Connection failed. Please try again."
                : "Enter your server details to use the application"}
            </p>
          </div>

          {status === "error" && errorMessage && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="setup-serverUrl"
              >
                <Globe className="h-4 w-4" /> Server URL
              </label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={status === "connecting"}
                id="setup-serverUrl"
                onChange={(e) => {
                  setLocalUrl(e.target.value);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage(null);
                  }
                }}
                placeholder={DEFAULT_SERVER_URL}
                value={localUrl}
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="setup-apiKey"
              >
                <Key className="h-4 w-4" /> API Key
              </label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={status === "connecting"}
                id="setup-apiKey"
                onChange={(e) => {
                  setLocalApiKey(e.target.value);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage(null);
                  }
                }}
                placeholder="eg_xxxxxxxxxxxxx"
                type="password"
                value={localApiKey}
              />
            </div>
          </div>

          <button
            className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            disabled={status === "connecting" || !localUrl.trim()}
            onClick={handleConnect}
            type="button"
          >
            {status === "connecting" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              "Connect"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
