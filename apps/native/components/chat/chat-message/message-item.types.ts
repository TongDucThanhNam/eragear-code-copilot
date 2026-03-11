import type { UIMessage, UIMessagePart } from "@repo/shared";
import type { FilePart, SourcePart } from "./agentic-message-utils";

export interface AssistantRenderData {
  chainItems: UIMessagePart[];
  finalAttachments: Array<SourcePart | FilePart>;
  finalText: string | null;
}

export interface UserRenderData {
  attachments: Array<SourcePart | FilePart>;
  fallbackParts: UIMessagePart[];
  text: string;
}

export interface MessageItemProps {
  bubbleMaxWidth: number;
  message: UIMessage;
  isLiveMessage: boolean;
}
