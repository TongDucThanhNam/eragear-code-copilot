import type { ChatStatus } from "@repo/shared";
import type { Attachment } from "@/lib/attachments";

export interface Mode {
  id: string;
  name: string;
  description?: string | null;
}

export interface Model {
  modelId: string;
  name: string;
  description?: string | null;
}

export interface Command {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface ChatInputProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  status: ChatStatus;
  onHeightChange?: (height: number) => void;
  onOpenAttachment?: () => void;
  onVoice?: () => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  availableModes: Mode[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: Model[];
  currentModelId: string | null;
  supportsModelSwitching?: boolean;
  onModelChange: (modelId: string) => void;
  availableCommands: Command[];
}
