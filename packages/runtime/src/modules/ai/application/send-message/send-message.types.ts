import type { Annotations } from "#runtime/shared/types/annotation.types";
import type { PromptTurnCompleteEvent } from "./prompt-task-runner";

export type PromptSource = "client" | "supervisor" | "automation";

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
  source?: PromptSource;
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
  subagent?: {
    name: string;
    description?: string;
    sourcePath: string;
  };
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

export interface PromptLifecycleMessageSent {
  userId: string;
  chatId: string;
  projectRoot: string;
  projectId?: string;
  agentSessionId?: string;
  turnId: string;
  source: PromptSource;
}

export interface PromptLifecycleSubagentInvocationRequested {
  userId: string;
  chatId: string;
  projectRoot: string;
  projectId?: string;
  agentSessionId?: string;
  turnId: string;
  subagent: {
    name: string;
    description?: string;
    sourcePath: string;
  };
}

export interface PromptLifecycleEvents {
  afterMessageSend(input: PromptLifecycleMessageSent): Promise<void>;
  requestSubagentInvocation(
    input: PromptLifecycleSubagentInvocationRequested
  ): Promise<void>;
  afterTurnComplete(input: PromptTurnCompleteEvent): Promise<void>;
}

export function normalizePromptSource(
  source: PromptSource | undefined
): PromptSource {
  return source === "supervisor" || source === "automation" ? source : "client";
}
