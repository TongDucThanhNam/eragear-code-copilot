import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWSClient, type TRPCClient, wsLink } from "@trpc/client";
import { useToast } from "heroui-native";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { isAuthConfigured } from "@/lib/auth-config";
import { getHttpUrl, getWsUrl } from "@/lib/env";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";
import { useConnectionStore } from "@/store/connection-store";
import type { AppRouter } from "../../server/src/transport/trpc/router";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
const MAX_WS_FAILURES = 3;
const HEALTH_CHECK_TIMEOUT = 5000;

/**
 * Check server health before attempting WebSocket connection
 */
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

export function TRPCProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const connStatusRef = useRef<ConnectionStatus>("idle");
  const wsClientRef = useRef<ReturnType<typeof createWSClient> | null>(null);
  const failureCountRef = useRef(0);
  const forcedReauthRef = useRef(false);
  const healthCheckDoneRef = useRef(false);
  const isConfigured = useAuthConfigured();
  const {
    setError: setConnectionError,
    clearError: clearConnectionError,
    setStatus: setConnectionStatus,
  } = useConnectionStore();

  // Health check function - checks server before allowing WS connection
  const performHealthCheck = useCallback(async () => {
    const authState = useAuthStore.getState();
    if (!isAuthConfigured(authState)) {
      return false;
    }

    setConnectionStatus("checking");
    const httpUrl = getHttpUrl();
    const isHealthy = await checkServerHealth(httpUrl);

    if (!isHealthy) {
      console.warn(
        "[TRPCProvider] Server health check failed - server may be offline"
      );
      setConnectionError(
        "Server is unreachable. Please ensure the server is running."
      );
      // Clear auth to trigger redirect to login
      authState.setApiKey(null);
      return false;
    }

    clearConnectionError();
    return true;
  }, [setConnectionError, clearConnectionError, setConnectionStatus]);

  const [trpcClient] = useState<TRPCClient<AppRouter>>(() => {
    const newWsClient = createWSClient({
      url: () => getWsUrl(),
      connectionParams: () => {
        const { apiKey } = useAuthStore.getState();
        return apiKey ? { apiKey } : null;
      },
      lazy: { enabled: true, closeMs: 0 },
      onOpen: () => {
        console.log("[TRPCProvider] WebSocket connected");
        failureCountRef.current = 0;
        forcedReauthRef.current = false;
        connStatusRef.current = "connected";
        setConnectionStatus("connected");
        clearConnectionError();
      },
      onClose: (cause) => {
        console.log("[TRPCProvider] WebSocket closed", cause);
        connStatusRef.current = "idle";
      },
      onError: (event) => {
        // Use warn instead of error - this is an expected scenario when server is offline
        console.warn("[TRPCProvider] WebSocket connection failed", event);
        connStatusRef.current = "error";
        const authState = useAuthStore.getState();
        if (!isAuthConfigured(authState)) {
          // Not configured, no need to handle - user will be on login page
          return;
        }
        failureCountRef.current += 1;
        if (
          forcedReauthRef.current ||
          failureCountRef.current < MAX_WS_FAILURES
        ) {
          return;
        }
        forcedReauthRef.current = true;
        // Set connection error for display on login page
        setConnectionError(
          "Unable to connect to server. Please check if the server is running."
        );
        authState.setApiKey(null);
        // Toast is optional here since we'll show error on login page
        toast.show({
          variant: "warning",
          label: "Server unreachable",
          description: "Redirecting to connection settings...",
          placement: "top",
        });
      },
    });

    wsClientRef.current = newWsClient;

    return trpc.createClient({
      links: [
        wsLink({
          client: newWsClient,
        }),
      ],
    });
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            retry: 2,
          },
          mutations: {
            retry: 1,
          },
        },
      })
  );

  // Run health check on mount if auth is configured
  useEffect(() => {
    const authState = useAuthStore.getState();
    if (isAuthConfigured(authState) && !healthCheckDoneRef.current) {
      healthCheckDoneRef.current = true;
      performHealthCheck();
    }
  }, [performHealthCheck]);

  useEffect(() => {
    return () => {
      console.log("[TRPCProvider] Closing WebSocket connection");
      wsClientRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      failureCountRef.current = 0;
      forcedReauthRef.current = false;
      healthCheckDoneRef.current = false;
      wsClientRef.current?.close();
      connStatusRef.current = "idle";
    }
  }, [isConfigured]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
