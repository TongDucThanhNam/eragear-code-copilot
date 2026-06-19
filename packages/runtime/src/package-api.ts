// biome-ignore lint/performance/noBarrelFile: Package entry point intentionally re-exports the public runtime API.
export {
  createRuntimeCoreFromSettings,
  type RuntimeCore,
} from "./runtime/core";
export type { AppRouter } from "./transport/trpc/router";
