import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { CryptoHasher, deepEquals, file, Glob, JSONL, spawn, which } from "bun";

const execFileAsync = promisify(execFile);

async function measure(
  iterations: number,
  task: () => unknown | Promise<unknown>
): Promise<number> {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await task();
  }
  return performance.now() - startedAt;
}

function measureSync(iterations: number, task: () => unknown): number {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    task();
  }
  return performance.now() - startedAt;
}

function manualWhich(command: string): string | null {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function scanWithReaddir(
  root: string,
  extension: string
): Promise<string[]> {
  const files: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) {
      continue;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

async function scanWithBunGlob(
  root: string,
  extension: string
): Promise<string[]> {
  const files: string[] = [];
  for await (const fullPath of new Glob(`**/*${extension}`).scan({
    cwd: root,
    absolute: true,
    dot: true,
    followSymlinks: false,
    onlyFiles: true,
  })) {
    files.push(fullPath);
  }
  return files.sort();
}

async function main(): Promise<void> {
  const samplePlan = {
    entries: Array.from({ length: 20 }, (_, index) => ({
      content: `task-${index}`,
      priority: index % 3,
      status: index % 2 ? "pending" : "completed",
    })),
  };
  const samplePlanCopy = structuredClone(samplePlan);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "eragear-bun-1.4-bench-"));
  const sampleFile = path.join(tempRoot, "sample.json");
  const sampleBinaryFile = path.join(tempRoot, "sample.bin");
  await writeFile(sampleFile, JSON.stringify(samplePlan), "utf8");
  await writeFile(sampleBinaryFile, new Uint8Array(1024 * 1024).fill(97));

  const hashInput = `eragear:${"x".repeat(240)}`;
  const jsonLinesInput = `${Array.from({ length: 50_000 }, (_, index) =>
    JSON.stringify({
      type: "token_count",
      index,
      inputTokens: index % 100,
      model: "gpt-5.4",
    })
  ).join("\n")}\n`;
  const scanRoot = path.resolve(import.meta.dir, "../src");
  const [readdirFiles, globFiles] = await Promise.all([
    scanWithReaddir(scanRoot, ".ts"),
    scanWithBunGlob(scanRoot, ".ts"),
  ]);
  if (
    readdirFiles.length !== globFiles.length ||
    readdirFiles.some(
      (filePath, index) =>
        path.normalize(filePath) !== path.normalize(globFiles[index] ?? "")
    )
  ) {
    throw new Error(
      "Bun.Glob benchmark did not match recursive readdir output"
    );
  }

  try {
    const results = {
      runtime: process.versions.bun ?? "unknown",
      platform: `${process.platform}-${process.arch}`,
      milliseconds: {
        executableLookup: {
          iterations: 500,
          nodeFsScan: await measure(500, () => manualWhich("bun")),
          bunWhich: await measure(500, () =>
            which("bun", {
              PATH: process.env.PATH ?? "",
              cwd: process.cwd(),
            })
          ),
        },
        deepEquality: {
          iterations: 20_000,
          nodeIsDeepStrictEqual: measureSync(20_000, () =>
            isDeepStrictEqual(samplePlan, samplePlanCopy)
          ),
          bunDeepEqualsStrict: measureSync(20_000, () =>
            deepEquals(samplePlan, samplePlanCopy, true)
          ),
        },
        smallSha256: {
          iterations: 200_000,
          nodeCreateHash: measureSync(200_000, () =>
            createHash("sha256").update(hashInput).digest("hex")
          ),
          bunCryptoHasher: measureSync(200_000, () =>
            CryptoHasher.hash("sha256", hashInput, "hex")
          ),
        },
        jsonLines: {
          iterations: 30,
          recordsPerIteration: 50_000,
          splitAndJsonParse: measureSync(30, () =>
            jsonLinesInput.split("\n").filter(Boolean).map(JSON.parse)
          ),
          bunJsonLines: measureSync(30, () => JSONL.parse(jsonLinesInput)),
        },
        recursiveFileDiscovery: {
          iterations: 20,
          filesMatched: globFiles.length,
          nodeReaddir: await measure(20, () =>
            scanWithReaddir(scanRoot, ".ts")
          ),
          bunGlob: await measure(20, () => scanWithBunGlob(scanRoot, ".ts")),
        },
        subprocessStart: {
          iterations: 30,
          nodeExecFile: await measure(30, () =>
            execFileAsync(process.execPath, ["--version"], {
              windowsHide: true,
            })
          ),
          bunSpawn: await measure(30, async () => {
            const subprocess = spawn([process.execPath, "--version"], {
              stdout: "ignore",
              stderr: "ignore",
              windowsHide: true,
            });
            await subprocess.exited;
          }),
        },
        smallFileRead: {
          iterations: 2000,
          nodeReadFile: await measure(2000, () => readFile(sampleFile, "utf8")),
          bunFileText: await measure(2000, () => file(sampleFile).text()),
        },
        largeBinaryRead: {
          iterations: 200,
          bytesPerIteration: 1024 * 1024,
          nodeReadFile: await measure(200, () => readFile(sampleBinaryFile)),
          bunFileArrayBuffer: await measure(200, () =>
            file(sampleBinaryFile).arrayBuffer()
          ),
        },
      },
    };
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
