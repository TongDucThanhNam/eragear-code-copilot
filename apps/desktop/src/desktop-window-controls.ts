export const DESKTOP_WINDOW_CONTROL_CHANNELS = {
  close: "eragear:window:close",
  getState: "eragear:window:getState",
  minimize: "eragear:window:minimize",
  stateChanged: "eragear:windowStateChanged",
  toggleMaximize: "eragear:window:toggleMaximize",
} as const;

export interface DesktopWindowControlState {
  isFullScreen: boolean;
  isMaximized: boolean;
}

interface DesktopWindowControlSenderEvent {
  readonly sender: object;
}

interface DesktopWindowControlTarget {
  close(): void;
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  maximize(): void;
  minimize(): void;
  unmaximize(): void;
}

interface DesktopWindowControlHandlerDeps {
  getMainWindow(): DesktopWindowControlTarget | null;
  getWindowFromSender(
    event: DesktopWindowControlSenderEvent
  ): DesktopWindowControlTarget | null;
}

function getDesktopWindowControlState(
  window: DesktopWindowControlTarget
): DesktopWindowControlState {
  return {
    isFullScreen: window.isFullScreen(),
    isMaximized: window.isMaximized(),
  };
}

function requireTrustedMainWindow(
  event: DesktopWindowControlSenderEvent,
  deps: DesktopWindowControlHandlerDeps
): DesktopWindowControlTarget {
  const mainWindow = deps.getMainWindow();
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    deps.getWindowFromSender(event) !== mainWindow
  ) {
    throw new Error(
      "Desktop window control requests must originate from the main renderer."
    );
  }
  return mainWindow;
}

/**
 * Keeps privileged BrowserWindow mutations in Electron main while making the
 * sender trust boundary independently testable.
 */
export function createDesktopWindowControlHandlers(
  deps: DesktopWindowControlHandlerDeps
) {
  return {
    close(event: DesktopWindowControlSenderEvent): void {
      requireTrustedMainWindow(event, deps).close();
    },
    getState(
      event: DesktopWindowControlSenderEvent
    ): DesktopWindowControlState {
      return getDesktopWindowControlState(
        requireTrustedMainWindow(event, deps)
      );
    },
    minimize(event: DesktopWindowControlSenderEvent): void {
      requireTrustedMainWindow(event, deps).minimize();
    },
    toggleMaximize(
      event: DesktopWindowControlSenderEvent
    ): DesktopWindowControlState {
      const window = requireTrustedMainWindow(event, deps);
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return getDesktopWindowControlState(window);
    },
  };
}
