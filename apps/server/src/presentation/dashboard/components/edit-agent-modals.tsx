import type { FormEvent } from "react";
import {
  useDashboardActions,
  useDashboardState,
} from "@/presentation/dashboard/dashboard-view.context";

export function EditAgentModals() {
  const {
    dashboardData: { agents },
  } = useDashboardState();
  const {
    agents: { onUpdateAgent },
  } = useDashboardActions();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "").trim();
    const command = String(formData.get("command") ?? "").trim();
    const argsInput = String(formData.get("args") ?? "").trim();
    const resumeCommandTemplate = String(
      formData.get("resumeCommandTemplate") ?? ""
    ).trim();

    if (!(id && name && type && command)) {
      return;
    }

    await onUpdateAgent({
      id,
      name,
      type,
      command,
      argsInput: argsInput || undefined,
      resumeCommandTemplate: resumeCommandTemplate || undefined,
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
                  defaultValue={agent.name}
                  id={`edit-agent-name-${agent.id}`}
                  name="name"
                  required
                  type="text"
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
                  defaultValue={agent.type}
                  id={`edit-agent-type-${agent.id}`}
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
                  htmlFor={`edit-agent-command-${agent.id}`}
                >
                  Command *
                </label>
                <input
                  className="input-underline w-full"
                  defaultValue={agent.command}
                  id={`edit-agent-command-${agent.id}`}
                  name="command"
                  required
                  type="text"
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
                  defaultValue={agent.args ? agent.args.join(", ") : ""}
                  id={`edit-agent-args-${agent.id}`}
                  name="args"
                  placeholder="--acp --stdio"
                  type="text"
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Space or comma separated. Use quotes for values with spaces.
                </p>
              </div>

              <div className="mb-6">
                <label
                  className="mb-2 block font-mono text-[10px] uppercase tracking-widest"
                  htmlFor={`edit-agent-resume-command-template-${agent.id}`}
                >
                  Resume Command Template
                </label>
                <input
                  className="input-underline w-full"
                  defaultValue={agent.resumeCommandTemplate ?? ""}
                  id={`edit-agent-resume-command-template-${agent.id}`}
                  name="resumeCommandTemplate"
                  placeholder="codex resume <sessionId>"
                  type="text"
                />
                <p className="mt-1 font-mono text-[10px] text-muted">
                  Optional. Use {"<sessionId>"} as placeholder.
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
