import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWSClient, wsLink } from "@trpc/client";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { getWsUrl } from "@/lib/env";
import { trpc } from "@/lib/trpc";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export function TRPCProvider({ children }: { children: ReactNode }) {
	const [, setConnStatus] = useState<ConnectionStatus>("idle");

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
			}),
	);

	const [wsClient] = useState(() => {
		const wsUrl = getWsUrl();
		console.log("[TRPCProvider] Connecting to:", wsUrl);

		return createWSClient({
			url: wsUrl,
			onOpen: () => {
				console.log("[TRPCProvider] WebSocket connected");
				setConnStatus("connected");
			},
			onClose: (cause) => {
				console.log("[TRPCProvider] WebSocket closed", cause);
				setConnStatus("idle");
			},
			onError: (event) => {
				console.error("[TRPCProvider] WebSocket error", event);
				setConnStatus("error");
			},
		});
	});

	const [trpcClient] = useState(() =>
		trpc.createClient({
			links: [
				wsLink({
					client: wsClient,
				}),
			],
		}),
	);

	// Initialize and clean up WebSocket client
	useEffect(() => {
		return () => {
			wsClient.close();
		};
	}, [wsClient]);

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</trpc.Provider>
	);
}
