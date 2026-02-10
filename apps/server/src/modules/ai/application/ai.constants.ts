import {
  DEFAULT_ACP_REQUEST_MAX_ATTEMPTS,
  DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS,
} from "@/config/constants";

export const AI_OP = {
  PROMPT_SEND: "ai.prompt.send",
  PROMPT_CANCEL: "ai.prompt.cancel",
  SESSION_MODE_SET: "ai.session.mode.set",
  SESSION_MODEL_SET: "ai.session.model.set",
} as const;

export const HTTP_STATUS = {
  CONFLICT: 409,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const DEFAULT_AI_ACP_RETRY_POLICY = {
  maxAttempts: DEFAULT_ACP_REQUEST_MAX_ATTEMPTS,
  retryBaseDelayMs: DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS,
} as const;
