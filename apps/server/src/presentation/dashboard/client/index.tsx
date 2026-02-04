import { createRoot, hydrateRoot } from "react-dom/client";
import type { DashboardBootstrap } from "@/presentation/dashboard/dashboard-types";
import { DashboardApp } from "./dashboard-app";

const BOOTSTRAP_ID = "dashboard-bootstrap";

function readBootstrap(): DashboardBootstrap | null {
  const node = document.getElementById(BOOTSTRAP_ID);
  if (!node?.textContent) {
    return null;
  }
  try {
    return JSON.parse(node.textContent) as DashboardBootstrap;
  } catch (error) {
    if (console?.error) {
      console.error("Failed to parse dashboard bootstrap:", error);
    }
    return null;
  }
}

const root = document.getElementById("client-root");
if (root) {
  const bootstrap = readBootstrap();
  const app = <DashboardApp bootstrap={bootstrap} />;
  if (root.hasChildNodes()) {
    hydrateRoot(root, app);
  } else {
    createRoot(root).render(app);
  }
}
