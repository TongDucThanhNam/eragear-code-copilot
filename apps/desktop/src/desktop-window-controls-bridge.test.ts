import { describe, expect, test } from "bun:test";
import { DESKTOP_WINDOW_CONTROL_CHANNELS } from "./desktop-window-controls.js";
import { createDesktopWindowControlsBridge } from "./desktop-window-controls-bridge.js";

describe("desktop window controls preload bridge", () => {
  test("exposes only fixed channels and validates state payloads", async () => {
    const invocations: string[] = [];
    const listeners = new Map<
      string,
      (event: unknown, payload: unknown) => void
    >();
    const removedListeners: string[] = [];
    const bridge = createDesktopWindowControlsBridge({
      invoke(channel) {
        invocations.push(channel);
        if (
          channel === DESKTOP_WINDOW_CONTROL_CHANNELS.getState ||
          channel === DESKTOP_WINDOW_CONTROL_CHANNELS.toggleMaximize
        ) {
          return Promise.resolve({
            isFullScreen: false,
            isMaximized: true,
          });
        }
        return Promise.resolve();
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      off(channel, listener) {
        if (listeners.get(channel) === listener) {
          removedListeners.push(channel);
        }
      },
    });

    await bridge.minimize();
    expect(await bridge.getState()).toEqual({
      isFullScreen: false,
      isMaximized: true,
    });
    expect(await bridge.toggleMaximize()).toEqual({
      isFullScreen: false,
      isMaximized: true,
    });
    await bridge.close();
    expect(invocations).toEqual([
      DESKTOP_WINDOW_CONTROL_CHANNELS.minimize,
      DESKTOP_WINDOW_CONTROL_CHANNELS.getState,
      DESKTOP_WINDOW_CONTROL_CHANNELS.toggleMaximize,
      DESKTOP_WINDOW_CONTROL_CHANNELS.close,
    ]);

    const states: unknown[] = [];
    const unsubscribe = bridge.onStateChange((state) => states.push(state));
    const listener = listeners.get(
      DESKTOP_WINDOW_CONTROL_CHANNELS.stateChanged
    );
    listener?.({}, { isFullScreen: true, isMaximized: false });
    listener?.({}, { isFullScreen: "yes", isMaximized: false });
    expect(states).toEqual([{ isFullScreen: true, isMaximized: false }]);

    unsubscribe();
    expect(removedListeners).toEqual([
      DESKTOP_WINDOW_CONTROL_CHANNELS.stateChanged,
    ]);
  });

  test("fails closed for malformed invoke results", async () => {
    const bridge = createDesktopWindowControlsBridge({
      invoke: () => Promise.resolve({ isMaximized: true }),
      on: () => undefined,
      off: () => undefined,
    });

    expect(await bridge.getState()).toBeNull();
    expect(await bridge.toggleMaximize()).toBeNull();
  });
});
