export interface AcpSessionModes {
  currentModeId: string;
  availableModes: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
}

export function resolveSafeSessionModeId(
  executionMode: "read_only" | "write",
  modes: AcpSessionModes | undefined,
  owner: "manager" | "worker"
): string | null {
  if (!modes) {
    if (owner === "manager") {
      throw new Error(
        "ACP manager did not advertise session modes; refusing to run it in the default builder role"
      );
    }
    return null;
  }
  const candidates =
    owner === "manager" ? ["manager"] : ["builder", "build", "code", "default"];
  const selected = candidates
    .map((candidate) =>
      modes.availableModes.find(
        (mode) =>
          mode.id.trim().toLowerCase() === candidate ||
          mode.name.trim().toLowerCase() === candidate
      )
    )
    .find((mode) => mode !== undefined);
  if (selected) {
    return selected.id === modes.currentModeId ? null : selected.id;
  }
  throw new Error(
    `No configured ${owner} role is available for ${executionMode} execution; expected one of ${candidates.join(", ")}`
  );
}
