import { mkdir } from "node:fs/promises";
import path from "node:path";
import { file, write } from "bun";

const serverRoot = path.resolve(import.meta.dir, "..");
const runtimeOutDir = path.join(serverRoot, "dist", "runtime");

await mkdir(runtimeOutDir, { recursive: true });
await write(
  path.join(runtimeOutDir, "mcp-agent-broker.js"),
  file(path.join(serverRoot, "src", "runtime", "mcp-agent-broker.js"))
);
