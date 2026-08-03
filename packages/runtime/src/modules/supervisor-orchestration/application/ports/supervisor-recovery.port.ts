export interface SupervisorRecoverySessionState {
  status: "running" | "stopped" | "missing";
  resumable: boolean;
}

export interface SupervisorRecoverySessionPort {
  inspect(input: {
    userId: string;
    chatId: string;
  }): Promise<SupervisorRecoverySessionState>;
}

export interface SupervisorRecoverySummary {
  runs: number;
  live: number;
  resumed: number;
  interrupted: number;
  cleaned: number;
  paused: number;
}
