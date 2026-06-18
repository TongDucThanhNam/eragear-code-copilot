import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  type CrashReport,
  type CrashReportingConfig,
  CrashReportingConfigSchema,
  CrashReportSchema,
} from "../application/contracts/crash-reporting.contract";
import type {
  CrashReportingRepositoryPort,
  CrashReportingStoreSnapshot,
  MutableCrashReportingStoreSnapshot,
} from "../application/ports/crash-reporting-repository.port";

const DOCUMENT_VERSION = 1;

const CrashReportingDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    config: CrashReportingConfigSchema.nullable(),
    reports: z.record(z.string(), CrashReportSchema),
  })
  .strict();

type CrashReportingDocument = z.infer<typeof CrashReportingDocumentSchema>;

interface CrashReportingFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class CrashReportingFileRepository
  implements CrashReportingRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: CrashReportingFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async read<T>(
    reader: (snapshot: CrashReportingStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(toStoreSnapshot(document));
    });
  }

  async mutate<T>(
    mutator: (snapshot: MutableCrashReportingStoreSnapshot) => T | Promise<T>
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

  private async readDocument(): Promise<CrashReportingDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return CrashReportingDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, config: null, reports: {} };
      }
      throw error;
    }
  }

  private async writeDocument(document: CrashReportingDocument): Promise<void> {
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
  document: CrashReportingDocument
): CrashReportingStoreSnapshot {
  return {
    config: document.config ? cloneConfig(document.config) : null,
    reports: Object.values(document.reports).map(cloneReport),
  };
}

function toMutableStoreSnapshot(
  document: CrashReportingDocument
): MutableCrashReportingStoreSnapshot {
  return {
    config: document.config ? cloneConfig(document.config) : null,
    reports: Object.values(document.reports).map(cloneReport),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableCrashReportingStoreSnapshot
): CrashReportingDocument {
  const reports: CrashReportingDocument["reports"] = {};
  for (const report of snapshot.reports) {
    reports[report.id] = cloneReport(report);
  }
  return CrashReportingDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    config: snapshot.config ? cloneConfig(snapshot.config) : null,
    reports,
  });
}

function cloneConfig(config: CrashReportingConfig): CrashReportingConfig {
  return CrashReportingConfigSchema.parse(config);
}

function cloneReport(report: CrashReport): CrashReport {
  return CrashReportSchema.parse(report);
}
