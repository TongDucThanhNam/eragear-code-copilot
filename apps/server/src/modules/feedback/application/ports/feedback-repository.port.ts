import type {
  FeedbackListResult,
  FeedbackRecord,
  ListFeedbackInput,
  SubmitFeedbackInput,
} from "../contracts/feedback.contract";

export interface FeedbackRepositoryPort {
  list(userId: string, input?: ListFeedbackInput): Promise<FeedbackListResult>;
  upsert(userId: string, input: SubmitFeedbackInput): Promise<FeedbackRecord>;
}
