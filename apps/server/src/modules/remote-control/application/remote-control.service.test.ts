import { describe, expect, it } from "bun:test";
import type {
  RemoteRelayDevice,
  RemoteSession,
} from "./contracts/remote-control.contract";
import type {
  MutableRemoteControlStoreSnapshot,
  RemoteControlRepositoryPort,
  RemoteControlStoreSnapshot,
} from "./ports/remote-control-repository.port";
import { RemoteControlService } from "./remote-control.service";

class MemoryRemoteControlRepository implements RemoteControlRepositoryPort {
  readonly snapshot: MutableRemoteControlStoreSnapshot = {
    devices: [],
    sessions: [],
  };

  async read<T>(
    reader: (snapshot: RemoteControlStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader(cloneSnapshot(this.snapshot));
  }

  async mutate<T>(
    mutator: (snapshot: MutableRemoteControlStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.snapshot);
  }
}

describe("RemoteControlService", () => {
  it("registers devices and marks them online through heartbeat", async () => {
    let now = 1000;
    let ids = 0;
    const repository = new MemoryRemoteControlRepository();
    const service = new RemoteControlService({
      repository,
      now: () => now,
      createId: () => `id-${++ids}`,
    });

    const device = await service.upsertDevice("user-1", {
      name: "Relay Phone",
      relayUrl: "https://relay.example.com/device",
    });
    expect(device.status).toBe("offline");

    const heartbeat = await service.recordHeartbeat("user-1", device.id);
    expect(heartbeat.status).toBe("online");
    expect(heartbeat.lastSeenAt).toBe(1000);

    now += 121_000;
    const status = await service.getStatus("user-1");
    expect(status.devices[0]?.status).toBe("offline");
  });

  it("starts and stops remote sessions for relay devices", async () => {
    let now = 5000;
    let ids = 0;
    const repository = new MemoryRemoteControlRepository();
    const service = new RemoteControlService({
      repository,
      now: () => now,
      createId: () => `id-${++ids}`,
    });

    const device = await service.upsertDevice("user-1", {
      name: "Desk Relay",
      relayUrl: "https://relay.example.com/desk",
    });
    await service.recordHeartbeat("user-1", device.id);

    const session = await service.startSession("user-1", {
      deviceId: device.id,
      chatId: "chat-1",
      projectId: "project-1",
      ttlMs: 60_000,
      context: { trigger: "queue" },
    });
    expect(session.status).toBe("active");
    expect(session.startedAt).toBe(5000);
    expect(session.expiresAt).toBe(65_000);

    now = 6000;
    const stopped = await service.stopSession("user-1", session.id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.stoppedAt).toBe(6000);
  });

  it("scopes device and session reads by user", async () => {
    let ids = 0;
    const repository = new MemoryRemoteControlRepository();
    const service = new RemoteControlService({
      repository,
      now: () => 10_000,
      createId: () => `id-${++ids}`,
    });

    const device = await service.upsertDevice("user-1", {
      name: "Private Relay",
      relayUrl: "https://relay.example.com/private",
    });
    await service.startSession("user-1", { deviceId: device.id });

    const otherStatus = await service.getStatus("user-2");
    expect(otherStatus.devices).toEqual([]);
    expect(otherStatus.sessions).toEqual([]);
    expect(service.recordHeartbeat("user-2", device.id)).rejects.toThrow();
  });
});

function cloneSnapshot(
  snapshot: MutableRemoteControlStoreSnapshot
): RemoteControlStoreSnapshot {
  return {
    devices: snapshot.devices.map(cloneDevice),
    sessions: snapshot.sessions.map(cloneSession),
  };
}

function cloneDevice(device: RemoteRelayDevice): RemoteRelayDevice {
  return { ...device };
}

function cloneSession(session: RemoteSession): RemoteSession {
  return {
    ...session,
    context: { ...session.context },
  };
}
