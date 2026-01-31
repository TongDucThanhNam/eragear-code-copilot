import type { AgentConfig } from "@/shared/types/agent.types";

interface EditAgentModalsProps {
  agents: AgentConfig[];
}

export function EditAgentModals({ agents }: EditAgentModalsProps) {
  return (
    <>
      {agents.map((agent) => (
        <div
          class="modal fixed inset-0 z-50 items-center justify-center bg-ink/80"
          id={`edit-agent-${agent.id}`}
          key={agent.id}
        >
          <div class="modal-panel mx-4 w-full max-w-lg border-2 border-ink bg-paper shadow-news">
            <div class="flex items-center justify-between border-ink border-b-2 p-6">
              <h3 class="font-black font-display text-2xl">Edit Agent</h3>
              <a
                class="text-2xl leading-none hover:text-accent"
                href="/#agents"
              >
                ×
              </a>
            </div>

            <form action="/form/agents/update" class="p-6" method="post">
              <input name="id" type="hidden" value={agent.id} />

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-name-${agent.id}`}
                >
                  Agent Name *
                </label>
                <input
                  class="input-underline w-full"
                  id={`edit-agent-name-${agent.id}`}
                  name="name"
                  required
                  type="text"
                  value={agent.name}
                />
              </div>

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-type-${agent.id}`}
                >
                  Agent Type *
                </label>
                <select
                  class="input-underline w-full"
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

              <div class="mb-4">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-command-${agent.id}`}
                >
                  Command *
                </label>
                <input
                  class="input-underline w-full"
                  id={`edit-agent-command-${agent.id}`}
                  name="command"
                  required
                  type="text"
                  value={agent.command}
                />
              </div>

              <div class="mb-6">
                <label
                  class="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-args-${agent.id}`}
                >
                  Arguments
                </label>
                <input
                  class="input-underline w-full"
                  id={`edit-agent-args-${agent.id}`}
                  name="args"
                  placeholder="--mcp, --print"
                  type="text"
                  value={agent.args ? agent.args.join(", ") : ""}
                />
                <p class="mt-1 font-mono text-[10px] text-muted">
                  Comma-separated arguments
                </p>
              </div>

              <div class="flex gap-3">
                <button class="btn btn-primary flex-1" type="submit">
                  Save Changes
                </button>
                <a class="btn btn-secondary" href="/#agents">
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
