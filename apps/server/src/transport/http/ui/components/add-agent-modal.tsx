export function AddAgentModal() {
  return (
    <div
      class="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
      id="add-agent-modal"
    >
      <div class="modal-panel mx-4 w-full max-w-md border-2 border-ink bg-paper p-6 shadow-news">
        <div class="mb-6 flex items-center justify-between">
          <h3 class="font-black font-display text-2xl">Add Agent</h3>
          <a class="text-2xl leading-none hover:text-accent" href="/#">
            ×
          </a>
        </div>

        <form action="/form/agents/create" method="post">
          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-name"
            >
              Agent Name *
            </label>
            <input
              class="input-underline w-full"
              id="agent-name"
              name="name"
              placeholder="Claude Code"
              required
              type="text"
            />
          </div>

          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-type"
            >
              Agent Type *
            </label>
            <select
              class="input-underline w-full"
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

          <div class="mb-4">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-command"
            >
              Command *
            </label>
            <input
              class="input-underline w-full"
              id="agent-command"
              name="command"
              placeholder="claude"
              required
              type="text"
            />
            <p class="mt-1 font-mono text-[10px] text-muted">
              The command to spawn the agent process
            </p>
          </div>

          <div class="mb-6">
            <label
              class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
              htmlFor="agent-args"
            >
              Arguments
            </label>
            <input
              class="input-underline w-full"
              id="agent-args"
              name="args"
              placeholder="--mcp, --print"
              type="text"
            />
            <p class="mt-1 font-mono text-[10px] text-muted">
              Comma-separated arguments
            </p>
          </div>

          <div class="flex gap-3">
            <button class="btn btn-primary flex-1" type="submit">
              Add Agent
            </button>
            <a class="btn btn-secondary" href="/#agents">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
