import {
  DESKTOP_WINDOW_CONTROL_CHANNELS,
  type DesktopWindowControlState,
} from "./desktop-window-controls.js";

interface DesktopWindowControlIpcRenderer {
  invoke(channel: string): Promise<unknown>;
  on(
    channel: string,
    listener: (event: unknown, payload: unknown) => void
  ): void;
  off(
    channel: string,
    listener: (event: unknown, payload: unknown) => void
  ): void;
}

function toDesktopWindowControlState(
  value: unknown
): DesktopWindowControlState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<DesktopWindowControlState>;
  if (
    typeof candidate.isFullScreen !== "boolean" ||
    typeof candidate.isMaximized !== "boolean"
  ) {
    return null;
  }
  return {
    isFullScreen: candidate.isFullScreen,
    isMaximized: candidate.isMaximized,
  };
}

/** Exposes only the four fixed window operations; never ipcRenderer itself. */
export function createDesktopWindowControlsBridge(
  ipcRenderer: DesktopWindowControlIpcRenderer
) {
  return {
    close: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_WINDOW_CONTROL_CHANNELS.close);
    },
    getState: async (): Promise<DesktopWindowControlState | null> =>
      toDesktopWindowControlState(
        await ipcRenderer.invoke(DESKTOP_WINDOW_CONTROL_CHANNELS.getState)
      ),
    minimize: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_WINDOW_CONTROL_CHANNELS.minimize);
    },
    toggleMaximize: async (): Promise<DesktopWindowControlState | null> =>
      toDesktopWindowControlState(
        await ipcRenderer.invoke(DESKTOP_WINDOW_CONTROL_CHANNELS.toggleMaximize)
      ),
    onStateChange: (
      callback: (state: DesktopWindowControlState) => void
    ): (() => void) => {
      const listener = (_event: unknown, payload: unknown) => {
        const state = toDesktopWindowControlState(payload);
        if (state) {
          callback(state);
        }
      };
      ipcRenderer.on(DESKTOP_WINDOW_CONTROL_CHANNELS.stateChanged, listener);
      return () => {
        ipcRenderer.off(DESKTOP_WINDOW_CONTROL_CHANNELS.stateChanged, listener);
      };
    },
  };
}
