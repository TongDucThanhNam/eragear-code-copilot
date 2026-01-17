export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  status: ConnectionStatus;
  onStop: () => void;
  onResume: () => void;
  isSessionStopped?: boolean;
  canResume?: boolean;
}
