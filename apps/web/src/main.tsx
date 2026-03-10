import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createWSClient, wsLink } from "@trpc/client";
import { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import {
  BetterAuthClientProvider,
  useBetterAuthClient,
} from "./components/auth/auth-client-provider";
import { ConnectionSetupDialog } from "./components/connection-setup-dialog";
import { ThemeProvider } from "./components/theme-provider";
import Loader from "./components/ui/loader";
import { Toaster } from "./components/ui/sonner";
import { buildTrpcWsUrl, DEFAULT_SERVER_URL } from "./lib/server-url";
import { trpc } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";
import { useServerConfigStore } from "./store/server-config-store";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: () => <Loader />,
  context: {},
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}

function isUnauthorizedError(error: unknown) {
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

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
      storageKey="vite-ui-theme"
    >
      <Toaster richColors />
      <AppBootstrap />
    </ThemeProvider>
  );
}

function AppBootstrap() {
  const { serverUrl, isConfigured } = useServerConfigStore();
  const hasConnectionConfig = isConfigured && Boolean(serverUrl.trim());

  if (!hasConnectionConfig) {
    return <ConnectionSetupDialog />;
  }

  return (
    <BetterAuthClientProvider serverUrl={serverUrl}>
      <AuthenticatedApp serverUrl={serverUrl} />
    </BetterAuthClientProvider>
  );
}

function AuthenticatedApp({ serverUrl }: { serverUrl: string }) {
  const authClient = useBetterAuthClient();
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (!session.data?.user) {
    return <ConnectionSetupDialog authClient={authClient} />;
  }

  return <ConfiguredApp serverUrl={serverUrl} />;
}

function ConfiguredApp({ serverUrl }: { serverUrl: string }) {
  const setConfigured = useServerConfigStore((state) => state.setConfigured);
  const queryClient = useMemo(() => {
    const handleAuthFailure = (error: unknown) => {
      if (!isUnauthorizedError(error)) {
        return;
      }
      setConfigured(false);
    };

    return new QueryClient({
      queryCache: new QueryCache({
        onError: handleAuthFailure,
      }),
      mutationCache: new MutationCache({
        onError: handleAuthFailure,
      }),
    });
  }, [setConfigured]);
  const wsUrl = useMemo(
    () => buildTrpcWsUrl(serverUrl || DEFAULT_SERVER_URL),
    [serverUrl]
  );

  const wsClient = useMemo(() => {
    return createWSClient({
      url: wsUrl,
    });
  }, [wsUrl]);

  useEffect(() => {
    return () => {
      wsClient.close();
    };
  }, [wsClient]);

  const trpcClient = useMemo(() => {
    return trpc.createClient({
      links: [
        wsLink({
          client: wsClient,
        }),
      ],
    });
  }, [wsClient]);

  return (
    <trpc.Provider
      client={trpcClient}
      key={wsUrl}
      queryClient={queryClient}
    >
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
