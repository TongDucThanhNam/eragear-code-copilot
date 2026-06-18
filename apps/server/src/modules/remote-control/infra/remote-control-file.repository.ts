import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getNodeErrnoCode } from "@/shared/utils/node-error.util";
import {
  type RemoteRelayDevice,
  RemoteRelayDeviceSchema,
  type RemoteSession,
  RemoteSessionSchema,
} from "../application/contracts/remote-control.contract";
import type {
  MutableRemoteControlStoreSnapshot,
  RemoteControlRepositoryPort,
  RemoteControlStoreSnapshot,
} from "../application/ports/remote-control-repository.port";

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

  async read<T>(
    reader: (snapshot: RemoteControlStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await this.enqueue(async () => {
      const document = await this.readDocument();
      return await reader(toStoreSnapshot(document));
    });
  }

  async mutate<T>(
    mutator: (snapshot: MutableRemoteControlStoreSnapshot) => T | Promise<T>
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

  private async writeDocument(document: RemoteControlDocument): Promise<void> {
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
  document: RemoteControlDocument
): RemoteControlStoreSnapshot {
  return {
    devices: Object.values(document.devices).map(cloneDevice),
    sessions: Object.values(document.sessions).map(cloneSession),
  };
}

function toMutableStoreSnapshot(
  document: RemoteControlDocument
): MutableRemoteControlStoreSnapshot {
  return {
    devices: Object.values(document.devices).map(cloneDevice),
    sessions: Object.values(document.sessions).map(cloneSession),
  };
}

function fromMutableStoreSnapshot(
  snapshot: MutableRemoteControlStoreSnapshot
): RemoteControlDocument {
  const devices: RemoteControlDocument["devices"] = {};
  for (const device of snapshot.devices) {
    devices[device.id] = cloneDevice(device);
  }
  const sessions: RemoteControlDocument["sessions"] = {};
  for (const session of snapshot.sessions) {
    sessions[session.id] = cloneSession(session);
  }
  return RemoteControlDocumentSchema.parse({
    version: DOCUMENT_VERSION,
    devices,
    sessions,
  });
}

function cloneDevice(device: RemoteRelayDevice): RemoteRelayDevice {
  return RemoteRelayDeviceSchema.parse(device);
}

function cloneSession(session: RemoteSession): RemoteSession {
  return RemoteSessionSchema.parse(session);
}
