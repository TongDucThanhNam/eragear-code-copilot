import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createWSClient, wsLink } from "@trpc/client";
import { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { trpc } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";
import { useServerConfigStore } from "./store/server-config-store";

const DEFAULT_SERVER_URL = "ws://localhost:3000";
const WS_PROTOCOL_REGEX = /^http/;

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

function App() {
  const queryClient = useMemo(() => new QueryClient(), []);
  const { serverUrl, apiKey } = useServerConfigStore();

  const wsUrl = useMemo(() => {
    const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(
      WS_PROTOCOL_REGEX,
      "ws"
    );
    return baseUrl;
  }, [serverUrl, apiKey]);

  const wsClient = useMemo(() => {
    return createWSClient({
      url: wsUrl,
      connectionParams: async () => {
        const key = apiKey?.trim();
        if (!key) {
          return {};
        }
        return { apiKey: key };
      },
    });
  }, [wsUrl, apiKey]);

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
      queryClient={queryClient}
      key={`${wsUrl}|${apiKey?.trim() ?? ""}`}
    >
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
