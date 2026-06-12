import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  RemoteRelayDeviceSchema,
  type RemoteRelayDevice,
  RemoteSessionSchema,
  type RemoteSession,
} from "../application/contracts/remote-control.contract";
import type { RemoteControlRepositoryPort } from "../application/ports/remote-control-repository.port";

const DOCUMENT_VERSION = 1;

const RemoteControlDocumentSchema = z
  .object({
    version: z.literal(DOCUMENT_VERSION),
    devices: z.record(z.string(), RemoteRelayDeviceSchema),
    sessions: z.record(z.string(), RemoteSessionSchema),
  })
  .strict();

type RemoteControlDocument = z.infer<typeof RemoteControlDocumentSchema>;

interface RemoteControlFileRepositoryParams {
  filePath: string | (() => string | Promise<string>);
}

export class RemoteControlFileRepository
  implements RemoteControlRepositoryPort
{
  private readonly filePathProvider: () => string | Promise<string>;
  private queue: Promise<void> = Promise.resolve();

  constructor(params: RemoteControlFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  async listDevices(userId: string): Promise<RemoteRelayDevice[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return Object.values(document.devices).filter(
        (device) => device.userId === userId
      );
    });
  }

  async getDevice(
    userId: string,
    deviceId: string
  ): Promise<RemoteRelayDevice | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const device = document.devices[deviceId];
      return device?.userId === userId ? device : null;
    });
  }

  async saveDevice(device: RemoteRelayDevice): Promise<RemoteRelayDevice> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      document.devices[device.id] = device;
      await this.writeDocument(document);
      return device;
    });
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.enqueue(async () => {
      const document = await this.readDocument();
      const device = document.devices[deviceId];
      if (device?.userId === userId) {
        delete document.devices[deviceId];
      }
      await this.writeDocument(document);
    });
  }

  async listSessions(userId: string): Promise<RemoteSession[]> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return Object.values(document.sessions).filter(
        (session) => session.userId === userId
      );
    });
  }

  async getSession(
    userId: string,
    sessionId: string
  ): Promise<RemoteSession | null> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      const session = document.sessions[sessionId];
      return session?.userId === userId ? session : null;
    });
  }

  async saveSession(session: RemoteSession): Promise<RemoteSession> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      document.sessions[session.id] = session;
      await this.writeDocument(document);
      return session;
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

  private async readDocument(): Promise<RemoteControlDocument> {
    const filePath = await this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf8");
      return RemoteControlDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (getNodeErrnoCode(error) === "ENOENT") {
        return { version: DOCUMENT_VERSION, devices: {}, sessions: {} };
      }
      throw error;
    }
  }

  private async writeDocument(
    document: RemoteControlDocument
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
