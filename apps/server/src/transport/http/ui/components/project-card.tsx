import type { ProjectSummary } from "@/transport/http/ui/dashboard-data";
import { formatTimeAgo } from "../utils";

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <div class="card project-card">
      <div class="mb-2 flex items-center justify-between">
        <span class="project-name">{project.name}</span>
        <span
          class={`badge ${project.runningCount > 0 ? "badge-success" : ""}`}
        >
          {project.runningCount} running
        </span>
      </div>
      <p class="project-path">{project.path}</p>
      <div class="mt-3 flex items-center justify-between">
        <span class="text-muted text-xs">
          {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
        </span>
        <span class="text-muted text-xs">
          {project.lastOpenedAt ? formatTimeAgo(project.lastOpenedAt) : "Never"}
        </span>
      </div>
    </div>
  );
}
