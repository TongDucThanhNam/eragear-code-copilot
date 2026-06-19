import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodingPlanSubscriptionFileRepository } from "./coding-plan-subscription-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("CodingPlanSubscriptionFileRepository", () => {
  test("persists coding-plan subscription snapshots", async () => {
    const filePath = path.join(tempDir, "coding-plan-subscription.json");
    const repository = new CodingPlanSubscriptionFileRepository({
      filePath: () => filePath,
    });

    await expect(
      repository.read((snapshot) => snapshot.subscriptionsByUserId)
    ).resolves.toEqual({});

    const subscription = await repository.mutate((snapshot) => {
      const next = {
        userId: "user-1",
        tier: "pro" as const,
        status: "active" as const,
        billingProvider: "local" as const,
        planId: "pro",
        updatedAt: 100,
        entitlements: [],
      };
      snapshot.subscriptionsByUserId["user-1"] = next;
      return next;
    });

    expect(subscription.tier).toBe("pro");
    await expect(
      repository.read((snapshot) => snapshot.subscriptionsByUserId["user-1"])
    ).resolves.toMatchObject({
      tier: "pro",
      status: "active",
    });

    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain('"version": 1');
    expect(raw).toContain("user-1");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `eragear-coding-plan-subscription-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
