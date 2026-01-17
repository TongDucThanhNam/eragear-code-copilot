import { z } from "zod";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_WS_HOST,
  DEFAULT_WS_PORT,
} from "./constants";

const envSchema = z.object({
  SESSION_IDLE_TIMEOUT_MS: z.string().optional(),
  WS_PORT: z.string().optional(),
  WS_HOST: z.string().optional(),
});

const env = envSchema.parse(process.env);

function toNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const ENV = {
  sessionIdleTimeoutMs: toNumber(
    env.SESSION_IDLE_TIMEOUT_MS,
    DEFAULT_SESSION_IDLE_TIMEOUT_MS
  ),
  wsPort: toNumber(env.WS_PORT, DEFAULT_WS_PORT),
  wsHost: env.WS_HOST ?? DEFAULT_WS_HOST,
};
