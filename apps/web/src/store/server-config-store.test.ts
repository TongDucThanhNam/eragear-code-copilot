import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_SERVER_URL } from "@/lib/server-url";
import { useServerConfigStore } from "./server-config-store";

describe("server-config-store", () => {
  beforeEach(() => {
    useServerConfigStore.getState().clearConfig();
  });

  test("stores only server URL bootstrap state for the web client", () => {
    const state = useServerConfigStore.getState();

    state.setServerUrl("ws://127.0.0.1:4010");
    state.setConfigured(true);

    const nextState = useServerConfigStore.getState();

    expect(nextState.serverUrl).toBe("ws://127.0.0.1:4010");
    expect(nextState.isConfigured).toBe(true);
    expect("apiKey" in nextState).toBe(false);
  });

  test("clearConfig resets the connection bootstrap state", () => {
    useServerConfigStore.setState({
      serverUrl: "ws://127.0.0.1:4010",
      isConfigured: true,
    });

    useServerConfigStore.getState().clearConfig();

    expect(useServerConfigStore.getState()).toMatchObject({
      serverUrl: DEFAULT_SERVER_URL,
      isConfigured: false,
    });
  });
});
