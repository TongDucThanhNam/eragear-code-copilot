import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { HarnessApp } from "./scenarios";

const params = new URLSearchParams(window.location.search);
document.documentElement.classList.toggle(
  "dark",
  params.get("theme") !== "light"
);

const rootElement = document.getElementById("app");
if (!rootElement) {
  throw new Error("Harness root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <HarnessApp
      scene={params.get("scene") ?? "workspace"}
      view={params.get("view") ?? "overview"}
    />
  </StrictMode>
);
