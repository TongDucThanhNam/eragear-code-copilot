import { describe, expect, test } from "bun:test";
import type {
  FeedbackListResult,
  FeedbackRecord,
  ListFeedbackInput,
  SubmitFeedbackInput,
} from "./contracts/feedback.contract";
import { FeedbackService } from "./feedback.service";
import type { FeedbackRepositoryPort } from "./ports/feedback-repository.port";

class FeedbackRepositoryStub implements FeedbackRepositoryPort {
  calls: string[] = [];
  lastInput: SubmitFeedbackInput | null = null;
  record: FeedbackRecord = {
    id: "feedback-1",
    userId: "user-1",
    chatId: "chat-1",
    messageId: "msg-1",
    rating: "positive",
    comment: null,
    createdAt: 1,
    updatedAt: 1,
  };

  list(
    _userId: string,
    _input?: ListFeedbackInput
  ): Promise<FeedbackListResult> {
    this.calls.push("list");
    return Promise.resolve({ feedback: [this.record], totalCount: 1 });
  }

  upsert(_userId: string, input: SubmitFeedbackInput): Promise<FeedbackRecord> {
    this.calls.push("upsert");
    this.lastInput = input;
    return Promise.resolve(this.record);
  }
}

describe("FeedbackService", () => {
  test("lists and submits normalized feedback through the repository", async () => {
    const repository = new FeedbackRepositoryStub();
    const service = new FeedbackService(repository);

    const listed = await service.list("user-1", { chatId: "chat-1" });
    await service.submit("user-1", {
      chatId: "chat-1",
      messageId: "msg-1",
      rating: "negative",
      comment: "  too terse  ",
    });

    expect(listed.totalCount).toBe(1);
    expect(repository.calls).toEqual(["list", "upsert"]);
    expect(repository.lastInput?.comment).toBe("too terse");
  });
});
