import type {
  FeedbackListResult,
  FeedbackRecord,
  ListFeedbackInput,
  SubmitFeedbackInput,
} from "./contracts/feedback.contract";
import type { FeedbackRepositoryPort } from "./ports/feedback-repository.port";

export class FeedbackService {
  private readonly repository: FeedbackRepositoryPort;

  constructor(repository: FeedbackRepositoryPort) {
    this.repository = repository;
  }

  list(userId: string, input?: ListFeedbackInput): Promise<FeedbackListResult> {
    return this.repository.list(userId, input);
  }

  submit(userId: string, input: SubmitFeedbackInput): Promise<FeedbackRecord> {
    return this.repository.upsert(userId, {
      ...input,
      comment: input.comment?.trim() || undefined,
    });
  }
}
