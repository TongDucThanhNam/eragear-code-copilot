import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const LOCAL_PROXY_FALLBACK = "http://localhost:3010";
const PROTOCOL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

function withFallbackProtocol(value: string): string {
  if (PROTOCOL_REGEX.test(value)) {
    return value;
  }
  return `http://${value}`;
}

function resolveLocalProxyTarget(): string {
  const envValue = String(process.env.VITE_SERVER_URL ?? "").trim();
  if (!envValue) {
    return LOCAL_PROXY_FALLBACK;
  }

  try {
    const url = new URL(withFallbackProtocol(envValue));
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return LOCAL_PROXY_FALLBACK;
  }
}

const localProxyTarget = resolveLocalProxyTarget();

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({}),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "eragear-code-copilot",
        short_name: "eragear-code-copilot",
        description: "eragear-code-copilot - PWA Application",
        theme_color: "#0c0c0c",
      },
      pwaAssets: { disabled: false, config: true },
      devOptions: { enabled: true },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: localProxyTarget,
        changeOrigin: true,
      },
      "/trpc": {
        target: localProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
