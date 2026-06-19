import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@eragear-code-copilot/api-contract";

export const trpc = createTRPCReact<AppRouter>();
