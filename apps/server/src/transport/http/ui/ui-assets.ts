import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV } from "@/config/environment";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const UI_STYLE_SOURCE_PATH = join(__dirname, "styles.css");

export interface UiAssets {
  stylesHref: string;
  clientEntry?: string;
}

export function getUiAssets(isDev: boolean = ENV.isDev): UiAssets {
  return {
    stylesHref: isDev ? "/styles.css" : "/ui/styles.css",
    clientEntry: isDev ? "/client.tsx" : "/ui/client.js",
  };
}
