export interface TurnConversationRollbackPort {
  resolveProjectRoot?(input: {
    userId: string;
    sessionId: string;
    projectId?: string;
  }): Promise<string>;
  execute(input: {
    userId: string;
    sessionId: string;
    projectRoot: string;
    turnCount: number;
  }): Promise<{ replayedMessages: number }>;
}
