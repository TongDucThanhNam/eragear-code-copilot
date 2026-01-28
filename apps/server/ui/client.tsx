import { useEffect } from "hono/jsx";
import { render } from "hono/jsx/dom";

function ClientApp() {
  useEffect(() => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tab]")
    );
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tab-panel]")
    );

    const activate = (tab: string) => {
      for (const btn of buttons) {
        const isActive = btn.getAttribute("data-tab") === tab;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
      }
      for (const panel of panels) {
        const isActive = panel.getAttribute("data-tab-panel") === tab;
        panel.classList.toggle("hidden", !isActive);
      }

      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    };

    const handlers = new Map<HTMLElement, () => void>();
    for (const btn of buttons) {
      const handler = () => {
        const tab = btn.getAttribute("data-tab");
        if (tab) {
          activate(tab);
        }
      };
      handlers.set(btn, handler);
      btn.addEventListener("click", handler);
    }

    const root = document.getElementById("client-root");
    const initialTab =
      root?.getAttribute("data-active-tab") ||
      new URLSearchParams(window.location.search).get("tab");
    if (initialTab) {
      activate(initialTab);
    }

    return () => {
      for (const [btn, handler] of handlers.entries()) {
        btn.removeEventListener("click", handler);
      }
    };
  }, []);

  return null;
}

const root = document.getElementById("client-root");
if (root) {
  render(<ClientApp />, root);
}
