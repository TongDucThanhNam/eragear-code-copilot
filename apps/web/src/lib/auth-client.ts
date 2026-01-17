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
        expiresAt: new Date(Date.now() + 86_400_000),
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
    return await { data: true, error: null };
  },
};
