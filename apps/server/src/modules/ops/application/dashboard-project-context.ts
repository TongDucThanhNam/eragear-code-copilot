export interface DashboardProjectContextProject {
  id: string;
  name?: string;
  path: string;
}

export interface DashboardSessionProjectReference {
  projectId?: string | null;
  projectRoot: string;
}

/**
 * Indexes dashboard projects for session association.
 *
 * Invariant: a stored projectId wins when present; projectRoot is only a
 * fallback for older sessions that do not have projectId metadata.
 */
export class DashboardProjectContext {
  private readonly projectsById: Map<string, DashboardProjectContextProject>;
  private readonly projectsByPath: Map<string, DashboardProjectContextProject>;

  constructor(projects: DashboardProjectContextProject[]) {
    this.projectsById = new Map(
      projects.map((project) => [project.id, project])
    );
    this.projectsByPath = new Map(
      projects.map((project) => [project.path, project])
    );
  }

  projectIds(): string[] {
    return [...this.projectsById.keys()];
  }

  resolveSessionProject(
    session: DashboardSessionProjectReference
  ): DashboardProjectContextProject | undefined {
    if (session.projectId) {
      return this.projectsById.get(session.projectId);
    }
    return this.projectsByPath.get(session.projectRoot);
  }
}
