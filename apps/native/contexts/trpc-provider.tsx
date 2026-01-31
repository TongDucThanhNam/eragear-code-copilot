import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWSClient, type TRPCClient, wsLink } from "@trpc/client";
import { useToast } from "heroui-native";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useAuthConfigured } from "@/hooks/use-auth-config";
import { isAuthConfigured } from "@/lib/auth-config";
import { getWsUrl } from "@/lib/env";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/store/auth-store";
import type { AppRouter } from "../../server/src/transport/trpc/router";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
const MAX_WS_FAILURES = 3;

export function TRPCProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const connStatusRef = useRef<ConnectionStatus>("idle");
  const wsClientRef = useRef<ReturnType<typeof createWSClient> | null>(null);
  const failureCountRef = useRef(0);
  const forcedReauthRef = useRef(false);
  const isConfigured = useAuthConfigured();
  const [trpcClient] = useState<TRPCClient<AppRouter>>(() => {
    const newWsClient = createWSClient({
      url: () => getWsUrl(),
      connectionParams: () => {
        const { apiKey } = useAuthStore.getState();
        return apiKey ? { apiKey } : undefined;
      },
      lazy: { enabled: true, closeMs: 0 },
      onOpen: () => {
        console.log("[TRPCProvider] WebSocket connected");
        failureCountRef.current = 0;
        forcedReauthRef.current = false;
        connStatusRef.current = "connected";
      },
      onClose: (cause) => {
        console.log("[TRPCProvider] WebSocket closed", cause);
        connStatusRef.current = "idle";
      },
      onError: (event) => {
        console.error("[TRPCProvider] WebSocket error", event);
        connStatusRef.current = "error";
        const authState = useAuthStore.getState();
        if (!isAuthConfigured(authState)) {
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
        authState.setApiKey(null);
        toast.show({
          variant: "danger",
          label: "Connection error",
          description:
            "Unable to reach the server. Please check the server URL and API key.",
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
