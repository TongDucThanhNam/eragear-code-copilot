import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "#runtime/shared/errors";
import type { Project } from "#runtime/shared/types/project.types";
import type {
  ManageProjectSkillInput,
  SkillDescriptor,
  SkillsCatalogSnapshot,
  SkillsProjectInput,
} from "../application/contracts/skills.contract";
import type { SkillsPort } from "../application/ports/skills.port";

const MODULE = "skills";
const GLOBAL_SKILLS_HOME_DIRECTORY = "AGENTS";
const LIBRARY_DIRECTORY = "skills";
const INSTALL_MARKER = ".eragear-skill-install.json";
const MAX_LIBRARY_SKILLS = 500;
const MAX_DESCRIPTOR_BYTES = 512 * 1024;
const QUOTED_VALUE_EDGE_PATTERN = /^["']|["']$/g;
const WINDOWS_NEWLINE_PATTERN = /\r\n/g;
const MARKDOWN_LINE_PATTERN = /\r?\n/;
const MARKDOWN_TITLE_PATTERN = /^#\s+/;

const InstallMarkerSchema = z
  .object({
    version: z.literal(1),
    skillId: z.string().min(1),
    folderName: z.string().min(1),
    skillName: z.string().min(1),
    installedHash: z.string().regex(/^[a-f0-9]{64}$/),
    installedAt: z.string().datetime(),
  })
  .strict();

type InstallMarker = z.infer<typeof InstallMarkerSchema>;

interface GlobalSkillRecord {
  descriptor: SkillDescriptor;
  sourceDirectory: string;
}

interface LibraryDiscovery {
  exists: boolean;
  records: GlobalSkillRecord[];
  diagnostics: string[];
}

interface ProjectContext {
  project: Project | null;
  projectPath: string | null;
}

interface TargetInspection {
  kind: "available" | "installed" | "conflict";
  marker: InstallMarker | null;
}

export class FilesystemSkillsAdapter implements SkillsPort {
  private readonly projectRepo: ProjectRepositoryPort;
  private readonly resolveHomePath: () => string;

  constructor(deps: {
    projectRepo: ProjectRepositoryPort;
    resolveHomePath?: () => string;
  }) {
    this.projectRepo = deps.projectRepo;
    this.resolveHomePath = deps.resolveHomePath ?? os.homedir;
  }

  async listSkills(
    userId: string,
    input?: SkillsProjectInput
  ): Promise<SkillsCatalogSnapshot> {
    const context = await this.resolveProjectContext(userId, input?.projectId);
    return await this.createSnapshot(context);
  }

  async addSkillToProject(
    userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsCatalogSnapshot> {
    const context = await this.requireProjectContext(userId, input.projectId);
    await ensureProjectDirectory(context.projectPath);

    const libraryPath = this.libraryPath();
    const library = await discoverLibrary(libraryPath);
    const record = library.records.find(
      (item) => item.descriptor.id === input.skillId
    );
    if (!record) {
      throw new NotFoundError("Global skill was not found in ~/AGENTS/skills", {
        module: MODULE,
        op: "add-to-project",
        details: { skillId: input.skillId },
      });
    }

    if (await pathExists(path.join(record.sourceDirectory, INSTALL_MARKER))) {
      throw new ValidationError(
        `Global skill contains reserved file ${INSTALL_MARKER}`,
        {
          module: MODULE,
          op: "add-to-project",
          details: { skillId: input.skillId },
        }
      );
    }

    await validateInstallSource(record.sourceDirectory);
    const safeInstallRoot = await resolveProjectSkillsRoot(
      context.projectPath,
      true
    );
    if (!safeInstallRoot) {
      throw new ValidationError(
        "Project skills directory could not be created",
        {
          module: MODULE,
          op: "add-to-project",
        }
      );
    }
    const safeTarget = safeSkillTarget(
      safeInstallRoot,
      record.descriptor.folderName
    );
    const currentInspection = await inspectTarget(
      safeTarget,
      record.descriptor.id
    );
    if (currentInspection.kind === "installed") {
      return await this.createSnapshot(context);
    }
    if (currentInspection.kind === "conflict") {
      throw new ConflictError(
        `Project skill folder already exists: ${record.descriptor.folderName}`,
        {
          module: MODULE,
          op: "add-to-project",
          details: { skillId: input.skillId, target: safeTarget },
        }
      );
    }

    const temporaryTarget = safeSkillTarget(
      safeInstallRoot,
      `.eragear-install-${randomUUID()}`
    );
    try {
      await cp(record.sourceDirectory, temporaryTarget, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const installedHash = await hashSkillDirectory(temporaryTarget);
      const marker: InstallMarker = {
        version: 1,
        skillId: record.descriptor.id,
        folderName: record.descriptor.folderName,
        skillName: record.descriptor.name,
        installedHash,
        installedAt: new Date().toISOString(),
      };
      await writeFile(
        path.join(temporaryTarget, INSTALL_MARKER),
        `${JSON.stringify(marker, null, 2)}\n`,
        "utf8"
      );
      await rename(temporaryTarget, safeTarget);
    } catch (error) {
      if (
        isNodeErrorCode(error, "EEXIST") ||
        isNodeErrorCode(error, "ENOTEMPTY")
      ) {
        throw new ConflictError(
          `Project skill folder already exists: ${record.descriptor.folderName}`,
          {
            module: MODULE,
            op: "add-to-project",
            details: { skillId: input.skillId, target: safeTarget },
            cause: error,
          }
        );
      }
      throw error;
    } finally {
      await rm(temporaryTarget, { recursive: true, force: true }).catch(
        () => undefined
      );
    }

    return await this.createSnapshot(context);
  }

  async removeSkillFromProject(
    userId: string,
    input: ManageProjectSkillInput
  ): Promise<SkillsCatalogSnapshot> {
    const context = await this.requireProjectContext(userId, input.projectId);
    await ensureProjectDirectory(context.projectPath);
    const installRoot = await resolveProjectSkillsRoot(
      context.projectPath,
      false
    );
    if (!installRoot) {
      throw new NotFoundError(
        "Managed project skill installation was not found",
        {
          module: MODULE,
          op: "remove-from-project",
          details: { skillId: input.skillId },
        }
      );
    }
    const target = await findManagedTarget(installRoot, input.skillId);
    if (!target) {
      throw new NotFoundError(
        "Managed project skill installation was not found",
        {
          module: MODULE,
          op: "remove-from-project",
          details: { skillId: input.skillId },
        }
      );
    }

    ensureDirectChild(installRoot, target);
    const targetStats = await lstat(target).catch(() => null);
    if (!(targetStats?.isDirectory() && !targetStats.isSymbolicLink())) {
      throw new ConflictError("Managed skill target is no longer a directory", {
        module: MODULE,
        op: "remove-from-project",
        details: { skillId: input.skillId, target },
      });
    }
    const marker = await readInstallMarker(target);
    if (marker?.skillId !== input.skillId) {
      throw new ConflictError("Project skill ownership marker does not match", {
        module: MODULE,
        op: "remove-from-project",
        details: { skillId: input.skillId, target },
      });
    }

    const currentHash = await hashSkillDirectory(target);
    if (currentHash !== marker.installedHash) {
      throw new ConflictError(
        "Project skill changed after installation; refusing to delete local edits",
        {
          module: MODULE,
          op: "remove-from-project",
          details: { skillId: input.skillId, target },
        }
      );
    }

    await rm(target, { recursive: true, force: false });
    return await this.createSnapshot(context);
  }

  private libraryPath(): string {
    return path.resolve(
      this.resolveHomePath(),
      GLOBAL_SKILLS_HOME_DIRECTORY,
      LIBRARY_DIRECTORY
    );
  }

  private async createSnapshot(
    context: ProjectContext
  ): Promise<SkillsCatalogSnapshot> {
    const libraryPath = this.libraryPath();
    const library = await discoverLibrary(libraryPath);
    const diagnostics = [...library.diagnostics];
    let installRoot: string | null = null;
    if (context.projectPath) {
      try {
        installRoot = await resolveProjectSkillsRoot(
          context.projectPath,
          false
        );
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
        diagnostics.push(error.message);
      }
    }
    const descriptors = await Promise.all(
      library.records.map(async (record) => {
        if (!installRoot) {
          return record.descriptor;
        }
        const target = safeSkillTarget(
          installRoot,
          record.descriptor.folderName
        );
        const inspection = await inspectTarget(target, record.descriptor.id);
        if (inspection.kind === "available") {
          return record.descriptor;
        }
        if (inspection.kind === "installed") {
          return {
            ...record.descriptor,
            installedPath: target,
            status: "installed" as const,
          };
        }
        return {
          ...record.descriptor,
          installedPath: target,
          status: "conflict" as const,
          diagnostics: [
            ...record.descriptor.diagnostics,
            "A project skill folder with this name already exists and is not managed by the Global Skills library.",
          ],
        };
      })
    );

    const knownIds = new Set(descriptors.map((skill) => skill.id));
    const missingSources = installRoot
      ? await discoverMissingSourceInstallations(
          installRoot,
          knownIds,
          libraryPath
        )
      : [];
    if (!library.exists) {
      diagnostics.push(
        `Global Skills library does not exist yet: ${libraryPath}`
      );
    }

    return {
      libraryPath,
      libraryExists: library.exists,
      projectId: context.project?.id ?? null,
      projectPath: context.projectPath,
      skills: [...descriptors, ...missingSources].sort((left, right) =>
        left.name.localeCompare(right.name)
      ),
      diagnostics,
    };
  }

  private async resolveProjectContext(
    userId: string,
    projectId?: string
  ): Promise<ProjectContext> {
    const state = await this.projectRepo.listWithActiveState(userId);
    const targetProjectId = projectId ?? state.activeProjectId;
    if (!targetProjectId) {
      return { project: null, projectPath: null };
    }
    const project = state.projects.find((item) => item.id === targetProjectId);
    if (!project) {
      throw new NotFoundError("Project not found for Skills library", {
        module: MODULE,
        op: "resolve-project",
        details: { projectId: targetProjectId },
      });
    }
    return { project, projectPath: path.resolve(project.path) };
  }

  private async requireProjectContext(
    userId: string,
    projectId: string
  ): Promise<{ project: Project; projectPath: string }> {
    const context = await this.resolveProjectContext(userId, projectId);
    if (!(context.project && context.projectPath)) {
      throw new NotFoundError("Project not found for Skills library", {
        module: MODULE,
        op: "resolve-project",
        details: { projectId },
      });
    }
    return { project: context.project, projectPath: context.projectPath };
  }
}

async function discoverLibrary(libraryPath: string): Promise<LibraryDiscovery> {
  let entries: Dirent[];
  try {
    entries = await readdir(libraryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { exists: false, records: [], diagnostics: [] };
    }
    throw error;
  }

  const records: GlobalSkillRecord[] = [];
  const diagnostics: string[] = [];
  const directoryEntries = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));
  const candidates = directoryEntries.slice(0, MAX_LIBRARY_SKILLS);

  if (candidates.length < directoryEntries.length) {
    diagnostics.push(
      `Global Skills discovery is limited to ${MAX_LIBRARY_SKILLS} directories.`
    );
  }

  for (const entry of candidates) {
    const logicalDirectory = path.join(libraryPath, entry.name);
    let sourceDirectory: string;
    try {
      sourceDirectory = await realpath(logicalDirectory);
      const sourceStats = await stat(sourceDirectory);
      if (!sourceStats.isDirectory()) {
        continue;
      }
    } catch {
      diagnostics.push(`Skipped unreadable skill directory: ${entry.name}`);
      continue;
    }

    const logicalSkillPath = path.join(logicalDirectory, "SKILL.md");
    const sourceSkillPath = path.join(sourceDirectory, "SKILL.md");
    const skillStats = await stat(sourceSkillPath).catch(() => null);
    if (!skillStats?.isFile()) {
      continue;
    }
    records.push(
      await readGlobalSkill({
        folderName: entry.name,
        logicalSkillPath,
        sourceDirectory,
        sourceSkillPath,
        size: skillStats.size,
      })
    );
  }

  return { exists: true, records, diagnostics };
}

async function readGlobalSkill(params: {
  folderName: string;
  logicalSkillPath: string;
  sourceDirectory: string;
  sourceSkillPath: string;
  size: number;
}): Promise<GlobalSkillRecord> {
  const diagnostics: string[] = [];
  let raw = "";
  if (params.size > MAX_DESCRIPTOR_BYTES) {
    diagnostics.push(
      `SKILL.md is larger than ${MAX_DESCRIPTOR_BYTES} bytes; metadata was not parsed.`
    );
  } else {
    try {
      raw = await readFile(params.sourceSkillPath, "utf8");
    } catch {
      diagnostics.push("SKILL.md could not be read; folder metadata is shown.");
    }
  }
  const parsed = parseFrontmatter(raw);
  const name =
    firstString(parsed.attributes, ["name", "title", "skill"]) ??
    titleFromMarkdown(parsed.body) ??
    params.folderName;
  const description =
    firstString(parsed.attributes, ["description", "summary"]) ??
    descriptionFromMarkdown(parsed.body);

  return {
    sourceDirectory: params.sourceDirectory,
    descriptor: {
      id: skillId(params.folderName),
      folderName: params.folderName,
      name,
      ...(description ? { description } : {}),
      sourcePath: params.logicalSkillPath,
      status: "available",
      tags: [...attributeTags(parsed.attributes), "global-library"],
      diagnostics,
    },
  };
}

async function inspectTarget(
  target: string,
  expectedSkillId: string
): Promise<TargetInspection> {
  const targetStats = await lstat(target).catch((error) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (!targetStats) {
    return { kind: "available", marker: null };
  }
  if (!(targetStats.isDirectory() && !targetStats.isSymbolicLink())) {
    return { kind: "conflict", marker: null };
  }
  const marker = await readInstallMarker(target);
  return marker?.skillId === expectedSkillId
    ? { kind: "installed", marker }
    : { kind: "conflict", marker };
}

async function discoverMissingSourceInstallations(
  installRoot: string,
  knownIds: Set<string>,
  libraryPath: string
): Promise<SkillDescriptor[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(installRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const descriptors: SkillDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const target = safeSkillTarget(installRoot, entry.name);
    const marker = await readInstallMarker(target);
    if (!(marker && marker.folderName === entry.name)) {
      continue;
    }
    if (knownIds.has(marker.skillId)) {
      continue;
    }
    descriptors.push({
      id: marker.skillId,
      folderName: marker.folderName,
      name: marker.skillName,
      description: "The global source is no longer present in ~/AGENTS/skills.",
      sourcePath: path.join(libraryPath, marker.folderName, "SKILL.md"),
      installedPath: target,
      status: "missing-source",
      tags: ["global-library", "project"],
      diagnostics: [
        "This managed project installation can be removed, but its global source is missing.",
      ],
    });
  }
  return descriptors;
}

async function findManagedTarget(
  installRoot: string,
  skillIdToFind: string
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(installRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const target = safeSkillTarget(installRoot, entry.name);
    const marker = await readInstallMarker(target);
    if (marker?.skillId === skillIdToFind && marker.folderName === entry.name) {
      return target;
    }
  }
  return null;
}

async function readInstallMarker(
  targetDirectory: string
): Promise<InstallMarker | null> {
  try {
    const raw = await readFile(
      path.join(targetDirectory, INSTALL_MARKER),
      "utf8"
    );
    const parsed = InstallMarkerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function hashSkillDirectory(rootPath: string): Promise<string> {
  const hash = createHash("sha256");

  async function visit(directory: string, relativeDirectory: string) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const relative = path.posix.join(
        relativeDirectory,
        entry.name.replaceAll("\\", "/")
      );
      if (relative === INSTALL_MARKER) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        hash.update(`directory\0${relative}\0`);
        await visit(absolute, relative);
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relative}\0${await readlink(absolute)}\0`);
      } else if (entry.isFile()) {
        hash.update(`file\0${relative}\0`);
        hash.update(await readFile(absolute));
        hash.update("\0");
      } else {
        throw new ValidationError(`Unsupported entry in skill: ${relative}`, {
          module: MODULE,
          op: "hash-installation",
        });
      }
    }
  }

  await visit(rootPath, "");
  return hash.digest("hex");
}

async function validateInstallSource(rootPath: string): Promise<void> {
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ValidationError(
          `Global skill contains a symbolic link: ${path.relative(
            rootPath,
            absolute
          )}`,
          {
            module: MODULE,
            op: "validate-install-source",
          }
        );
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (!entry.isFile()) {
        throw new ValidationError(
          `Global skill contains an unsupported entry: ${path.relative(
            rootPath,
            absolute
          )}`,
          {
            module: MODULE,
            op: "validate-install-source",
          }
        );
      }
    }
  }

  await visit(rootPath);
}

async function resolveProjectSkillsRoot(
  projectPath: string,
  create: boolean
): Promise<string | null> {
  const canonicalProjectPath = await realpath(projectPath);
  const agentsPath = path.join(projectPath, ".agents");
  if (!(await ensureSafeDirectoryComponent(agentsPath, create))) {
    return null;
  }
  const skillsPath = path.join(agentsPath, "skills");
  if (!(await ensureSafeDirectoryComponent(skillsPath, create))) {
    return null;
  }
  const canonicalSkillsPath = await realpath(skillsPath);
  const relative = path.relative(canonicalProjectPath, canonicalSkillsPath);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ValidationError(
      "Project skills directory resolves outside the project root",
      {
        module: MODULE,
        op: "resolve-project-skills",
        details: { projectPath, skillsPath },
      }
    );
  }
  return path.resolve(skillsPath);
}

async function ensureSafeDirectoryComponent(
  directory: string,
  create: boolean
): Promise<boolean> {
  let directoryStats = await lstat(directory).catch((error) => {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (!directoryStats && create) {
    await mkdir(directory);
    directoryStats = await lstat(directory);
  }
  if (!directoryStats) {
    return false;
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new ValidationError(
      `Unsafe project skills path component: ${directory}`,
      {
        module: MODULE,
        op: "resolve-project-skills",
        details: { directory },
      }
    );
  }
  return true;
}

function safeSkillTarget(installRoot: string, folderName: string): string {
  const target = path.resolve(installRoot, folderName);
  ensureDirectChild(installRoot, target);
  return target;
}

function ensureDirectChild(installRoot: string, target: string): void {
  if (path.dirname(path.resolve(target)) !== path.resolve(installRoot)) {
    throw new ValidationError(
      "Skill target escapes the project skills directory",
      {
        module: MODULE,
        op: "resolve-target",
        details: { installRoot, target },
      }
    );
  }
}

async function ensureProjectDirectory(projectPath: string): Promise<void> {
  const projectStats = await stat(projectPath).catch(() => null);
  if (!projectStats?.isDirectory()) {
    throw new ValidationError("Project path is not an existing directory", {
      module: MODULE,
      op: "resolve-project",
      details: { projectPath },
    });
  }
}

function skillId(folderName: string): string {
  const digest = createHash("sha256").update(folderName).digest("hex");
  return `global-skill.${digest.slice(0, 24)}`;
}

type FrontmatterValue = string | string[] | boolean;

interface FrontmatterResult {
  attributes: Record<string, FrontmatterValue>;
  body: string;
}

function parseScalar(value: string): FrontmatterValue {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(QUOTED_VALUE_EDGE_PATTERN, ""))
      .filter(Boolean);
  }
  return trimmed.replace(QUOTED_VALUE_EDGE_PATTERN, "");
}

function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith("---")) {
    return { attributes: {}, body: raw };
  }
  const normalized = raw.replace(WINDOWS_NEWLINE_PATTERN, "\n");
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { attributes: {}, body: raw };
  }
  const header = normalized.slice(3, endIndex).trim();
  const body = normalized.slice(endIndex + 4).trimStart();
  const attributes: Record<string, FrontmatterValue> = {};
  for (const line of header.split("\n").slice(0, 80)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (key) {
      attributes[key] = parseScalar(line.slice(separator + 1));
    }
  }
  return { attributes, body };
}

function firstString(
  attributes: Record<string, FrontmatterValue>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function attributeTags(attributes: Record<string, FrontmatterValue>): string[] {
  const tags = attributes.tags;
  if (Array.isArray(tags)) {
    return tags.filter((item) => item.trim().length > 0);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function titleFromMarkdown(body: string): string | undefined {
  return body
    .split(MARKDOWN_LINE_PATTERN)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "))
    ?.replace(MARKDOWN_TITLE_PATTERN, "")
    .trim();
}

function descriptionFromMarkdown(body: string): string | undefined {
  return body
    .split(MARKDOWN_LINE_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"))
    .find(Boolean)
    ?.slice(0, 220);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code) === code
  );
}
