import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createWSClient, type TRPCClient, wsLink } from "@trpc/client";
import { useToast } from "heroui-native";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type BetterAuthClient,
  clearStoredBetterAuthSession,
} from "@/lib/auth-client";
import { getHttpUrl, getWsUrl } from "@/lib/env";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";
import { useConnectionStore } from "@/store/connection-store";
import type { AppRouter } from "../../server/src/transport/trpc/router";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

const MAX_WS_FAILURES = 3;
const HEALTH_CHECK_TIMEOUT = 5000;

function trimCookieHeader(cookie: string): string {
  return cookie.replace(/^;\s*/, "").trim();
}

function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & {
    data?: { code?: string; httpStatus?: number };
    shape?: { data?: { code?: string; httpStatus?: number } };
  };

  return (
    candidate.data?.code === "UNAUTHORIZED" ||
    candidate.data?.httpStatus === 401 ||
    candidate.shape?.data?.code === "UNAUTHORIZED" ||
    candidate.shape?.data?.httpStatus === 401
  );
}

async function checkServerHealth(httpUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      HEALTH_CHECK_TIMEOUT
    );

    const response = await fetch(`${httpUrl}/api/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

interface TRPCProviderProps {
  children: ReactNode;
  authClient: BetterAuthClient;
}

export function TRPCProvider({ children, authClient }: TRPCProviderProps) {
  const { toast } = useToast();
  const failureCountRef = useRef(0);
  const authFailureHandledRef = useRef(false);
  const healthCheckDoneRef = useRef(false);
  const toastRef = useRef(toast);
  const setConnectionError = useConnectionStore((state) => state.setError);
  const clearConnectionError = useConnectionStore((state) => state.clearError);
  const setConnectionStatus = useConnectionStore((state) => state.setStatus);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const forceSessionReset = useCallback(
    async (message: string) => {
      if (authFailureHandledRef.current) {
        return;
      }
      authFailureHandledRef.current = true;
      setConnectionStatus("error");
      setConnectionError(message);

      const { serverUrl, bumpAuthVersion } = useAuthStore.getState();

      try {
        await authClient.signOut();
      } catch {
        // Best effort only. We still wipe local session state below.
      }

      if (serverUrl.trim().length > 0) {
        await clearStoredBetterAuthSession(serverUrl);
      }

      bumpAuthVersion();
    },
    [authClient, setConnectionError, setConnectionStatus]
  );

  const redirectToConnectionSetup = useCallback(
    (message: string) => {
      if (authFailureHandledRef.current) {
        return;
      }
      authFailureHandledRef.current = true;
      setConnectionStatus("error");
      setConnectionError(message);
      const { clearServerUrl, bumpAuthVersion } = useAuthStore.getState();
      clearServerUrl();
      bumpAuthVersion();
    },
    [setConnectionError, setConnectionStatus]
  );

  const performHealthCheck = useCallback(async () => {
    const serverUrl = useAuthStore.getState().serverUrl;
    if (!serverUrl.trim()) {
      return false;
    }

    setConnectionStatus("checking");
    const isHealthy = await checkServerHealth(getHttpUrl());

    if (!isHealthy) {
      console.warn(
        "[TRPCProvider] Server health check failed - server may be offline"
      );
      redirectToConnectionSetup(
        "Server is unreachable. Please verify the server URL and try again."
      );
      return false;
    }

    clearConnectionError();
    return true;
  }, [clearConnectionError, redirectToConnectionSetup, setConnectionStatus]);

  const [queryClient] = useState(() => {
    const handleAuthFailure = (error: unknown) => {
      if (!isUnauthorizedError(error)) {
        return;
      }
      forceSessionReset("Session expired. Please sign in again.");
    };

    return new QueryClient({
      queryCache: new QueryCache({
        onError: handleAuthFailure,
      }),
      mutationCache: new MutationCache({
        onError: handleAuthFailure,
      }),
      defaultOptions: {
        queries: {
          staleTime: 5 * 60 * 1000,
          retry: 2,
        },
        mutations: {
          retry: 1,
        },
      },
    });
  });

  const [wsClient] = useState(() => {
    return createWSClient({
      url: () => getWsUrl(),
      connectionParams: () => {
        const cookie = trimCookieHeader(authClient.getCookie());
        return cookie ? { cookie } : null;
      },
      onOpen: () => {
        console.log("[TRPCProvider] WebSocket connected");
        failureCountRef.current = 0;
        authFailureHandledRef.current = false;
        setConnectionStatus("connected");
        clearConnectionError();
      },
      onClose: (cause) => {
        console.log("[TRPCProvider] WebSocket closed", cause);
        setConnectionStatus("idle");
      },
      onError: (event) => {
        console.warn("[TRPCProvider] WebSocket connection failed", event);
        failureCountRef.current += 1;

        if (failureCountRef.current < MAX_WS_FAILURES) {
          return;
        }

        redirectToConnectionSetup(
          "Unable to connect to server. Please verify the server URL and try again."
        );
        toastRef.current.show({
          variant: "warning",
          label: "Server unreachable",
          description: "Redirecting to connection settings...",
          placement: "top",
        });
      },
    });
  });

  const [trpcClient] = useState<TRPCClient<AppRouter>>(() =>
    trpc.createClient({
      links: [
        wsLink({
          client: wsClient,
        }),
      ],
    })
  );

  useEffect(() => {
    if (healthCheckDoneRef.current) {
      return;
    }
    healthCheckDoneRef.current = true;
    performHealthCheck();
  }, [performHealthCheck]);

  useEffect(() => {
    return () => {
      console.log("[TRPCProvider] Closing WebSocket connection");
      wsClient.close();
    };
  }, [wsClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </trpc.Provider>
    </QueryClientProvider>
  );
}
