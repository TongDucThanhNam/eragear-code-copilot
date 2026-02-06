import type { AgentConfig } from "@/shared/types/agent.types";

interface AgentCardProps {
  agent: AgentConfig;
  onDeleteAgent: (agentId: string) => void;
}

export function AgentCard({ agent, onDeleteAgent }: AgentCardProps) {
  const typeColors: Record<string, string> = {
    claude: "bg-orange-100 text-orange-800",
    codex: "bg-green-100 text-green-800",
    opencode: "bg-blue-100 text-blue-800",
    gemini: "bg-purple-100 text-purple-800",
    other: "bg-gray-100 text-gray-800",
  };
  const typeClass = typeColors[agent.type] || typeColors.other;

  return (
    <div className="card agent-card mb-2 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="truncate font-semibold">{agent.name}</span>
          <span className={`badge ${typeClass} text-[10px]`}>{agent.type}</span>
        </div>
        <code className="block truncate font-mono text-muted text-xs">
          {agent.command}
          {agent.args && agent.args.length > 0
            ? ` ${agent.args.join(" ")}`
            : ""}
        </code>
      </div>
      <div className="flex gap-2">
        <a
          className="btn btn-sm btn-secondary"
          href={`#edit-agent-${agent.id}`}
        >
          Edit
        </a>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => onDeleteAgent(agent.id)}
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
