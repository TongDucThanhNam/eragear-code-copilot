// tRPC context using DI container
import { getContainer } from "../../bootstrap/container";

export function createTrpcContext() {
  return {
    container: getContainer(),
  };
}

export type TRPCContext = ReturnType<typeof createTrpcContext>;
