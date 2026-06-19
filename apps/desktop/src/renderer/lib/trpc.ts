// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
import type { AppRouter } from "@eragear-code-copilot/api-contract";
import { createTRPCReact } from "@trpc/react-query";

export type { AppRouter };
export const trpc = createTRPCReact<AppRouter>();
