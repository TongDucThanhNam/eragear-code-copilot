import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  type BetterAuthClient,
  createBetterAuthClientForServer,
} from "@/lib/auth-client";

const BetterAuthClientContext = createContext<BetterAuthClient | null>(null);

export function BetterAuthClientProvider({
  children,
  serverUrl,
}: {
  children: ReactNode;
  serverUrl: string;
}) {
  const authClient = useMemo(
    () => createBetterAuthClientForServer(serverUrl),
    [serverUrl]
  );

  return (
    <BetterAuthClientContext.Provider value={authClient}>
      {children}
    </BetterAuthClientContext.Provider>
  );
}

export function useBetterAuthClient() {
  const authClient = useContext(BetterAuthClientContext);

  if (!authClient) {
    throw new Error(
      "useBetterAuthClient must be used within BetterAuthClientProvider"
    );
  }

  return authClient;
}
