import { randomUUID } from "node:crypto";
import type {
  FeedbackListResult,
  FeedbackRecord,
  ListFeedbackInput,
  SubmitFeedbackInput,
} from "./contracts/feedback.contract";
import type { FeedbackRepositoryPort } from "./ports/feedback-repository.port";

export class FeedbackService {
  private readonly repository: FeedbackRepositoryPort;
  private readonly createId: () => string;
  private readonly nowMs: () => number;

  constructor(
    repository: FeedbackRepositoryPort,
    params: { createId?: () => string; nowMs?: () => number } = {}
  ) {
    this.repository = repository;
    this.createId = params.createId ?? randomUUID;
    this.nowMs = params.nowMs ?? Date.now;
  }

  list(userId: string, input?: ListFeedbackInput): Promise<FeedbackListResult> {
    return this.repository.read((records) => {
      const limit = input?.limit ?? 100;
      const filtered = records
        .filter((record) => record.userId === userId)
        .filter((record) => !input?.chatId || record.chatId === input.chatId)
        .filter(
          (record) => !input?.messageId || record.messageId === input.messageId
        )
        .sort((left, right) => right.updatedAt - left.updatedAt);
      return {
        feedback: filtered.slice(0, limit),
        totalCount: filtered.length,
      };
    });
  }

  submit(userId: string, input: SubmitFeedbackInput): Promise<FeedbackRecord> {
    return this.repository.mutate((records) => {
      const now = this.nowMs();
      const existingIndex = records.findIndex(
        (record) =>
          record.userId === userId &&
          record.chatId === input.chatId &&
          record.messageId === input.messageId
      );
      const existing = records[existingIndex];
      const record: FeedbackRecord = {
        id: existing?.id ?? this.createId(),
        userId,
        chatId: input.chatId,
        messageId: input.messageId,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existingIndex >= 0) {
        records[existingIndex] = record;
      } else {
        records.push(record);
      }
      return record;
    });
  }
}
