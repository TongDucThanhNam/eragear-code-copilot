import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FeedbackService } from "../application/feedback.service";
import { FeedbackFileRepository } from "./feedback-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `eragear-feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("FeedbackFileRepository", () => {
  test("persists feedback records behind the feedback use-case interface", async () => {
    const filePath = path.join(tempDir, "feedback.json");
    let now = 100;
    const repository = new FeedbackFileRepository({
      filePath: () => filePath,
    });
    const service = new FeedbackService(repository, {
      createId: () => "feedback-file-1",
      nowMs: () => now,
    });

    await service.submit("user-1", {
      chatId: "chat-1",
      messageId: "msg-1",
      rating: "positive",
      comment: " useful ",
    });
    now = 200;
    const updated = await service.submit("user-1", {
      chatId: "chat-1",
      messageId: "msg-1",
      rating: "negative",
    });
    const listed = await service.list("user-1", { chatId: "chat-1" });
    const raw = await readFile(filePath, "utf8");

    expect(updated.updatedAt).toBe(200);
    expect(listed).toEqual({
      feedback: [updated],
      totalCount: 1,
    });
    expect(raw).toContain("feedback-file-1");
    expect(raw).toContain('"version": 1');
  });
});
