import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  TrafficProxyConfigSchema,
  type TrafficProxyConfig,
} from "../application/contracts/traffic-proxy.contract";
import type { TrafficProxyRepositoryPort } from "../application/ports/traffic-proxy-repository.port";

const DOCUMENT_VERSION = 1;

interface TrafficProxyFileRepositoryParams {
  filePath: string | (() => string);
}

interface TrafficProxyDocument {
  version: typeof DOCUMENT_VERSION;
  config: TrafficProxyConfig;
}

export class TrafficProxyFileRepository implements TrafficProxyRepositoryPort {
  private readonly filePathProvider: () => string;

  constructor(params: TrafficProxyFileRepositoryParams) {
    if (typeof params.filePath === "string") {
      const filePath = params.filePath;
      this.filePathProvider = () => filePath;
    } else {
      this.filePathProvider = params.filePath;
    }
  }

  getConfig(): TrafficProxyConfig | null {
    const filePath = this.filePathProvider();
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as TrafficProxyDocument;
    if (parsed.version !== DOCUMENT_VERSION) {
      return null;
    }
    return TrafficProxyConfigSchema.parse(parsed.config);
  }

  saveConfig(config: TrafficProxyConfig): TrafficProxyConfig {
    const filePath = this.filePathProvider();
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(
      tempPath,
      `${JSON.stringify({ version: DOCUMENT_VERSION, config }, null, 2)}\n`,
      "utf8"
    );
    renameSync(tempPath, filePath);
    return config;
  }
}
