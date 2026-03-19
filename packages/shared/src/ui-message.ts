export type ProviderMetadata = Record<string, unknown>;

export interface TextUIPart {
  type: "text";
  text: string;
  state?: "streaming" | "done";
  providerMetadata?: ProviderMetadata;
}

export interface ReasoningUIPart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
  providerMetadata?: ProviderMetadata;
}

export interface SourceUrlUIPart {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
  providerMetadata?: ProviderMetadata;
}

export interface SourceDocumentUIPart {
  type: "source-document";
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
  providerMetadata?: ProviderMetadata;
}

export interface FileUIPart {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
  providerMetadata?: ProviderMetadata;
}

export interface StepStartUIPart {
  type: "step-start";
}

export interface DataUIPart {
  type: `data-${string}`;
  id?: string;
  data: unknown;
}

interface ToolApprovalRequest {
  id: string;
  approved?: never;
  reason?: never;
}

interface ToolApprovalResponse {
  id: string;
  approved: boolean;
  reason?: string;
}

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
  | {
      state: "output-cancelled";
      input: unknown | undefined;
      output?: never;
      errorText?: never;
      callProviderMetadata?: ProviderMetadata;
      approval?: ToolApprovalResponse;
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
  createdAt?: number;
  metadata?: unknown;
  parts: UIMessagePart[];
}

interface ToolPartFinalizationOptions {
  includeApprovalRequested?: boolean;
}

function getToolPartBase(part: ToolUIPart) {
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    ...(part.title ? { title: part.title } : {}),
    ...(part.providerExecuted !== undefined
      ? { providerExecuted: part.providerExecuted }
      : {}),
    ...("callProviderMetadata" in part && part.callProviderMetadata
      ? { callProviderMetadata: part.callProviderMetadata }
      : {}),
  };
}

export function isToolPartFinal(part: ToolUIPart): boolean {
  return (
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "output-denied" ||
    part.state === "output-cancelled"
  );
}

export function finalizeToolPartAsPreliminaryOutput(
  part: ToolUIPart,
  options: ToolPartFinalizationOptions = {}
): ToolUIPart {
  if (isToolPartFinal(part)) {
    return part;
  }

  if (
    part.state === "approval-requested" &&
    !options.includeApprovalRequested
  ) {
    return part;
  }

  return {
    ...getToolPartBase(part),
    state: "output-available",
    input: part.input ?? null,
    output: null,
    preliminary: true,
    ...(part.state === "approval-responded" && part.approval.approved === true
      ? {
          approval: {
            id: part.approval.id,
            approved: true,
            ...(part.approval.reason ? { reason: part.approval.reason } : {}),
          },
        }
      : {}),
  };
}

export function finalizeToolPartAsCancelled(part: ToolUIPart): ToolUIPart {
  if (isToolPartFinal(part)) {
    return part;
  }

  return {
    ...getToolPartBase(part),
    state: "output-cancelled",
    input: part.input ?? null,
    ...("approval" in part
      ? {
          approval:
            part.state === "approval-requested"
              ? {
                  id: part.approval.id,
                  approved: false,
                  reason: "cancelled",
                }
              : part.approval,
        }
      : {}),
  };
}
