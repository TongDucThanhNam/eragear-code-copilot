import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupervisorScopedCommitPort } from "../application/supervisor-final-commit.service";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

export class GitScopedFinalCommitAdapter implements SupervisorScopedCommitPort {
  async commit(
    input: Parameters<SupervisorScopedCommitPort["commit"]>[0]
  ): Promise<{ commitSha: string; safetyRef: string }> {
    const root = await realpath(input.projectRoot);
    const topLevel = await git(root, ["rev-parse", "--show-toplevel"]);
    if ((await realpath(topLevel.trim())) !== root) {
      throw new Error("Project root is not the Git worktree root");
    }
    const branch = (
      await git(root, ["symbolic-ref", "--short", "HEAD"])
    ).trim();
    const head = (await git(root, ["rev-parse", "HEAD"])).trim();
    const expectedHead = (
      await git(root, [
        "rev-parse",
        "--verify",
        `${input.expectedHead}^{commit}`,
      ])
    ).trim();
    if (branch !== input.expectedBranch || head !== expectedHead) {
      throw new Error("Approved branch or HEAD changed before final commit");
    }
    if (
      !input.allowDefaultBranch &&
      (branch === "main" || branch === "master")
    ) {
      throw new Error(
        "Default-branch commit was not authorized by plan approval"
      );
    }
    const ownedPaths = input.ownedPaths.map((item) => validatePath(root, item));
    for (const relativePath of ownedPaths) {
      const actual = await fingerprintPath(path.resolve(root, relativePath));
      if (input.expectedFingerprints[relativePath] !== actual) {
        throw new Error(
          `Owned file drifted after integration: ${relativePath}`
        );
      }
    }
    const safetyRef = `refs/eragear/supervisor-run-${sanitizeRef(input.runId)}-safety-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await git(root, ["update-ref", safetyRef, head]);

    const tempRoot = await mkdtemp(
      path.join(tmpdir(), "eragear-supervisor-commit-")
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: path.join(tempRoot, "index"),
    };
    try {
      await git(root, ["read-tree", "HEAD"], env);
      if (ownedPaths.length > 0) {
        await git(
          root,
          ["--literal-pathspecs", "add", "-A", "--", ...ownedPaths],
          env
        );
      }
      const staged = parseNullSeparated(
        await git(root, ["diff", "--cached", "--name-only", "-z"], env)
      );
      const owned = new Set(ownedPaths);
      const outsideScope = staged.filter((item) => !owned.has(item));
      if (outsideScope.length > 0) {
        throw new Error(
          `Isolated index contains out-of-scope files: ${outsideScope.join(", ")}`
        );
      }
      await git(root, ["commit", "--allow-empty", "-m", input.message], env);
      const commitSha = (await git(root, ["rev-parse", "HEAD"])).trim();
      const parent = (await git(root, ["rev-parse", `${commitSha}^`])).trim();
      if (parent !== head) {
        throw new Error("Final commit parent does not match the approved HEAD");
      }
      const committedPaths = parseNullSeparated(
        await git(root, [
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          commitSha,
        ])
      );
      const committedOutsideScope = committedPaths.filter(
        (item) => !owned.has(item)
      );
      if (committedOutsideScope.length > 0) {
        throw new Error(
          `Final commit contains out-of-scope files: ${committedOutsideScope.join(", ")}`
        );
      }
      if (ownedPaths.length > 0) {
        await git(root, [
          "--literal-pathspecs",
          "reset",
          "-q",
          "HEAD",
          "--",
          ...ownedPaths,
        ]);
      }
      return { commitSha, safetyRef };
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }
}

async function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return result.stdout;
}

function validatePath(root: string, value: string): string {
  const portable = value.replaceAll("\\", "/");
  if (
    !portable ||
    path.posix.isAbsolute(portable) ||
    portable.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new Error(`Invalid run-owned path: ${value}`);
  }
  const resolved = path.resolve(root, portable);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Run-owned path escapes project root: ${value}`);
  }
  return portable;
}

async function fingerprintPath(target: string): Promise<string> {
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      return createHash("sha256").update("directory").digest("hex");
    }
    return createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
  } catch {
    return createHash("sha256").update("missing").digest("hex");
  }
}

function parseNullSeparated(value: string): string[] {
  return value
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"));
}

function sanitizeRef(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
}
