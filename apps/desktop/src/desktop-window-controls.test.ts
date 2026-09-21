import { describe, expect, test } from "bun:test";
import { createDesktopWindowControlHandlers } from "./desktop-window-controls.js";

function createWindowTarget() {
  let destroyed = false;
  let fullScreen = false;
  let maximized = false;
  const calls = {
    close: 0,
    maximize: 0,
    minimize: 0,
    unmaximize: 0,
  };
  return {
    calls,
    close() {
      calls.close += 1;
    },
    isDestroyed: () => destroyed,
    isFullScreen: () => fullScreen,
    isMaximized: () => maximized,
    maximize() {
      calls.maximize += 1;
      maximized = true;
    },
    minimize() {
      calls.minimize += 1;
    },
    setDestroyed(value: boolean) {
      destroyed = value;
    },
    setFullScreen(value: boolean) {
      fullScreen = value;
    },
    unmaximize() {
      calls.unmaximize += 1;
      maximized = false;
    },
  };
}

describe("desktop window control main handlers", () => {
  test("controls only the trusted main window and returns current state", () => {
    const mainWindow = createWindowTarget();
    const trustedSender = {};
    const event = { sender: trustedSender };
    const handlers = createDesktopWindowControlHandlers({
      getMainWindow: () => mainWindow,
      getWindowFromSender: (candidate) =>
        candidate.sender === trustedSender ? mainWindow : null,
    });

    mainWindow.setFullScreen(true);
    expect(handlers.getState(event)).toEqual({
      isFullScreen: true,
      isMaximized: false,
    });

    handlers.minimize(event);
    expect(mainWindow.calls.minimize).toBe(1);

    expect(handlers.toggleMaximize(event)).toEqual({
      isFullScreen: true,
      isMaximized: true,
    });
    expect(mainWindow.calls.maximize).toBe(1);

    expect(handlers.toggleMaximize(event)).toEqual({
      isFullScreen: true,
      isMaximized: false,
    });
    expect(mainWindow.calls.unmaximize).toBe(1);

    handlers.close(event);
    expect(mainWindow.calls.close).toBe(1);
  });

  test("rejects a renderer that does not own the trusted main window", () => {
    const mainWindow = createWindowTarget();
    const handlers = createDesktopWindowControlHandlers({
      getMainWindow: () => mainWindow,
      getWindowFromSender: () => createWindowTarget(),
    });

    expect(() => handlers.minimize({ sender: {} })).toThrow(
      "must originate from the main renderer"
    );
    expect(() => handlers.close({ sender: {} })).toThrow(
      "must originate from the main renderer"
    );
    expect(mainWindow.calls.minimize).toBe(0);
    expect(mainWindow.calls.close).toBe(0);
  });

  test("rejects controls after the main window is destroyed", () => {
    const mainWindow = createWindowTarget();
    mainWindow.setDestroyed(true);
    const handlers = createDesktopWindowControlHandlers({
      getMainWindow: () => mainWindow,
      getWindowFromSender: () => mainWindow,
    });

    expect(() => handlers.getState({ sender: {} })).toThrow(
      "must originate from the main renderer"
    );
  });
});
