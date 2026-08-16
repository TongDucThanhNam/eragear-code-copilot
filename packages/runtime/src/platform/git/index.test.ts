import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitAdapter } from "./index";

const tempDirs: string[] = [];
const LINE_BREAK_REGEX = /\r?\n/;

async function createTempProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eragear-git-adapter-"));
  tempDirs.push(dir);
  return dir;
}

function runGitOrThrow(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status === 0) {
    return;
  }
  throw new Error(
    `git ${args.join(" ")} failed with status ${String(result.status)}: ${result.stderr}`
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("GitAdapter", () => {
  test("getRepositoryState returns branch and changed files", async () => {
    const projectRoot = await createTempProjectDir();
    runGitOrThrow(projectRoot, ["init"]);
    runGitOrThrow(projectRoot, ["config", "user.email", "test@example.com"]);
    runGitOrThrow(projectRoot, ["config", "user.name", "Test User"]);
    await writeFile(join(projectRoot, "tracked.txt"), "initial\n", "utf8");
    runGitOrThrow(projectRoot, ["add", "tracked.txt"]);
    runGitOrThrow(projectRoot, ["commit", "-m", "initial"]);
    await writeFile(join(projectRoot, "tracked.txt"), "changed\n", "utf8");
    await writeFile(join(projectRoot, "staged.txt"), "staged\n", "utf8");
    await writeFile(join(projectRoot, "untracked.txt"), "new\n", "utf8");
    runGitOrThrow(projectRoot, ["add", "staged.txt"]);

    const adapter = new GitAdapter();
    const state = await adapter.getRepositoryState(projectRoot);

    expect(state.isRepository).toBe(true);
    expect(state.head).toBeTruthy();
    expect(state.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "staged.txt",
          status: "added",
          staged: true,
          unstaged: false,
        }),
        expect.objectContaining({
          path: "tracked.txt",
          status: "modified",
          staged: false,
          unstaged: true,
        }),
        expect.objectContaining({
          path: "untracked.txt",
          status: "untracked",
          staged: false,
          unstaged: true,
        }),
      ])
    );
  });

  test("getRepositoryState returns unavailable state outside git repos", async () => {
    const projectRoot = await createTempProjectDir();
    const adapter = new GitAdapter();

    const state = await adapter.getRepositoryState(projectRoot);

    expect(state).toMatchObject({
      isRepository: false,
      ahead: 0,
      behind: 0,
      changedFiles: [],
    });
    expect(state.error).toContain("not a Git repository");
  });

  test("createCheckpoint persists metadata and restore reverses tracked changes", async () => {
    const projectRoot = await createTempProjectDir();
    runGitOrThrow(projectRoot, ["init"]);
    runGitOrThrow(projectRoot, ["config", "user.email", "test@example.com"]);
    runGitOrThrow(projectRoot, ["config", "user.name", "Test User"]);
    const filePath = join(projectRoot, "tracked.txt");
    await writeFile(filePath, "initial\n", "utf8");
    runGitOrThrow(projectRoot, ["add", "tracked.txt"]);
    runGitOrThrow(projectRoot, ["commit", "-m", "initial"]);
    await writeFile(filePath, "changed\n", "utf8");

    const adapter = new GitAdapter();
    const checkpoint = await adapter.createCheckpoint({
      projectRoot,
      projectId: "project-1",
      projectName: "Repo",
      name: "Manual checkpoint",
      kind: "manual",
    });

    expect(checkpoint.canRestore).toBe(true);
    expect(checkpoint.patchBytes).toBeGreaterThan(0);
    expect(checkpoint.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "tracked.txt",
          status: "modified",
        }),
      ])
    );
    expect(await adapter.listCheckpoints({ projectRoot })).toEqual([
      expect.objectContaining({
        id: checkpoint.id,
        name: "Manual checkpoint",
      }),
    ]);

    const restored = await adapter.restoreCheckpoint({
      projectRoot,
      checkpointId: checkpoint.id,
    });

    expect((await readFile(filePath, "utf8")).replace(/\r\n/g, "\n")).toBe(
      "initial\n"
    );
    expect(restored.checkpoint.canRestore).toBe(false);
    expect(restored.safetyCheckpoint).toEqual(
      expect.objectContaining({ kind: "safety" })
    );
    expect(await adapter.listCheckpoints({ projectRoot })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: checkpoint.id,
          canRestore: false,
        }),
        expect.objectContaining({
          kind: "safety",
        }),
      ])
    );
  });

  test("captures hidden turn refs and diffs consecutive workspace snapshots", async () => {
    const projectRoot = await createTempProjectDir();
    runGitOrThrow(projectRoot, ["init"]);
    runGitOrThrow(projectRoot, ["config", "user.email", "test@example.com"]);
    runGitOrThrow(projectRoot, ["config", "user.name", "Test User"]);
    const trackedPath = join(projectRoot, "tracked.txt");
    await writeFile(trackedPath, "initial\n", "utf8");
    runGitOrThrow(projectRoot, ["add", "tracked.txt"]);
    runGitOrThrow(projectRoot, ["commit", "-m", "initial"]);
    const originalHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).stdout.trim();

    const adapter = new GitAdapter();
    const baseline = await adapter.captureTurnCheckpoint({
      projectRoot,
      sessionId: "chat-1",
      turnId: "turn-1",
      turnCount: 0,
      kind: "baseline",
    });
    await writeFile(trackedPath, "changed\n", "utf8");
    await writeFile(join(projectRoot, "created.txt"), "created\n", "utf8");
    const turn = await adapter.captureTurnCheckpoint({
      projectRoot,
      sessionId: "chat-1",
      turnId: "turn-1",
      turnCount: 1,
      kind: "turn",
    });

    expect(baseline.ref).toBe("refs/eragear/session-chat-1-turn-0");
    expect(turn.ref).toBe("refs/eragear/session-chat-1-turn-1");
    expect(
      spawnSync("git", ["rev-parse", turn.ref], {
        cwd: projectRoot,
        encoding: "utf8",
      }).stdout.trim()
    ).toBe(turn.commitSha);
    expect(
      await adapter.listTurnCheckpoints({ projectRoot, sessionId: "chat-1" })
    ).toEqual([
      expect.objectContaining({ turnCount: 0, kind: "baseline" }),
      expect.objectContaining({ turnCount: 1, kind: "turn", turnId: "turn-1" }),
    ]);
    expect(
      await adapter.diffTurnCheckpoints({
        projectRoot,
        fromRef: baseline.ref,
        toRef: turn.ref,
      })
    ).toEqual([
      {
        path: "created.txt",
        kind: "added",
        additions: 1,
        deletions: 0,
      },
      {
        path: "tracked.txt",
        kind: "modified",
        additions: 1,
        deletions: 1,
      },
    ]);
    expect(
      spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
      }).stdout.trim()
    ).toBe(originalHead);
  });

  test("captures a nested project while excluding its ignored Eragear data", async () => {
    const repositoryRoot = await createTempProjectDir();
    runGitOrThrow(repositoryRoot, ["init"]);
    runGitOrThrow(repositoryRoot, ["config", "user.email", "test@example.com"]);
    runGitOrThrow(repositoryRoot, ["config", "user.name", "Test User"]);
    const projectRoot = join(repositoryRoot, "lab");
    await mkdir(join(projectRoot, ".eragear"), { recursive: true });
    await writeFile(
      join(repositoryRoot, ".gitignore"),
      "lab/.eragear/\n",
      "utf8"
    );
    await writeFile(join(projectRoot, "tracked.txt"), "initial\n", "utf8");
    runGitOrThrow(repositoryRoot, ["add", ".gitignore", "lab/tracked.txt"]);
    runGitOrThrow(repositoryRoot, ["commit", "-m", "initial"]);
    await writeFile(join(projectRoot, "tracked.txt"), "changed\n", "utf8");
    await writeFile(
      join(projectRoot, ".eragear", "runtime-state.json"),
      "{}\n",
      "utf8"
    );

    const checkpoint = await new GitAdapter().captureTurnCheckpoint({
      projectRoot,
      sessionId: "nested-chat",
      turnId: "turn-1",
      turnCount: 1,
      kind: "turn",
    });
    const treePaths = spawnSync(
      "git",
      ["ls-tree", "-r", "--name-only", checkpoint.commitSha],
      { cwd: repositoryRoot, encoding: "utf8" }
    ).stdout.split(LINE_BREAK_REGEX);

    expect(treePaths).toContain("lab/tracked.txt");
    expect(treePaths).not.toContain("lab/.eragear/runtime-state.json");
  });

  test("restores a turn checkpoint with a safety ref and preserves Eragear data", async () => {
    const projectRoot = await createTempProjectDir();
    runGitOrThrow(projectRoot, ["init"]);
    runGitOrThrow(projectRoot, ["config", "user.email", "test@example.com"]);
    runGitOrThrow(projectRoot, ["config", "user.name", "Test User"]);
    const trackedPath = join(projectRoot, "tracked.txt");
    await writeFile(trackedPath, "initial\n", "utf8");
    runGitOrThrow(projectRoot, ["add", "tracked.txt"]);
    runGitOrThrow(projectRoot, ["commit", "-m", "initial"]);
    const originalHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).stdout.trim();

    const adapter = new GitAdapter();
    await adapter.captureTurnCheckpoint({
      projectRoot,
      sessionId: "chat-restore",
      turnCount: 0,
      kind: "baseline",
    });
    await writeFile(trackedPath, "checkpoint\n", "utf8");
    const target = await adapter.captureTurnCheckpoint({
      projectRoot,
      sessionId: "chat-restore",
      turnId: "turn-1",
      turnCount: 1,
      kind: "turn",
    });
    await writeFile(trackedPath, "later\n", "utf8");
    await writeFile(join(projectRoot, "later.txt"), "remove me\n", "utf8");
    await mkdir(join(projectRoot, ".eragear", "checkpoints"), {
      recursive: true,
    });
    const internalPath = join(
      projectRoot,
      ".eragear",
      "checkpoints",
      "keep.json"
    );
    await writeFile(internalPath, "{}\n", "utf8");

    const restored = await adapter.restoreTurnCheckpoint({
      projectRoot,
      targetRef: target.ref,
    });

    expect((await readFile(trackedPath, "utf8")).replaceAll("\r\n", "\n")).toBe(
      "checkpoint\n"
    );
    await expect(
      readFile(join(projectRoot, "later.txt"), "utf8")
    ).rejects.toThrow();
    expect(await readFile(internalPath, "utf8")).toBe("{}\n");
    expect(restored.restoredRef).toBe(target.ref);
    expect(
      spawnSync("git", ["rev-parse", restored.safetyRef], {
        cwd: projectRoot,
        encoding: "utf8",
      }).status
    ).toBe(0);
    expect(
      spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
      }).stdout.trim()
    ).toBe(originalHead);
  });

  test("getProjectContext returns filesystem snapshot and excludes .git internals", async () => {
    const projectRoot = await createTempProjectDir();
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, ".config"), { recursive: true });
    await mkdir(join(projectRoot, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "index.ts"),
      "export {};\n",
      "utf8"
    );
    await writeFile(join(projectRoot, ".env"), "A=1\n", "utf8");
    await writeFile(join(projectRoot, ".config", "rules.mdc"), "rule", "utf8");
    await writeFile(
      join(projectRoot, "node_modules", "pkg", "index.js"),
      "module.exports = {};\n",
      "utf8"
    );
    await writeFile(join(projectRoot, ".git", "config"), "[core]\n", "utf8");

    const adapter = new GitAdapter();
    const context = await adapter.getProjectContext(projectRoot);

    expect(context.files).toEqual([
      ".config/rules.mdc",
      ".env",
      "node_modules/pkg/index.js",
      "src/index.ts",
    ]);
    expect(context.projectRules).toEqual([
      {
        path: ".config/rules.mdc",
        location: ".config",
      },
    ]);
    expect(context.activeTabs).toEqual([]);
  });

  test("getDiff handles untracked file names without shell interpolation", async () => {
    const projectRoot = await createTempProjectDir();
    runGitOrThrow(projectRoot, ["init"]);
    const untrackedName = "$(echo injected).txt";
    await writeFile(join(projectRoot, untrackedName), "hello\n", "utf8");

    const adapter = new GitAdapter();
    const patch = await adapter.getDiff(projectRoot);

    expect(patch).toContain(`b/${untrackedName}`);
    expect(patch).toContain("+hello");
  });

  test("readFileWithinRoot rejects absolute and traversal paths", async () => {
    const projectRoot = await createTempProjectDir();
    const adapter = new GitAdapter();
    await writeFile(join(projectRoot, "ok.txt"), "safe", "utf8");

    await expect(
      adapter.readFileWithinRoot(projectRoot, "../outside.txt")
    ).rejects.toThrow("Access denied");
    await expect(
      adapter.readFileWithinRoot(projectRoot, join(projectRoot, "ok.txt"))
    ).rejects.toThrow("Access denied");
  });

  test("readFileWithinRoot reads files inside project root", async () => {
    const projectRoot = await createTempProjectDir();
    const adapter = new GitAdapter();
    await writeFile(join(projectRoot, "inside.txt"), "hello", "utf8");

    await expect(
      adapter.readFileWithinRoot(projectRoot, "inside.txt")
    ).resolves.toBe("hello");
  });
});
