import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupervisorScopedCommitPort } from "../application/supervisor-final-commit.service";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;
const LINE_BREAK_PATTERN = /\r?\n/;
const LEADING_CURRENT_DIRECTORY_PATTERN = /^\.\//;

export class GitScopedFinalCommitAdapter implements SupervisorScopedCommitPort {
  async commit(
    input: Parameters<SupervisorScopedCommitPort["commit"]>[0]
  ): Promise<{ commitSha: string; safetyRef: string }> {
    const projectRoot = await realpath(input.projectRoot);
    const repositoryRoot = await realpath(
      (await git(projectRoot, ["rev-parse", "--show-toplevel"])).trim()
    );
    const projectPrefix = normalizePath(
      path.relative(repositoryRoot, projectRoot)
    );
    const branch = (
      await git(repositoryRoot, ["symbolic-ref", "--short", "HEAD"])
    ).trim();
    const head = (await git(repositoryRoot, ["rev-parse", "HEAD"])).trim();
    const expectedHead = (
      await git(repositoryRoot, [
        "rev-parse",
        "--verify",
        `${input.expectedHead}^{commit}`,
      ])
    ).trim();
    if (branch !== input.expectedBranch) {
      throw new Error("Approved branch changed before final commit");
    }
    if (head !== expectedHead) {
      const expectedIsAncestor = await git(repositoryRoot, [
        "merge-base",
        "--is-ancestor",
        expectedHead,
        head,
      ]).then(
        () => true,
        () => false
      );
      const interveningSubjects = expectedIsAncestor
        ? (
            await git(repositoryRoot, [
              "log",
              "--format=%s",
              `${expectedHead}..${head}`,
            ])
          )
            .split(LINE_BREAK_PATTERN)
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      if (
        !expectedIsAncestor ||
        interveningSubjects.some(
          (subject) => !subject.startsWith("supervisos: checkpoint ")
        )
      ) {
        throw new Error("Approved HEAD changed outside Supervisor checkpoints");
      }
    }
    if (
      !input.allowDefaultBranch &&
      (branch === "main" || branch === "master")
    ) {
      throw new Error(
        "Default-branch commit was not authorized by plan approval"
      );
    }
    const ownedPaths = input.ownedPaths.map((item) =>
      validatePath(projectRoot, item)
    );
    const repositoryOwnedPaths = ownedPaths.map((item) =>
      projectPrefix ? `${projectPrefix}/${item}` : item
    );
    for (const relativePath of ownedPaths) {
      const actual = await fingerprintPath(
        path.resolve(projectRoot, relativePath)
      );
      if (input.expectedFingerprints[relativePath] !== actual) {
        throw new Error(
          `Owned file drifted after integration: ${relativePath}`
        );
      }
    }
    const safetyRef = `refs/eragear/supervisor-run-${sanitizeRef(input.runId)}-safety-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await git(repositoryRoot, ["update-ref", safetyRef, head]);

    const tempRoot = await mkdtemp(
      path.join(tmpdir(), "eragear-supervisor-commit-")
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: path.join(tempRoot, "index"),
    };
    try {
      await git(repositoryRoot, ["read-tree", "HEAD"], env);
      if (repositoryOwnedPaths.length > 0) {
        await git(
          repositoryRoot,
          ["--literal-pathspecs", "add", "-A", "--", ...repositoryOwnedPaths],
          env
        );
      }
      const staged = parseNullSeparated(
        await git(
          repositoryRoot,
          ["diff", "--cached", "--name-only", "-z"],
          env
        )
      );
      const owned = new Set(repositoryOwnedPaths);
      const outsideScope = staged.filter((item) => !owned.has(item));
      if (outsideScope.length > 0) {
        throw new Error(
          `Isolated index contains out-of-scope files: ${outsideScope.join(", ")}`
        );
      }
      await git(
        repositoryRoot,
        ["commit", "--allow-empty", "-m", input.message],
        env
      );
      const commitSha = (
        await git(repositoryRoot, ["rev-parse", "HEAD"])
      ).trim();
      const parent = (
        await git(repositoryRoot, ["rev-parse", `${commitSha}^`])
      ).trim();
      if (parent !== head) {
        throw new Error("Final commit parent does not match the approved HEAD");
      }
      const committedPaths = parseNullSeparated(
        await git(repositoryRoot, [
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
      if (repositoryOwnedPaths.length > 0) {
        await git(repositoryRoot, [
          "--literal-pathspecs",
          "reset",
          "-q",
          "HEAD",
          "--",
          ...repositoryOwnedPaths,
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

function normalizePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(LEADING_CURRENT_DIRECTORY_PATTERN, "");
}
