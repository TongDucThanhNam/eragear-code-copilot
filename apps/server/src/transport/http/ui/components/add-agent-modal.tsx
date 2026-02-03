export function AddAgentModal() {
  return (
    <div
      className="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
      id="add-agent-modal"
    >
      <div className="modal-panel mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-black font-display text-2xl">Add Agent</h3>
          <a className="text-2xl leading-none hover:text-accent" href="/#">
            ×
          </a>
        </div>

        <form action="/form/agents/create" method="post">
          <div className="mb-4">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-name"
            >
              Agent Name *
            </label>
            <input
              className="input-underline w-full"
              id="agent-name"
              name="name"
              placeholder="Claude Code"
              required
              type="text"
            />
          </div>

          <div className="mb-4">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-type"
            >
              Agent Type *
            </label>
            <select
              className="input-underline w-full"
              id="agent-type"
              name="type"
              required
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="opencode">OpenCode</option>
              <option value="gemini">Gemini</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="mb-4">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-command"
            >
              Command *
            </label>
            <input
              className="input-underline w-full"
              id="agent-command"
              name="command"
              placeholder="claude"
              required
              type="text"
            />
            <p className="mt-1 font-mono text-[10px] text-muted">
              The command to spawn the agent process
            </p>
          </div>

          <div className="mb-6">
            <label
              className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-args"
            >
              Arguments
            </label>
            <input
              className="input-underline w-full"
              id="agent-args"
              name="args"
              placeholder="--acp --stdio"
              type="text"
            />
            <p className="mt-1 font-mono text-[10px] text-muted">
              Space or comma separated. Use quotes for values with spaces.
            </p>
          </div>

          <div className="flex gap-3">
            <button className="btn btn-primary flex-1" type="submit">
              Add Agent
            </button>
            <a className="btn btn-secondary" href="/#agents">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
