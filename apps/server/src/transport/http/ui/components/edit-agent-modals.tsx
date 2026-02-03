import type { AgentConfig } from "@/shared/types/agent.types";

interface EditAgentModalsProps {
  agents: AgentConfig[];
}

export function EditAgentModals({ agents }: EditAgentModalsProps) {
  return (
    <>
      {agents.map((agent) => (
        <div
          className="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
          id={`edit-agent-${agent.id}`}
          key={agent.id}
        >
          <div className="modal-panel mx-4 w-full max-w-lg border-2 border-ink bg-paper shadow-news">
            <div className="flex items-center justify-between border-ink border-b-2 p-6">
              <h3 className="font-black font-display text-2xl">Edit Agent</h3>
              <a
                className="text-2xl leading-none hover:text-accent"
                href="/#agents"
              >
                ×
              </a>
            </div>

            <form action="/form/agents/update" className="p-6" method="post">
              <input name="id" type="hidden" value={agent.id} />

              <div className="mb-4">
                <label
                  className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-name-${agent.id}`}
                >
                  Agent Name *
                </label>
                <input
                  className="input-underline w-full"
                  id={`edit-agent-name-${agent.id}`}
                  name="name"
                  required
                  type="text"
                  value={agent.name}
                />
              </div>

              <div className="mb-4">
                <label
                  className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-type-${agent.id}`}
                >
                  Agent Type *
                </label>
                <select
                  className="input-underline w-full"
                  id={`edit-agent-type-${agent.id}`}
                  name="type"
                  required
                >
                  <option selected={agent.type === "claude"} value="claude">
                    Claude
                  </option>
                  <option selected={agent.type === "codex"} value="codex">
                    Codex
                  </option>
                  <option selected={agent.type === "opencode"} value="opencode">
                    OpenCode
                  </option>
                  <option selected={agent.type === "gemini"} value="gemini">
                    Gemini
                  </option>
                  <option selected={agent.type === "other"} value="other">
                    Other
                  </option>
                </select>
              </div>

              <div className="mb-4">
                <label
                  className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-command-${agent.id}`}
                >
                  Command *
                </label>
                <input
                  className="input-underline w-full"
                  id={`edit-agent-command-${agent.id}`}
                  name="command"
                  required
                  type="text"
                  value={agent.command}
                />
              </div>

              <div className="mb-6">
                <label
                  className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-args-${agent.id}`}
                >
                  Arguments
                </label>
                <input
                  className="input-underline w-full"
                  id={`edit-agent-args-${agent.id}`}
                  name="args"
                  placeholder="--acp --stdio"
                  type="text"
                  value={agent.args ? agent.args.join(", ") : ""}
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Space or comma separated. Use quotes for values with spaces.
                </p>
              </div>

              <div className="flex gap-3">
                <button className="btn btn-primary flex-1" type="submit">
                  Save Changes
                </button>
                <a className="btn btn-secondary" href="/#agents">
                  Cancel
                </a>
              </div>
            </form>
          </div>
        </div>
      ))}
    </>
  );
}
