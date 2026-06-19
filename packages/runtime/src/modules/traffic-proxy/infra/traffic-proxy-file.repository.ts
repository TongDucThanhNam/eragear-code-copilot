import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  type TrafficProxyConfig,
  TrafficProxyConfigSchema,
} from "../application/contracts/traffic-proxy.contract";
import type {
  MutableTrafficProxyConfigSnapshot,
  TrafficProxyConfigSnapshot,
  TrafficProxyRepositoryPort,
} from "../application/ports/traffic-proxy-repository.port";

const DOCUMENT_VERSION = 1;

interface TrafficProxyFileRepositoryParams {
  filePath: string | (() => string);
}

interface TrafficProxyDocument {
  version: typeof DOCUMENT_VERSION;
  config: TrafficProxyConfig;
}

type MutableConfigSnapshot = MutableTrafficProxyConfigSnapshot & {
  getNext(): TrafficProxyConfig | null;
  hasChanged(): boolean;
};

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

  readConfig<T>(reader: (snapshot: TrafficProxyConfigSnapshot) => T): T {
    return reader(createConfigSnapshot(this.readConfigFile()));
  }

  mutateConfig<T>(
    mutator: (snapshot: MutableTrafficProxyConfigSnapshot) => T
  ): T {
    const snapshot = createMutableConfigSnapshot(this.readConfigFile());
    const result = mutator(snapshot);
    if (snapshot.hasChanged()) {
      const next = snapshot.getNext();
      if (!next) {
        return result;
      }
      this.writeConfigFile(next);
    }
    return result;
  }

  private readConfigFile(): TrafficProxyConfig | null {
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

  private writeConfigFile(config: TrafficProxyConfig): void {
    const filePath = this.filePathProvider();
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(
      tempPath,
      `${JSON.stringify({ version: DOCUMENT_VERSION, config }, null, 2)}\n`,
      "utf8"
    );
    renameSync(tempPath, filePath);
  }
}

function createConfigSnapshot(
  config: TrafficProxyConfig | null
): TrafficProxyConfigSnapshot {
  return {
    get() {
      return config ? cloneConfig(config) : null;
    },
  };
}

function createMutableConfigSnapshot(
  initial: TrafficProxyConfig | null
): MutableConfigSnapshot {
  let changed = false;
  let next = initial ? cloneConfig(initial) : null;
  return {
    get() {
      return next ? cloneConfig(next) : null;
    },
    set(config) {
      changed = true;
      next = cloneConfig(config);
    },
    getNext() {
      return next ? cloneConfig(next) : null;
    },
    hasChanged() {
      return changed;
    },
  };
}

function cloneConfig(config: TrafficProxyConfig): TrafficProxyConfig {
  return { ...config };
}
