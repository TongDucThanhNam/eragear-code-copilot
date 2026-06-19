import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "#runtime/shared/utils/node-error.util";
import {
  type TerminalSettings,
  TerminalSettingsSchema,
} from "../application/contracts/terminal.contract";
import type {
  MutableTerminalSettingsStoreSnapshot,
  TerminalSettingsRepositoryPort,
  TerminalSettingsStoreSnapshot,
} from "../application/ports/terminal-settings-repository.port";

const DOCUMENT_VERSION = 1;

const TerminalSettingsDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    settingsByUserId: z.record(z.string(), TerminalSettingsSchema),
  })
  .strict();

type TerminalSettingsDocument = z.infer<typeof TerminalSettingsDocumentSchema>;

export interface TerminalSettingsFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class TerminalSettingsFileRepository
  implements TerminalSettingsRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: TerminalSettingsFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async read<T>(
    reader: (snapshot: TerminalSettingsStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(toStoreSnapshot(document));
    });
  }

  async mutate<T>(
    mutator: (snapshot: MutableTerminalSettingsStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const snapshot = toMutableStoreSnapshot(document);
      const result = await mutator(snapshot);
      await this.writeDocument(fromMutableStoreSnapshot(snapshot));
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

  private async readDocument(): Promise<TerminalSettingsDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return TerminalSettingsDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, settingsByUserId: {} };
      }
      throw error;
    }
  }

  private async writeDocument(
    document: TerminalSettingsDocument
  ): Promise<void> {
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

function toStoreSnapshot(
  document: TerminalSettingsDocument
): TerminalSettingsStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(document.settingsByUserId),
  };
}

function toMutableStoreSnapshot(
  document: TerminalSettingsDocument
): MutableTerminalSettingsStoreSnapshot {
  return {
    settingsByUserId: cloneSettingsByUserId(document.settingsByUserId),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableTerminalSettingsStoreSnapshot
): TerminalSettingsDocument {
  return TerminalSettingsDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    settingsByUserId: cloneSettingsByUserId(snapshot.settingsByUserId),
  });
}

function cloneSettingsByUserId(
  settingsByUserId: Readonly<Record<string, TerminalSettings>>
): Record<string, TerminalSettings> {
  return Object.fromEntries(
    Object.entries(settingsByUserId).map(([userId, settings]) => [
      userId,
      cloneSettings(settings),
    ])
  );
}

function cloneSettings(settings: TerminalSettings): TerminalSettings {
  return {
    ...settings,
    shellArgs: [...settings.shellArgs],
  };
}
