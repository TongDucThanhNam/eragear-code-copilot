// MOCKED AUTH CLIENT
import { env } from "@eragear-code-copilot/env/web";

export const authClient = {
	useSession: () => ({
		data: {
			user: {
				id: "mock-user-id",
				name: "Mock User",
				email: "mock@example.com",
				image: null,
			},
			session: {
				id: "mock-session-id",
				userId: "mock-user-id",
				expiresAt: new Date(Date.now() + 86400000),
				ipAddress: "127.0.0.1",
				userAgent: "MockAgent",
			},
		},
		isPending: false,
		error: null,
	}),
	signIn: async () => ({ data: true, error: null }),
	signOut: async (options?: any) => {
		if (options?.fetchOptions?.onSuccess) {
			options.fetchOptions.onSuccess();
		}
		return { data: true, error: null };
	},
};
