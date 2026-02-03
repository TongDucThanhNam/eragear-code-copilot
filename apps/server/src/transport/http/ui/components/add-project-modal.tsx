export function AddProjectModal() {
  return (
    <div
      className="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
      id="add-project-modal"
    >
      <div className="modal-panel mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-black font-display text-2xl">Add Project</h3>
          <a className="text-2xl leading-none hover:text-accent" href="/#projects">
            ×
          </a>
        </div>

        <form action="/form/projects/create" method="post">
          <div className="mb-4">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="project-name"
            >
              Project Name *
            </label>
            <input
              className="input-underline w-full"
              id="project-name"
              name="name"
              placeholder="My Project"
              required
              type="text"
            />
          </div>

          <div className="mb-4">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="project-path"
            >
              Project Path *
            </label>
            <input
              className="input-underline w-full"
              id="project-path"
              name="path"
              placeholder="/home/user/projects/my-project"
              required
              type="text"
            />
            <p className="mt-1 font-mono text-[10px] text-muted">
              Must be within allowed project roots
            </p>
          </div>

          <div className="mb-6">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="project-description"
            >
              Description
            </label>
            <input
              className="input-underline w-full"
              id="project-description"
              name="description"
              placeholder="Optional description"
              type="text"
            />
          </div>

          <div className="flex gap-3">
            <button className="btn btn-primary flex-1" type="submit">
              Add Project
            </button>
            <a className="btn btn-secondary" href="/#projects">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
