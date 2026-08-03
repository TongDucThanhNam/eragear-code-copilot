export interface SupervisorTerminalNotification {
  userId: string;
  chatId: string;
  turnId?: string;
  source: "client" | "supervisor" | "orchestrator";
  action: "done" | "needs_user" | "abort";
  reason: string;
  resultText: string;
}

export interface SupervisorTerminalNotifierPort {
  notify(input: SupervisorTerminalNotification): Promise<void>;
}

export const noopSupervisorTerminalNotifier: SupervisorTerminalNotifierPort = {
  notify: () => Promise.resolve(),
};
