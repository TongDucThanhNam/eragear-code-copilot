import type {
  SessionBindingPort,
  SessionForkBinding,
} from "./ports/session-binding.port";

export interface ListSessionForksInput {
  userId: string;
  chatId: string;
}

export interface ListSessionForksResult {
  bindings: SessionForkBinding[];
  count: number;
}

export class ListSessionForksService {
  private readonly bindings: SessionBindingPort;

  constructor(bindings: SessionBindingPort) {
    this.bindings = bindings;
  }

  async execute(input: ListSessionForksInput): Promise<ListSessionForksResult> {
    const bindings = await this.bindings.listForks(input.userId, input.chatId);
    return {
      bindings,
      count: bindings.length,
    };
  }
}
