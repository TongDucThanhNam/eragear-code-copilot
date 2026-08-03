import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "#runtime/shared/utils/node-error.util";
import {
  type BotDefinition,
  BotDefinitionSchema,
  type BotQuotaAutomationState,
  BotQuotaAutomationStateSchema,
  type BotRun,
  BotRunSchema,
} from "../application/contracts/bots.contract";
import type {
  BotQuotaAutomationStateSnapshot,
  BotRepositoryPort,
  MutableBotQuotaAutomationStateSnapshot,
} from "../application/ports/bot-repository.port";

const DOCUMENT_VERSION = 2;

const BotDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    bots: z.record(z.string(), BotDefinitionSchema),
    runs: z.record(z.string(), BotRunSchema),
    quotaAutomation: BotQuotaAutomationStateSchema.default({
      windows: {},
      dispatched: {},
      cooldowns: {},
      providerLeases: {},
    }),
  })
  .strict();

type BotDocument = z.infer<typeof BotDocumentSchema>;

const LegacyBotDocumentSchema = z
  .object({
    version: z.literal(1),
    bots: z.record(z.string(), z.record(z.string(), z.unknown())),
    runs: z.record(z.string(), z.record(z.string(), z.unknown())),
    quotaAutomation: z
      .object({
        windows: z.record(z.string(), z.unknown()).default({}),
        dispatched: z.record(z.string(), z.unknown()).default({}),
        cooldowns: z.record(z.string(), z.unknown()).default({}),
      })
      .passthrough()
      .default({
        windows: {},
        dispatched: {},
        cooldowns: {},
      }),
  })
  .passthrough();

type MutableQuotaAutomationStateSnapshot =
  MutableBotQuotaAutomationStateSnapshot & {
    getNext(): BotQuotaAutomationState;
    hasChanged(): boolean;
  };

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
      return Object.values(document.bots).filter(
        (bot) => bot.userId === userId
      );
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
      return Object.values(document.runs).filter(
        (run) => run.userId === userId
      );
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

  async readQuotaAutomationState<T>(
    reader: (snapshot: BotQuotaAutomationStateSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(
        createQuotaAutomationSnapshot(document.quotaAutomation)
      );
    });
  }

  async mutateQuotaAutomationState<T>(
    mutator: (
      snapshot: MutableBotQuotaAutomationStateSnapshot
    ) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const snapshot = createMutableQuotaAutomationSnapshot(
        document.quotaAutomation
      );
      const result = await mutator(snapshot);
      if (snapshot.hasChanged()) {
        document.quotaAutomation = BotQuotaAutomationStateSchema.parse(
          snapshot.getNext()
        );
        await this.writeDocument(document);
      }
      return result;
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
      const parsed = JSON.parse(raw) as unknown;
      const version =
        parsed && typeof parsed === "object" && "version" in parsed
          ? (parsed as { version?: unknown }).version
          : undefined;
      if (version === 1) {
        return migrateLegacyDocument(LegacyBotDocumentSchema.parse(parsed));
      }
      return BotDocumentSchema.parse(parsed);
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return {
          version: DOCUMENT_VERSION,
          bots: {},
          runs: {},
          quotaAutomation: {
            windows: {},
            dispatched: {},
            cooldowns: {},
            providerLeases: {},
          },
        };
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

function createQuotaAutomationSnapshot(
  state: BotQuotaAutomationState
): BotQuotaAutomationStateSnapshot {
  return {
    get() {
      return cloneQuotaAutomationState(state);
    },
  };
}

function createMutableQuotaAutomationSnapshot(
  initial: BotQuotaAutomationState
): MutableQuotaAutomationStateSnapshot {
  let changed = false;
  let next = cloneQuotaAutomationState(initial);
  return {
    get() {
      return cloneQuotaAutomationState(next);
    },
    set(state) {
      changed = true;
      next = cloneQuotaAutomationState(state);
    },
    getNext() {
      return cloneQuotaAutomationState(next);
    },
    hasChanged() {
      return changed;
    },
  };
}

function cloneQuotaAutomationState(
  state: BotQuotaAutomationState
): BotQuotaAutomationState {
  return structuredClone(state);
}

function migrateLegacyDocument(
  legacy: z.infer<typeof LegacyBotDocumentSchema>
): BotDocument {
  const bots = Object.fromEntries(
    Object.entries(legacy.bots).map(([id, raw]) => {
      const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
      const providerIds =
        raw.triggerConfig &&
        typeof raw.triggerConfig === "object" &&
        "quota" in raw.triggerConfig &&
        raw.triggerConfig.quota &&
        typeof raw.triggerConfig.quota === "object" &&
        "providerIds" in raw.triggerConfig.quota &&
        Array.isArray(raw.triggerConfig.quota.providerIds)
          ? raw.triggerConfig.quota.providerIds.filter(
              (value): value is string => typeof value === "string"
            )
          : [];
      let providerId: string | undefined;
      if (typeof raw.providerId === "string") {
        providerId = raw.providerId;
      } else if (providerIds.length === 1) {
        providerId = providerIds[0];
      }
      return [
        id,
        BotDefinitionSchema.parse({
          ...raw,
          objective:
            typeof raw.objective === "string" && raw.objective.trim()
              ? raw.objective
              : prompt,
          prompt,
          workMode: "adaptive_session",
          promptStrategy: "fixed",
          ...(providerId ? { providerId } : {}),
        }),
      ];
    })
  );
  const runs = Object.fromEntries(
    Object.entries(legacy.runs).map(([id, raw]) => [
      id,
      BotRunSchema.parse({
        ...raw,
        completionState: "pending",
      }),
    ])
  );
  return BotDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    bots,
    runs,
    quotaAutomation: {
      windows: legacy.quotaAutomation.windows,
      dispatched: legacy.quotaAutomation.dispatched,
      cooldowns: legacy.quotaAutomation.cooldowns,
      providerLeases: {},
    },
  });
}
