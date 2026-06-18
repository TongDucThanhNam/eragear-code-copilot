import { describe, expect, test } from "bun:test";
import { remoteControlRouter } from "./remote-control";

describe("remoteControlRouter", () => {
  test("keeps extracted status procedures on the flat remote-control interface", () => {
    const procedures = remoteControlRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.getStatus).toBeDefined();
    expect(procedures.status).toBeUndefined();
    expect(procedures.remoteControlStatus).toBeUndefined();
  });

  test("keeps extracted device procedures on the flat remote-control interface", () => {
    const procedures = remoteControlRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.upsertDevice).toBeDefined();
    expect(procedures.deleteDevice).toBeDefined();
    expect(procedures.recordHeartbeat).toBeDefined();
    expect(procedures.device).toBeUndefined();
    expect(procedures.devices).toBeUndefined();
    expect(procedures.remoteControlDevice).toBeUndefined();
  });

  test("keeps extracted session procedures on the flat remote-control interface", () => {
    const procedures = remoteControlRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.startSession).toBeDefined();
    expect(procedures.stopSession).toBeDefined();
    expect(procedures.session).toBeUndefined();
    expect(procedures.sessions).toBeUndefined();
    expect(procedures.remoteControlSession).toBeUndefined();
  });
});
