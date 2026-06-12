import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  BotDefinitionSchema,
  type BotDefinition,
  BotRunSchema,
  type BotRun,
} from "../application/contracts/bots.contract";
import type { BotRepositoryPort } from "../application/ports/bot-repository.port";

const DOCUMENT_VERSION = 1;

const BotDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    bots: z.record(z.string(), BotDefinitionSchema),
    runs: z.record(z.string(), BotRunSchema),
  })
  .strict();

type BotDocument = z.infer<typeof BotDocumentSchema>;

interface BotFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class BotFileRepository implements BotRepositoryPort {
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: BotFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async listBots(userId: string): Promise<BotDefinition[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return Object.values(document.bots).filter((bot) => bot.userId === userId);
    });
  }

  async getBot(userId: string, botId: string): Promise<BotDefinition | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const bot = document.bots[botId];
      return bot?.userId === userId ? bot : null;
    });
  }

  async saveBot(bot: BotDefinition): Promise<BotDefinition> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      document.bots[bot.id] = bot;
      await this.writeDocument(document);
      return bot;
    });
  }

  async deleteBot(userId: string, botId: string): Promise<void> {
    await this.enqueue(async () => {
      const document = await this.readDocument();
      const bot = document.bots[botId];
      if (bot?.userId === userId) {
        delete document.bots[botId];
        for (const [runId, run] of Object.entries(document.runs)) {
          if (run.userId === userId && run.botId === botId) {
            delete document.runs[runId];
          }
        }
      }
      await this.writeDocument(document);
    });
  }

  async listRuns(userId: string): Promise<BotRun[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return Object.values(document.runs).filter((run) => run.userId === userId);
    });
  }

  async getRun(userId: string, runId: string): Promise<BotRun | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const run = document.runs[runId];
      return run?.userId === userId ? run : null;
    });
  }

  async saveRun(run: BotRun): Promise<BotRun> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      document.runs[run.id] = run;
      await this.writeDocument(document);
      return run;
    });
  }

  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async readDocument(): Promise<BotDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return BotDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, bots: {}, runs: {} };
      }
      throw error;
    }
  }

  private async writeDocument(document: BotDocument): Promise<void> {
    const filePath = await this.resolveFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`);
    await rename(tempPath, filePath);
  }

  private async resolveFilePath(): Promise<string> {
    return await this.filePathProvider();
  }
}
