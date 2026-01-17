export function createContext() {
  return {};
}

export type TRPCContext = ReturnType<typeof createContext>;
