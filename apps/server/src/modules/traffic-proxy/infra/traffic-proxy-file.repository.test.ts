import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TrafficProxyConfig } from "../application/contracts/traffic-proxy.contract";
import { TrafficProxyFileRepository } from "./traffic-proxy-file.repository";

describe("TrafficProxyFileRepository", () => {
  it("persists config through the config snapshot seam", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "traffic-proxy-"));
    const filePath = path.join(root, "traffic-proxy.json");

    try {
      const repository = new TrafficProxyFileRepository({ filePath });
      const config = createConfig({
        enabled: true,
        httpsProxy: "https://proxy.example.com:8443",
      });

      repository.mutateConfig((snapshot) => {
        snapshot.set(config);
      });

      const loaded = repository.readConfig((snapshot) => snapshot.get());
      expect(loaded).toEqual(config);

      if (loaded) {
        loaded.enabled = false;
      }

      expect(repository.readConfig((snapshot) => snapshot.get())).toEqual(
        config
      );
      await expect(readPersistedVersion(filePath)).resolves.toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createConfig(
  overrides: Partial<TrafficProxyConfig> = {}
): TrafficProxyConfig {
  return {
    enabled: false,
    applyToAgents: true,
    httpProxy: "",
    httpsProxy: "",
    noProxy: "localhost,127.0.0.1,::1",
    useSystemCa: true,
    caBundlePath: "",
    updatedAt: 1,
    ...overrides,
  };
}

async function readPersistedVersion(filePath: string): Promise<number> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as { version?: number };
  return parsed.version ?? 0;
}
