import type {
  TerminalEvent,
  TerminalRecord,
  TerminalSettings,
} from "../contracts/terminal.contract";

export interface TerminalRuntimeCreateInput {
  userId: string;
  projectId?: string;
  cwd: string;
  settings: TerminalSettings;
}

export interface TerminalRuntimePort {
  list(userId: string): Promise<TerminalRecord[]>;
  create(input: TerminalRuntimeCreateInput): Promise<TerminalRecord>;
  write(
    userId: string,
    terminalId: string,
    data: string
  ): Promise<TerminalRecord>;
  kill(userId: string, terminalId: string): Promise<TerminalRecord>;
  subscribe(
    userId: string,
    terminalId: string,
    listener: (event: TerminalEvent) => void
  ): () => void;
}
