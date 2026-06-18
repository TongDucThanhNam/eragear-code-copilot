import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RemoteControlService } from "../application/remote-control.service";
import { RemoteControlFileRepository } from "./remote-control-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `eragear-remote-control-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("RemoteControlFileRepository", () => {
  test("persists remote devices and sessions behind the use-case interface", async () => {
    const filePath = path.join(tempDir, "remote-control.json");
    let now = 1000;
    let nextId = 1;
    const service = new RemoteControlService({
      repository: new RemoteControlFileRepository({
        filePath,
      }),
      now: () => now,
      createId: () => `remote-${nextId++}`,
    });

    const device = await service.upsertDevice("user-1", {
      name: "Desk Relay",
      relayUrl: "https://relay.example.com/desk",
    });
    await service.recordHeartbeat("user-1", device.id);
    const session = await service.startSession("user-1", {
      deviceId: device.id,
      ttlMs: 60_000,
    });
    now = 2000;
    const stopped = await service.stopSession("user-1", session.id);
    const status = await service.getStatus("user-1");
    const raw = await readFile(filePath, "utf8");

    expect(stopped.status).toBe("stopped");
    expect(status.devices[0]?.id).toBe(device.id);
    expect(status.sessions[0]?.id).toBe(session.id);
    expect(raw).toContain('"version": 1');
    expect(raw).toContain(device.id);
    expect(raw).toContain(session.id);
  });
});
