"use client";

import { AlertCircle, Globe, Key, Loader2 } from "lucide-react";
import { useState } from "react";
import { createBetterAuthClient } from "@/lib/auth-client";
import { useServerConfigStore } from "@/store/server-config-store";

const WS_PROTOCOL_REGEX = /^ws/;

export function ConnectionSetupDialog() {
  const {
    serverUrl,
    apiKey,
    isConfigured,
    setServerUrl,
    setApiKey,
    setConfigured,
  } = useServerConfigStore();
  const [localUrl, setLocalUrl] = useState(serverUrl || "ws://localhost:3000");
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

    // Don't persist config until verification succeeds.

    setTimeout(async () => {
      try {
        const baseUrl = localUrl.replace(WS_PROTOCOL_REGEX, "http");
        const healthController = new AbortController();
        const healthTimer = window.setTimeout(
          () => healthController.abort(),
          5000
        );
        try {
          const healthRes = await fetch(`${baseUrl}/api/health`, {
            signal: healthController.signal,
          });
          if (!healthRes.ok) {
            throw new Error("Server health check failed");
          }
        } finally {
          window.clearTimeout(healthTimer);
        }
        const authClient = createBetterAuthClient(baseUrl);
        const verifyResponse = await authClient.apiKey.verify({
          key: normalizedApiKey,
        });
        const result =
          verifyResponse && "data" in verifyResponse
            ? (
                verifyResponse as {
                  data?: { valid?: boolean; error?: { message?: string } };
                }
              ).data
            : (verifyResponse as {
                valid?: boolean;
                error?: { message?: string };
              });
        const error =
          verifyResponse && "error" in verifyResponse
            ? (verifyResponse as { error?: { message?: string } }).error
            : undefined;
        if (!result?.valid) {
          throw new Error(
            result?.error?.message || error?.message || "Invalid API key"
          );
        }

        console.info("[Connect] API key verified", {
          userId: result.key?.userId,
        });
        setServerUrl(localUrl);
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
        setErrorMessage(
          msg.includes("UNAUTHORIZED") || msg.toLowerCase().includes("auth")
            ? "Invalid API key. Please check your credentials."
            : "Connection failed. Please check the server URL."
        );
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
                placeholder="ws://localhost:3000"
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
