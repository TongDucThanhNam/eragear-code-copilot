import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type FeedbackListResult,
  type FeedbackRecord,
  FeedbackRecordSchema,
  type ListFeedbackInput,
  type SubmitFeedbackInput,
} from "../application/contracts/feedback.contract";
import type { FeedbackRepositoryPort } from "../application/ports/feedback-repository.port";

const FeedbackFileSchema = z.object({
  version: z.literal(1),
  records: z.array(FeedbackRecordSchema),
});

type FeedbackFile = z.infer<typeof FeedbackFileSchema>;

interface FeedbackFileRepositoryDeps {
  filePath: () => string;
  now?: () => number;
  createId?: () => string;
}

export class FeedbackFileRepository implements FeedbackRepositoryPort {
  private readonly filePath: () => string;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(deps: FeedbackFileRepositoryDeps) {
    this.filePath = deps.filePath;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? randomUUID;
  }

  async list(
    userId: string,
    input?: ListFeedbackInput
  ): Promise<FeedbackListResult> {
    const file = await this.readFile();
    const limit = input?.limit ?? 100;
    const filtered = file.records
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
  }

  async upsert(
    userId: string,
    input: SubmitFeedbackInput
  ): Promise<FeedbackRecord> {
    const file = await this.readFile();
    const now = this.now();
    const existingIndex = file.records.findIndex(
      (record) =>
        record.userId === userId &&
        record.chatId === input.chatId &&
        record.messageId === input.messageId
    );
    const existing = file.records[existingIndex];
    const record: FeedbackRecord = {
      id: existing?.id ?? this.createId(),
      userId,
      chatId: input.chatId,
      messageId: input.messageId,
      rating: input.rating,
      comment: input.comment ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existingIndex >= 0) {
      file.records[existingIndex] = record;
    } else {
      file.records.push(record);
    }
    await this.writeFile(file);
    return record;
  }

  private async readFile(): Promise<FeedbackFile> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      return FeedbackFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        String((error as { code?: unknown }).code) === "ENOENT"
      ) {
        return { version: 1, records: [] };
      }
      throw error;
    }
  }

  private async writeFile(file: FeedbackFile): Promise<void> {
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}
