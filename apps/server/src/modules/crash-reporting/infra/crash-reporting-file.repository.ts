import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  CrashReportSchema,
  type CrashReport,
  CrashReportingConfigSchema,
  type CrashReportingConfig,
} from "../application/contracts/crash-reporting.contract";
import type { CrashReportingRepositoryPort } from "../application/ports/crash-reporting-repository.port";

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

  async getConfig(): Promise<CrashReportingConfig | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return document.config;
    });
  }

  async saveConfig(
    config: CrashReportingConfig
  ): Promise<CrashReportingConfig> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      document.config = config;
      await this.writeDocument(document);
      return config;
    });
  }

  async listReports(userId: string): Promise<CrashReport[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return Object.values(document.reports)
        .filter((report) => report.userId === userId || report.userId === null)
        .sort((left, right) => right.createdAt - left.createdAt);
    });
  }

  async saveReport(
    report: CrashReport,
    archiveLimit: number
  ): Promise<CrashReport> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      document.reports[report.id] = report;
      const keepIds = Object.values(document.reports)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, archiveLimit)
        .map((item) => item.id);
      const keep = new Set(keepIds);
      for (const reportId of Object.keys(document.reports)) {
        if (!keep.has(reportId)) {
          delete document.reports[reportId];
        }
      }
      await this.writeDocument(document);
      return report;
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

  private async writeDocument(
    document: CrashReportingDocument
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
