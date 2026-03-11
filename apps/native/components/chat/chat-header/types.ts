import type { Mode, Model } from "../chat-input/types";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  status: ConnectionStatus;
  onStop: () => void;
  onResume: () => void;
  isSessionStopped?: boolean;
  canResume?: boolean;
  isResumePending?: boolean;
  availableModes?: Mode[];
  currentModeId?: string | null;
  onModeChange?: (modeId: string) => void;
  availableModels?: Model[];
  currentModelId?: string | null;
  supportsModelSwitching?: boolean;
  onModelChange?: (modelId: string) => void;
  disabled?: boolean;
}
