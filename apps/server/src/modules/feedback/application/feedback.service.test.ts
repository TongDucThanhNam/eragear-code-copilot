import { describe, expect, test } from "bun:test";
import type { FeedbackRecord } from "./contracts/feedback.contract";
import { FeedbackService } from "./feedback.service";
import type { FeedbackRepositoryPort } from "./ports/feedback-repository.port";

class MemoryFeedbackRepository implements FeedbackRepositoryPort {
  readonly records: FeedbackRecord[] = [];

  async read<T>(
    reader: (records: readonly FeedbackRecord[]) => T | Promise<T>
  ): Promise<T> {
    return await reader(this.records.map(cloneFeedbackRecord));
  }

  async mutate<T>(
    mutator: (records: FeedbackRecord[]) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.records);
  }
}

describe("FeedbackService", () => {
  test("creates and updates feedback per user chat message", async () => {
    const repository = new MemoryFeedbackRepository();
    let now = 100;
    const service = new FeedbackService(repository, {
      createId: () => "feedback-1",
      nowMs: () => now,
    });

    const created = await service.submit("user-1", {
      chatId: "chat-1",
      messageId: "msg-1",
      rating: "positive",
      comment: "  helpful  ",
    });
    now = 200;
    const updated = await service.submit("user-1", {
      chatId: "chat-1",
      messageId: "msg-1",
      rating: "negative",
      comment: "   ",
    });

    expect(created).toEqual({
      id: "feedback-1",
      userId: "user-1",
      chatId: "chat-1",
      messageId: "msg-1",
      rating: "positive",
      comment: "helpful",
      createdAt: 100,
      updatedAt: 100,
    });
    expect(updated).toEqual({
      ...created,
      rating: "negative",
      comment: null,
      updatedAt: 200,
    });
    expect(repository.records).toHaveLength(1);
  });

  test("lists tenant-owned feedback with filters, limit, and updated ordering", async () => {
    const repository = new MemoryFeedbackRepository();
    const service = new FeedbackService(repository);
    repository.records.push(
      createRecord({ id: "older", chatId: "chat-1", updatedAt: 100 }),
      createRecord({ id: "newer", chatId: "chat-1", updatedAt: 300 }),
      createRecord({
        id: "other-message",
        chatId: "chat-1",
        messageId: "msg-2",
        updatedAt: 200,
      }),
      createRecord({
        id: "other-user",
        userId: "user-2",
        chatId: "chat-1",
        updatedAt: 400,
      })
    );

    const result = await service.list("user-1", {
      chatId: "chat-1",
      messageId: "msg-1",
      limit: 1,
    });

    expect(result).toEqual({
      feedback: [
        createRecord({ id: "newer", chatId: "chat-1", updatedAt: 300 }),
      ],
      totalCount: 2,
    });
  });
});

function createRecord(input: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: input.id ?? "feedback-1",
    userId: input.userId ?? "user-1",
    chatId: input.chatId ?? "chat-1",
    messageId: input.messageId ?? "msg-1",
    rating: input.rating ?? "positive",
    comment: input.comment ?? null,
    createdAt: input.createdAt ?? input.updatedAt ?? 100,
    updatedAt: input.updatedAt ?? 100,
  };
}

function cloneFeedbackRecord(record: FeedbackRecord): FeedbackRecord {
  return { ...record };
}
