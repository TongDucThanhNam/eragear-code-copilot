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
  disabled?: boolean;
  onHeightChange?: (height: number) => void;
  onOpenAttachment?: () => void;
  onVoice?: () => void;
  availableModes: Mode[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: Model[];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  availableCommands: Command[];
}
