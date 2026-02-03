import type { ProjectSummary } from "@/transport/http/ui/dashboard-data";
import { formatTimeAgo } from "../utils";

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <div className="card project-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="project-name">{project.name}</span>
        <span
          className={`badge ${project.runningCount > 0 ? "badge-success" : ""}`}
        >
          {project.runningCount} running
        </span>
      </div>
      <p className="project-path">{project.path}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-muted text-xs">
          {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
        </span>
        <span className="text-muted text-xs">
          {project.lastOpenedAt ? formatTimeAgo(project.lastOpenedAt) : "Never"}
        </span>
      </div>
    </div>
  );
}
