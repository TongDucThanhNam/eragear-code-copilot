import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const serverRoot = path.resolve(import.meta.dir, "..");
const runtimeOutDir = path.join(serverRoot, "dist", "runtime");

await mkdir(runtimeOutDir, { recursive: true });
await copyFile(
  path.join(serverRoot, "src", "runtime", "mcp-agent-broker.js"),
  path.join(runtimeOutDir, "mcp-agent-broker.js")
);
