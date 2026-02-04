import type { FormEvent } from "react";
import type { AgentConfig } from "@/shared/types/agent.types";

interface EditAgentModalsProps {
  agents: AgentConfig[];
  onUpdateAgent: (input: {
    id: string;
    name: string;
    type: string;
    command: string;
    argsInput?: string;
  }) => Promise<void>;
}

export function EditAgentModals({
  agents,
  onUpdateAgent,
}: EditAgentModalsProps) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "").trim();
    const command = String(formData.get("command") ?? "").trim();
    const argsInput = String(formData.get("args") ?? "").trim();

    if (!(id && name && type && command)) {
      return;
    }

    await onUpdateAgent({
      id,
      name,
      type,
      command,
      argsInput: argsInput || undefined,
    });

    window.location.hash = "#tab-agents";
  };

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
                href="#tab-agents"
              >
                ×
              </a>
            </div>

            <form className="p-6" onSubmit={handleSubmit}>
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
                  defaultValue={agent.name}
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
                  defaultValue={agent.type}
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
                  defaultValue={agent.command}
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
                  defaultValue={agent.args ? agent.args.join(", ") : ""}
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Space or comma separated. Use quotes for values with spaces.
                </p>
              </div>

              <div className="flex gap-3">
                <button className="btn btn-primary flex-1" type="submit">
                  Save Changes
                </button>
                <a className="btn btn-secondary" href="#tab-agents">
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
