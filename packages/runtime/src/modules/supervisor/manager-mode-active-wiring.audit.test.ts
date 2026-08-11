import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const LEGACY_ACTIVE_WIRING_PATTERN =
  /AiSdkSupervisor|generateText|MiniMax-M3|createMiniMax/;

describe("Manager Mode active wiring audit", () => {
  test("composition roots and active DI barrels contain no AI SDK or MiniMax supervisor calls", () => {
    const runtimeRoot = path.resolve(import.meta.dir, "../..");
    const activeFiles = [
      "bootstrap/service-registry/supervisor-services.ts",
      "bootstrap/service-registry/supervisor-orchestration-services.ts",
      "modules/supervisor/di.ts",
      "modules/supervisor-orchestration/di.ts",
    ];
    for (const relativePath of activeFiles) {
      const source = readFileSync(path.join(runtimeRoot, relativePath), "utf8");
      expect(source).not.toMatch(LEGACY_ACTIVE_WIRING_PATTERN);
    }
  });
});
