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
import {
  type EragearDesktopBootstrap,
  getDesktopBootstrap,
  hasDesktopTransportCredential,
  isDesktopLocalBootstrap,
} from "./lib/desktop-bootstrap";
import { electronTrpcLink } from "./lib/electron-trpc-link";
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
  void bootstrapRenderer().then(() => {
    root.render(<App />);
  });
}

async function bootstrapRenderer() {
  const desktopBootstrap = await getDesktopBootstrap();
  if (!desktopBootstrap) {
    return;
  }

  const store = useServerConfigStore.getState();
  store.setDesktopBootstrap(desktopBootstrap);
  store.setServerUrl(desktopBootstrap.serverUrl ?? DEFAULT_SERVER_URL);
  if (hasDesktopTransportCredential(desktopBootstrap)) {
    store.setConfigured(true);
  }
  console.info("[desktop] Bootstrap applied", {
    mode: desktopBootstrap.mode,
    transport: desktopBootstrap.transport.kind,
    serverUrl: desktopBootstrap.serverUrl ?? null,
    runtimeReady: desktopBootstrap.runtimeReady,
    diagnostics: desktopBootstrap.diagnostics ?? [],
  });
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
  const { serverUrl, isConfigured, desktopBootstrap } =
    useServerConfigStore();
  const hasConnectionConfig = isConfigured && Boolean(serverUrl.trim());
  const hasDesktopAuth = hasDesktopTransportCredential(desktopBootstrap);

  if (!hasConnectionConfig) {
    return <ConnectionSetupDialog />;
  }

  return (
    <BetterAuthClientProvider serverUrl={serverUrl}>
      {hasDesktopAuth ? (
        <ConfiguredApp
          desktopBootstrap={desktopBootstrap}
          serverUrl={serverUrl}
        />
      ) : (
        <AuthenticatedApp serverUrl={serverUrl} />
      )}
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

function buildDesktopConnectionParams(
  desktopBootstrap: EragearDesktopBootstrap | null | undefined
) {
  if (desktopBootstrap?.mode === "main-thread") {
    const token = desktopBootstrap.localAuthToken;
    return token ? () => ({ eragearLocalToken: token }) : undefined;
  }
  if (desktopBootstrap?.mode === "client-only") {
    const apiKey = desktopBootstrap.apiKey;
    return apiKey ? () => ({ apiKey }) : undefined;
  }
  return undefined;
}

function ConfiguredApp({
  serverUrl,
  desktopBootstrap,
}: {
  serverUrl: string;
  desktopBootstrap?: EragearDesktopBootstrap | null;
}) {
  const setConfigured = useServerConfigStore((state) => state.setConfigured);
  const isDesktopLocalMode = isDesktopLocalBootstrap(desktopBootstrap);
  const usesElectronIpc =
    isDesktopLocalMode && desktopBootstrap?.transport.kind === "electron-ipc";
  const queryClient = useMemo(() => {
    const handleAuthFailure = (error: unknown) => {
      if (isDesktopLocalMode) {
        return;
      }
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
  }, [isDesktopLocalMode, setConfigured]);
  const wsUrl = useMemo(
    () =>
      usesElectronIpc ? null : buildTrpcWsUrl(serverUrl || DEFAULT_SERVER_URL),
    [serverUrl, usesElectronIpc]
  );
  const connectionParams = useMemo(
    () =>
      usesElectronIpc
        ? undefined
        : buildDesktopConnectionParams(desktopBootstrap),
    [desktopBootstrap, usesElectronIpc]
  );

  const wsClient = useMemo(() => {
    if (!wsUrl) {
      return null;
    }
    return createWSClient({
      url: wsUrl,
      connectionParams,
    });
  }, [connectionParams, wsUrl]);

  useEffect(() => {
    return () => {
      wsClient?.close();
    };
  }, [wsClient]);

  const trpcClient = useMemo(() => {
    if (usesElectronIpc && desktopBootstrap) {
      return trpc.createClient({
        links: [electronTrpcLink(desktopBootstrap)],
      });
    }
    if (!wsClient) {
      throw new Error("No runtime transport is configured.");
    }
    return trpc.createClient({
      links: [
        wsLink({
          client: wsClient,
        }),
      ],
    });
  }, [desktopBootstrap, usesElectronIpc, wsClient]);

  return (
    <trpc.Provider
      client={trpcClient}
      key={
        usesElectronIpc
          ? (desktopBootstrap?.transport.channelName ?? "electron-ipc")
          : (wsUrl ?? "runtime")
      }
      queryClient={queryClient}
    >
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
