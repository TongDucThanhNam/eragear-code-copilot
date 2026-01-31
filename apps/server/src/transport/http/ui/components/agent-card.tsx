import type { AgentConfig } from "@/shared/types/agent.types";

interface AgentCardProps {
  agent: AgentConfig;
}

export function AgentCard({ agent }: AgentCardProps) {
  const typeColors: Record<string, string> = {
    claude: "bg-orange-100 text-orange-800",
    codex: "bg-green-100 text-green-800",
    opencode: "bg-blue-100 text-blue-800",
    gemini: "bg-purple-100 text-purple-800",
    other: "bg-gray-100 text-gray-800",
  };
  const typeClass = typeColors[agent.type] || typeColors.other;

  return (
    <div class="card agent-card mb-2 flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex items-center gap-2">
          <span class="truncate font-semibold">{agent.name}</span>
          <span class={`badge ${typeClass} text-[10px]`}>{agent.type}</span>
        </div>
        <code class="block truncate font-mono text-muted text-xs">
          {agent.command}
          {agent.args && agent.args.length > 0
            ? ` ${agent.args.join(" ")}`
            : ""}
        </code>
      </div>
      <div class="flex gap-2">
        <a class="btn btn-sm btn-secondary" href={`#edit-agent-${agent.id}`}>
          Edit
        </a>
        <form action="/form/agents/delete" method="post">
          <input name="agentId" type="hidden" value={agent.id} />
          <button class="btn btn-sm btn-danger" type="submit">
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}
