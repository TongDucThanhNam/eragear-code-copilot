export interface SessionForkBinding {
  id: string;
  userId: string;
  sourceChatId: string;
  forkedChatId: string;
  projectId?: string;
  projectRoot: string;
  createdAt: number;
  messageCount: number;
}

export interface SessionBindingPort {
  recordFork(binding: SessionForkBinding): Promise<SessionForkBinding>;
  listForks(userId: string, chatId: string): Promise<SessionForkBinding[]>;
}
