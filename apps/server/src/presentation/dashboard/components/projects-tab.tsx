import type { ProjectSummary } from "@/presentation/dashboard/dashboard-data";
import { ProjectCard } from "./project-card";
import { TabPanel } from "./tab-panel";

interface ProjectsTabProps {
  projects: ProjectSummary[];
  activeTab: string;
}

export function ProjectsTab({ projects, activeTab }: ProjectsTabProps) {
  return (
    <TabPanel activeTab={activeTab} tab="projects">
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-black font-display text-4xl tracking-tight">
                Projects
              </h2>
              <p className="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Registered workspaces with session statistics and quick access
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-xs">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
              <a className="btn btn-primary min-h-[44px]" href="#add-project-modal">
                + Add Project
              </a>
            </div>
          </div>
        </div>

        <div className="grid max-h-[calc(100dvh-480px)] min-h-[200px] gap-0 overflow-y-auto md:grid-cols-2">
          {projects.length === 0 ? (
            <div className="empty-state">No projects registered yet.</div>
          ) : (
            projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))
          )}
        </div>
      </section>
    </TabPanel>
  );
}
