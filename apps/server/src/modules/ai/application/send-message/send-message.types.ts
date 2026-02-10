import type { Annotations } from "@/shared/types/annotation.types";

export interface SendMessagePolicy {
  messageContentMaxBytes: number;
  messagePartsMaxBytes: number;
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

export interface NormalizedSendMessagePolicy {
  messageContentMaxBytes: number;
  messagePartsMaxBytes: number;
  acpRetryMaxAttempts: number;
  acpRetryBaseDelayMs: number;
}

export function normalizeSendMessagePolicy(
  policy: SendMessagePolicy
): NormalizedSendMessagePolicy {
  return {
    messageContentMaxBytes: Math.max(
      1,
      Math.trunc(policy.messageContentMaxBytes)
    ),
    messagePartsMaxBytes: Math.max(1, Math.trunc(policy.messagePartsMaxBytes)),
    acpRetryMaxAttempts: Math.max(1, Math.trunc(policy.acpRetryMaxAttempts)),
    acpRetryBaseDelayMs: Math.max(1, Math.trunc(policy.acpRetryBaseDelayMs)),
  };
}

export interface SendMessageExecuteInput {
  userId: string;
  chatId: string;
  text: string;
  textAnnotations?: Annotations;
  images?: {
    base64: string;
    mimeType: string;
    uri?: string;
    annotations?: Annotations;
  }[];
  audio?: {
    base64: string;
    mimeType: string;
    annotations?: Annotations;
  }[];
  resources?: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
    annotations?: Annotations;
  }[];
  resourceLinks?: {
    uri: string;
    name: string;
    mimeType?: string;
    title?: string;
    description?: string;
    size?: number;
    annotations?: Annotations;
  }[];
}

export interface SendMessageResult {
  status: "submitted";
  stopReason: string;
  finishReason: string;
  assistantMessageId?: string;
  userMessageId: string;
  submittedAt: number;
  turnId: string;
}
