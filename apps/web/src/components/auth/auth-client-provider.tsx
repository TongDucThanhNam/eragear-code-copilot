import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createBetterAuthClientForServer,
  type BetterAuthClient,
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
