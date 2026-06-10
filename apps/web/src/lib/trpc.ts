import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/src/transport/trpc/router";

export type { AppRouter };
export const trpc = createTRPCReact<AppRouter>();
