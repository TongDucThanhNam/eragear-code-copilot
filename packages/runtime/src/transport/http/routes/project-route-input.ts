import {
  type CreateProjectInput,
  CreateProjectInputSchema,
} from "#runtime/modules/project";

export type ProjectRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: string };

interface ProjectRoutePayload {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is ProjectRoutePayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.every((item) => typeof item === "string")) {
    return value;
  }
  return [];
}

function firstSchemaError(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues[0]?.message ?? "Invalid project payload";
}

export function parseCreateProjectRouteInput(
  payload: unknown
): ProjectRouteInputResult<CreateProjectInput> {
  if (
    !(
      isRecord(payload) &&
      typeof payload.name === "string" &&
      payload.name.length > 0 &&
      typeof payload.path === "string" &&
      payload.path.length > 0
    )
  ) {
    return { ok: false, error: "name and path are required" };
  }

  const parsed = CreateProjectInputSchema.safeParse({
    name: payload.name,
    path: payload.path,
    description:
      typeof payload.description === "string"
        ? payload.description || null
        : null,
    tags: optionalStringArray(payload.tags),
    obsidianProjectPath:
      typeof payload.obsidianProjectPath === "string"
        ? payload.obsidianProjectPath
        : null,
    techStackTags: optionalStringArray(payload.techStackTags),
    favorite: false,
  });
  if (!parsed.success) {
    return { ok: false, error: firstSchemaError(parsed.error) };
  }
  return { ok: true, input: parsed.data };
}

export function parseDeleteProjectRouteInput(
  payload: unknown
): ProjectRouteInputResult<{ projectId: string }> {
  if (!isRecord(payload) || typeof payload.projectId !== "string") {
    return { ok: false, error: "projectId is required" };
  }
  if (payload.projectId.length === 0) {
    return { ok: false, error: "projectId is required" };
  }
  return { ok: true, input: { projectId: payload.projectId } };
}
