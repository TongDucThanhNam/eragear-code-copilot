import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { ProjectRepositoryPort } from "@/modules/project";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import type {
  ResizeTerminalInput,
  TerminalEvent,
  TerminalRecord,
  TerminalSettings,
  UpdateTerminalSettingsInput,
} from "./contracts/terminal.contract";
import type {
  TerminalRuntimeCreateInput,
  TerminalRuntimePort,
} from "./ports/terminal-runtime.port";
import type { TerminalSettingsRepositoryPort } from "./ports/terminal-settings-repository.port";
import { TerminalService } from "./terminal.service";

class ProjectRepositoryStub implements ProjectRepositoryPort {
  project: Project = {
    id: "project-1",
    userId: "user-1",
    name: "Project",
    path: path.resolve("C:/repo/project"),
    description: null,
    tags: [],
    obsidianProjectPath: null,
    techStackTags: [],
    favorite: false,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
  };

  findById(id: string, userId: string): Promise<Project | undefined> {
    return Promise.resolve(
      id === this.project.id && userId === this.project.userId
        ? this.project
        : undefined
    );
  }

  findByPath(_path: string): Promise<Project | undefined> {
    return Promise.resolve(undefined);
  }

  findAll(_userId: string): Promise<Project[]> {
    return Promise.resolve([this.project]);
  }

  getActiveId(_userId: string): Promise<string | null> {
    return Promise.resolve(this.project.id);
  }

  create(_input: ProjectInput): Promise<Project> {
    return Promise.resolve(this.project);
  }

  update(_input: ProjectUpdateInput): Promise<Project> {
    return Promise.resolve(this.project);
  }

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.resolve();
  }

  setActive(_id: string | null, _userId: string): Promise<void> {
    return Promise.resolve();
  }
}

class TerminalRuntimeStub implements TerminalRuntimePort {
  createInput: TerminalRuntimeCreateInput | null = null;
  record: TerminalRecord = {
    id: "terminal-1",
    userId: "user-1",
    projectId: "project-1",
    cwd: path.resolve("C:/repo/project"),
    command: "shell",
    args: [],
    cols: 80,
    rows: 24,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
  };

  list(_userId: string): Promise<TerminalRecord[]> {
    return Promise.resolve([this.record]);
  }

  create(input: TerminalRuntimeCreateInput): Promise<TerminalRecord> {
    this.createInput = input;
    return Promise.resolve({ ...this.record, cwd: input.cwd });
  }

  write(
    _userId: string,
    _terminalId: string,
    _data: string
  ): Promise<TerminalRecord> {
    return Promise.resolve(this.record);
  }

  kill(_userId: string, _terminalId: string): Promise<TerminalRecord> {
    return Promise.resolve({ ...this.record, status: "exited" });
  }

  resize(
    _userId: string,
    _terminalId: string,
    cols: number,
    rows: number
  ): Promise<TerminalRecord> {
    this.record = { ...this.record, cols, rows };
    return Promise.resolve(this.record);
  }

  subscribe(
    _userId: string,
    _terminalId: string,
    _listener: (event: TerminalEvent) => void
  ): () => void {
    return () => undefined;
  }
}

class TerminalSettingsRepositoryStub implements TerminalSettingsRepositoryPort {
  settings: TerminalSettings = {
    inheritSystemProfile: true,
    shellCommand: "",
    shellArgs: [],
  };
  updateInput: UpdateTerminalSettingsInput | undefined;

  getSettings(_userId: string): Promise<TerminalSettings> {
    return Promise.resolve(this.settings);
  }

  updateSettings(
    _userId: string,
    input?: UpdateTerminalSettingsInput
  ): Promise<TerminalSettings> {
    this.updateInput = input;
    this.settings = { ...this.settings, ...(input ?? {}) };
    return Promise.resolve(this.settings);
  }
}

describe("TerminalService", () => {
  test("creates a terminal in the active project cwd", async () => {
    const runtime = new TerminalRuntimeStub();
    const settingsRepo = new TerminalSettingsRepositoryStub();
    const projectRepo = new ProjectRepositoryStub();
    const service = new TerminalService({
      runtime,
      settingsRepo,
      projectRepo,
    });

    const terminal = await service.create("user-1", { cwd: "packages/web" });

    expect(terminal.cwd).toBe(
      path.resolve(projectRepo.project.path, "packages/web")
    );
    expect(runtime.createInput?.projectId).toBe("project-1");
    expect(runtime.createInput?.settings.inheritSystemProfile).toBe(true);
    expect(runtime.createInput?.cols).toBe(80);
    expect(runtime.createInput?.rows).toBe(24);
  });

  test("passes requested terminal dimensions to runtime", async () => {
    const runtime = new TerminalRuntimeStub();
    const service = new TerminalService({
      runtime,
      settingsRepo: new TerminalSettingsRepositoryStub(),
      projectRepo: new ProjectRepositoryStub(),
    });

    await service.create("user-1", { cols: 120, rows: 40 });

    expect(runtime.createInput?.cols).toBe(120);
    expect(runtime.createInput?.rows).toBe(40);
  });

  test("resizes a terminal through the runtime", async () => {
    const runtime = new TerminalRuntimeStub();
    const service = new TerminalService({
      runtime,
      settingsRepo: new TerminalSettingsRepositoryStub(),
      projectRepo: new ProjectRepositoryStub(),
    });

    const input: ResizeTerminalInput = {
      terminalId: "terminal-1",
      cols: 100,
      rows: 32,
    };
    const terminal = await service.resize("user-1", input);

    expect(terminal.cols).toBe(100);
    expect(terminal.rows).toBe(32);
  });

  test("rejects cwd outside project root", async () => {
    const service = new TerminalService({
      runtime: new TerminalRuntimeStub(),
      settingsRepo: new TerminalSettingsRepositoryStub(),
      projectRepo: new ProjectRepositoryStub(),
    });

    await expect(
      service.create("user-1", { cwd: "../outside" })
    ).rejects.toMatchObject({ name: "ValidationError" });
  });

  test("normalizes terminal settings updates", async () => {
    const settingsRepo = new TerminalSettingsRepositoryStub();
    const service = new TerminalService({
      runtime: new TerminalRuntimeStub(),
      settingsRepo,
      projectRepo: new ProjectRepositoryStub(),
    });

    await service.updateSettings("user-1", {
      shellCommand: "  powershell.exe  ",
      shellArgs: [" -NoLogo ", "", " -NoProfile "],
      inheritSystemProfile: false,
    });

    expect(settingsRepo.updateInput).toEqual({
      shellCommand: "powershell.exe",
      shellArgs: ["-NoLogo", "-NoProfile"],
      inheritSystemProfile: false,
    });
  });
});
