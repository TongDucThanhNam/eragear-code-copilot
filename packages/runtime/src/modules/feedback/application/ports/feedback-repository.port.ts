import type { FeedbackRecord } from "../contracts/feedback.contract";

export interface FeedbackRepositoryPort {
  read<T>(
    reader: (records: readonly FeedbackRecord[]) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(mutator: (records: FeedbackRecord[]) => T | Promise<T>): Promise<T>;
}
