import { open, opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  SupervisorProjectContextFile,
  SupervisorProjectContextPort,
  SupervisorProjectContextSnapshot,
} from "../application/ports/supervisor-chat.port";

const MAX_TOP_LEVEL_ENTRIES = 40;
const MAX_CONTEXT_FILES = 8;
const MAX_EXCERPT_CHARS = 2200;
const MAX_FILE_BYTES = 64 * 1024;

const STATIC_CONTEXT_FILES: Array<{
  path: string;
  kind: SupervisorProjectContextFile["kind"];
}> = [
  { path: "README.md", kind: "readme" },
  { path: "readme.md", kind: "readme" },
  { path: "package.json", kind: "manifest" },
  { path: "index.html", kind: "entry" },
  { path: "src/index.html", kind: "entry" },
  { path: "src/main.ts", kind: "entry" },
  { path: "src/main.tsx", kind: "entry" },
  { path: "src/main.js", kind: "entry" },
  { path: "src/App.tsx", kind: "entry" },
  { path: "app/page.tsx", kind: "entry" },
  { path: "vite.config.ts", kind: "config" },
  { path: "next.config.js", kind: "config" },
];

const SKIP_TOP_LEVEL = new Set([
  ".git",
  ".eragear",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
]);

export class FileSystemSupervisorProjectContextAdapter
  implements SupervisorProjectContextPort
{
  async build(input: {
    projectRoot: string;
  }): Promise<SupervisorProjectContextSnapshot> {
    const root = await realpath(input.projectRoot);
    const diagnostics: string[] = [];
    const topLevelEntries = await listTopLevelEntries(root, diagnostics);
    const files = await readContextFiles({
      root,
      topLevelEntries,
      diagnostics,
    });
    return { topLevelEntries, files, diagnostics };
  }
}

async function listTopLevelEntries(
  root: string,
  diagnostics: string[]
): Promise<string[]> {
  const entries: string[] = [];
  try {
    const dir = await opendir(root);
    for await (const entry of dir) {
      if (entries.length >= MAX_TOP_LEVEL_ENTRIES) {
        diagnostics.push("Top-level entry list truncated.");
        break;
      }
      if (shouldSkipEntryName(entry.name)) {
        continue;
      }
      entries.push(`${entry.name}${entry.isDirectory() ? "/" : ""}`);
    }
  } catch (error) {
    diagnostics.push(
      `Unable to list project root: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return entries.sort((a, b) => a.localeCompare(b));
}

async function readContextFiles(params: {
  root: string;
  topLevelEntries: string[];
  diagnostics: string[];
}): Promise<SupervisorProjectContextFile[]> {
  const candidates = [
    ...STATIC_CONTEXT_FILES,
    ...params.topLevelEntries
      .filter((entry) => entry.toLowerCase().endsWith(".html"))
      .slice(0, 4)
      .map((entry) => ({ path: entry, kind: "entry" as const })),
  ];
  const seen = new Set<string>();
  const files: SupervisorProjectContextFile[] = [];

  for (const candidate of candidates) {
    if (files.length >= MAX_CONTEXT_FILES) {
      params.diagnostics.push("Project context file list truncated.");
      break;
    }
    const normalized = normalizeRelativePath(candidate.path);
    if (!normalized) {
      continue;
    }
    const seenKey = normalized.toLowerCase();
    if (seen.has(seenKey)) {
      continue;
    }
    seen.add(seenKey);
    const file = await readContextFile(params.root, normalized, candidate.kind);
    if (file) {
      files.push(file);
    }
  }

  return files;
}

async function readContextFile(
  root: string,
  relativePath: string,
  kind: SupervisorProjectContextFile["kind"]
): Promise<SupervisorProjectContextFile | null> {
  const resolved = path.resolve(root, relativePath);
  if (!isPathInside(root, resolved)) {
    return null;
  }
  try {
    const resolvedRealPath = await realpath(resolved);
    if (!isPathInside(root, resolvedRealPath)) {
      return null;
    }
    const fileStat = await stat(resolvedRealPath);
    if (!fileStat.isFile()) {
      return null;
    }
    const raw = await readBoundedTextFile(resolvedRealPath);
    const excerpt =
      kind === "manifest" && relativePath === "package.json"
        ? summarizePackageJson(raw)
        : normalizeTextExcerpt(raw);
    if (!excerpt) {
      return null;
    }
    return { path: relativePath, kind, excerpt };
  } catch {
    return null;
  }
}

async function readBoundedTextFile(filePath: string): Promise<string> {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES);
    const { bytesRead } = await file.read(buffer, 0, MAX_FILE_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

function summarizePackageJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      description?: unknown;
      scripts?: unknown;
      dependencies?: unknown;
      devDependencies?: unknown;
    };
    const scripts =
      parsed.scripts && typeof parsed.scripts === "object"
        ? Object.keys(parsed.scripts).slice(0, 12)
        : [];
    const deps =
      parsed.dependencies && typeof parsed.dependencies === "object"
        ? Object.keys(parsed.dependencies).slice(0, 16)
        : [];
    const devDeps =
      parsed.devDependencies && typeof parsed.devDependencies === "object"
        ? Object.keys(parsed.devDependencies).slice(0, 12)
        : [];
    return normalizeTextExcerpt(
      [
        typeof parsed.name === "string" ? `name: ${parsed.name}` : "",
        typeof parsed.description === "string"
          ? `description: ${parsed.description}`
          : "",
        scripts.length ? `scripts: ${scripts.join(", ")}` : "",
        deps.length ? `dependencies: ${deps.join(", ")}` : "",
        devDeps.length ? `devDependencies: ${devDeps.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  } catch {
    return normalizeTextExcerpt(raw);
  }
}

function normalizeTextExcerpt(raw: string): string {
  return raw
    .split(String.fromCharCode(0))
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, MAX_EXCERPT_CHARS);
}

function normalizeRelativePath(value: string): string | null {
  if (!value || path.isAbsolute(value)) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.includes("..")) {
    return null;
  }
  return normalized;
}

function shouldSkipEntryName(name: string): boolean {
  return name.startsWith(".") || SKIP_TOP_LEVEL.has(name);
}

function isPathInside(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return Boolean(
    relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative))
  );
}
