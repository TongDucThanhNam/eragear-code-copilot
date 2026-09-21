import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionControlTitlebar } from "./mission-control-titlebar";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window"
);

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("MissionControlTitlebar", () => {
  test("keeps draggable chrome and all native controls above dialogs", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        eragearDesktop: {
          windowControls: {
            close: () => Promise.resolve(),
            getState: () =>
              Promise.resolve({ isFullScreen: false, isMaximized: false }),
            minimize: () => Promise.resolve(),
            onStateChange: () => () => undefined,
            toggleMaximize: () =>
              Promise.resolve({ isFullScreen: false, isMaximized: true }),
          },
        },
      },
    });

    const html = renderToStaticMarkup(<MissionControlTitlebar />);

    expect(html).toContain('aria-label="Desktop window controls"');
    expect(html).not.toContain(">Mission Control<");
    expect(html).toContain('data-eragear-window-drag="true"');
    expect(html).toContain('data-eragear-window-controls="true"');
    expect(html).toContain('data-eragear-window-no-drag="true"');
    expect(html).toContain("z-[70]");
    expect(html).toContain('aria-label="Minimize window"');
    expect(html).toContain('aria-label="Maximize window"');
    expect(html).toContain('aria-label="Close window"');
  });

  test("keeps the route usable in the web build without native controls", () => {
    Reflect.deleteProperty(globalThis, "window");

    const html = renderToStaticMarkup(<MissionControlTitlebar />);

    expect(html).toContain('aria-label="Desktop window controls"');
    expect(html).not.toContain('aria-label="Minimize window"');
  });
});
