import os from "node:os";
import path from "node:path";
import { getRuntimePlatform } from "./runtime-platform.util";

export function getPlatformConfigDir(): string {
  const runtimePlatform = getRuntimePlatform();
  if (runtimePlatform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }

  if (runtimePlatform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}
