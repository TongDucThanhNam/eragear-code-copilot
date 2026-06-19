import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type FeedbackRecord,
  FeedbackRecordSchema,
} from "../application/contracts/feedback.contract";
import type { FeedbackRepositoryPort } from "../application/ports/feedback-repository.port";

const FeedbackFileSchema = z.object({
  version: z.literal(1),
  records: z.array(FeedbackRecordSchema),
});

type FeedbackFile = z.infer<typeof FeedbackFileSchema>;

interface FeedbackFileRepositoryDeps {
  filePath: () => string;
}

export class FeedbackFileRepository implements FeedbackRepositoryPort {
  private readonly filePath: () => string;

  constructor(deps: FeedbackFileRepositoryDeps) {
    this.filePath = deps.filePath;
  }

  async read<T>(
    reader: (records: readonly FeedbackRecord[]) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    return await reader(file.records.map(cloneFeedbackRecord));
  }

  async mutate<T>(
    mutator: (records: FeedbackRecord[]) => T | Promise<T>
  ): Promise<T> {
    const file = await this.readFile();
    const records = file.records.map(cloneFeedbackRecord);
    const result = await mutator(records);
    await this.writeFile({
      version: 1,
      records: records.map(cloneFeedbackRecord),
    });
    return result;
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

function cloneFeedbackRecord(record: FeedbackRecord): FeedbackRecord {
  return FeedbackRecordSchema.parse(record);
}
