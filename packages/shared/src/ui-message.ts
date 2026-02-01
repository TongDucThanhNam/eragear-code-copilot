export type ProviderMetadata = Record<string, unknown>;

export type TextUIPart = {
  type: "text";
  text: string;
  state?: "streaming" | "done";
  providerMetadata?: ProviderMetadata;
};

export type ReasoningUIPart = {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
  providerMetadata?: ProviderMetadata;
};

export type SourceUrlUIPart = {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
  providerMetadata?: ProviderMetadata;
};

export type SourceDocumentUIPart = {
  type: "source-document";
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
  providerMetadata?: ProviderMetadata;
};

export type FileUIPart = {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
  providerMetadata?: ProviderMetadata;
};

export type StepStartUIPart = {
  type: "step-start";
};

export type DataUIPart = {
  type: `data-${string}`;
  id?: string;
  data: unknown;
};

type ToolApprovalRequest = {
  id: string;
  approved?: never;
  reason?: never;
};

type ToolApprovalResponse = {
  id: string;
  approved: boolean;
  reason?: string;
};

export type ToolUIPart = {
  type: `tool-${string}`;
  toolCallId: string;
  title?: string;
  providerExecuted?: boolean;
} & (
  | {
      state: "input-streaming";
      input: unknown | undefined;
      output?: never;
      errorText?: never;
      approval?: never;
    }
  | {
      state: "input-available";
      input: unknown;
      output?: never;
      errorText?: never;
      callProviderMetadata?: ProviderMetadata;
      approval?: never;
    }
  | {
      state: "approval-requested";
      input: unknown;
      output?: never;
      errorText?: never;
      callProviderMetadata?: ProviderMetadata;
      approval: ToolApprovalRequest;
    }
  | {
      state: "approval-responded";
      input: unknown;
      output?: never;
      errorText?: never;
      callProviderMetadata?: ProviderMetadata;
      approval: ToolApprovalResponse;
    }
  | {
      state: "output-available";
      input: unknown;
      output: unknown;
      errorText?: never;
      callProviderMetadata?: ProviderMetadata;
      preliminary?: boolean;
      approval?: {
        id: string;
        approved: true;
        reason?: string;
      };
    }
  | {
      state: "output-error";
      input: unknown | undefined;
      output?: never;
      errorText: string;
      callProviderMetadata?: ProviderMetadata;
      approval?: {
        id: string;
        approved: true;
        reason?: string;
      };
    }
  | {
      state: "output-denied";
      input: unknown;
      output?: never;
      errorText?: never;
      callProviderMetadata?: ProviderMetadata;
      approval: {
        id: string;
        approved: false;
        reason?: string;
      };
    }
);

export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | ToolUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | FileUIPart
  | DataUIPart
  | StepStartUIPart;

export type UIMessageRole = "system" | "user" | "assistant";

export interface UIMessage {
  id: string;
  role: UIMessageRole;
  metadata?: unknown;
  parts: UIMessagePart[];
}
