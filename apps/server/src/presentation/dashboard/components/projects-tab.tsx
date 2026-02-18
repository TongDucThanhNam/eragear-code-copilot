import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";
import { ProjectCard } from "./project-card";
import { TabPanel } from "./tab-panel";

export function ProjectsTab() {
  const {
    activeTab,
    dashboardData: { projects },
  } = useDashboardState();

  return (
    <TabPanel activeTab={activeTab} tab="projects">
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-black font-display text-4xl tracking-tight">
                Projects
              </h2>
              <div className="mt-4 max-w-md text-justify font-body text-muted text-sm leading-relaxed">
                <span className="float-left mt-1 mr-2 font-black font-display text-5xl text-ink leading-[0.8]">
                  R
                </span>
                egistered workspaces with session statistics and quick access.
                Each project represents a distinct context where your AI agents
                operate, providing a secure and organized environment for your
                development workflows and data management.
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-xs">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
              <a
                className="btn btn-primary min-h-[44px]"
                href="#add-project-modal"
              >
                + Add Project
              </a>
            </div>
          </div>
        </div>

        <div className="grid max-h-[calc(100dvh-480px)] min-h-[200px] gap-0 overflow-y-auto md:grid-cols-2">
          {projects.length === 0 ? (
            <div className="empty-state stagger-item col-span-full">
              No projects registered yet.
            </div>
          ) : (
            projects.map((project) => (
              <div
                className="stagger-item border-ink border-r border-b last:border-b-0 even:border-r-0"
                key={project.id}
              >
                <ProjectCard project={project} />
              </div>
            ))
          )}
        </div>
      </section>
    </TabPanel>
  );
}
