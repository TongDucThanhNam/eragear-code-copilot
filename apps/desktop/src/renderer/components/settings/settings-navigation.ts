import {
  Activity,
  ArchiveRestore,
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  BrainCircuit,
  Bug,
  CloudCog,
  Command,
  Database,
  Eye,
  Gauge,
  GitBranch,
  KeyRound,
  Link2,
  Network,
  SearchCode,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Wifi,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";

export type SettingsRouteTo =
  | "/settings/agents"
  | "/settings/bots"
  | "/settings/connection"
  | "/settings/runtime"
  | "/settings/credentials"
  | "/settings/crash-reporting"
  | "/settings/appearance"
  | "/settings/sync"
  | "/settings/quota"
  | "/settings/prompt-enhancement"
  | "/settings/plugins"
  | "/settings/repo-snapshots"
  | "/settings/remote-control"
  | "/settings/traffic-proxy"
  | "/settings/commands"
  | "/settings/usage"
  | "/settings/terminal"
  | "/settings/skills"
  | "/settings/hooks"
  | "/settings/automation"
  | "/settings/archive"
  | "/settings/memory"
  | "/settings/mcp"
  | "/settings/activity";

export interface SettingsNavItem {
  to: SettingsRouteTo;
  label: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
}

export interface SettingsNavGroup {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "general",
    label: "General",
    description: "Tune the everyday chat experience and response behavior.",
    icon: SlidersHorizontal,
    items: [
      {
        to: "/settings/appearance",
        label: "Appearance",
        detail: "Display preferences",
        icon: Eye,
        keywords: ["ui", "theme", "reasoning", "thinking"],
      },
      {
        to: "/settings/prompt-enhancement",
        label: "Prompt Enhancement",
        detail: "Prompt assistance",
        icon: Sparkles,
        keywords: ["prompt", "rewrite"],
      },
    ],
  },
  {
    id: "ai-providers",
    label: "Agents and Runtime",
    description:
      "Configure ACP agents, shared secrets, limits, and runtime health.",
    icon: BrainCircuit,
    items: [
      {
        to: "/settings/agents",
        label: "Agents",
        detail: "ACP profiles",
        icon: Bot,
        keywords: ["claude", "codex", "gemini", "opencode"],
      },
      {
        to: "/settings/credentials",
        label: "Credentials",
        detail: "Encrypted secrets",
        icon: KeyRound,
        keywords: ["secret", "key", "token"],
      },
      {
        to: "/settings/runtime",
        label: "Runtime Diagnostics",
        detail: "Health and updates",
        icon: ServerCog,
        keywords: ["diagnostics", "provider", "update", "local"],
      },
      {
        to: "/settings/quota",
        label: "Quota",
        detail: "Remaining limits and resets",
        icon: Gauge,
        keywords: [
          "subscription",
          "remaining",
          "limit",
          "refresh",
          "reset",
          "capacity",
        ],
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Manage project memory and codebase index snapshots.",
    icon: Database,
    items: [
      {
        to: "/settings/memory",
        label: "Project Memory",
        detail: "Memory, trust, and index",
        icon: Database,
        keywords: ["knowledge", "trust", "project index"],
      },
      {
        to: "/settings/repo-snapshots",
        label: "Code Index Snapshots",
        detail: "Snapshot search history",
        icon: SearchCode,
        keywords: ["repository", "codebase", "search", "index", "manifest"],
      },
    ],
  },
  {
    id: "tools",
    label: "Tools and Extensions",
    description: "Install and govern plugins, skills, and MCP servers.",
    icon: Blocks,
    items: [
      {
        to: "/settings/plugins",
        label: "Plugins",
        detail: "SDK and marketplace",
        icon: Blocks,
        keywords: ["marketplace", "extension"],
      },
      {
        to: "/settings/skills",
        label: "Skills",
        detail: "Global library",
        icon: BookOpen,
        keywords: ["skill", "instructions"],
      },
      {
        to: "/settings/mcp",
        label: "MCP Servers",
        detail: "Servers and tools",
        icon: Activity,
        keywords: ["server", "tools", "connector"],
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    description: "Configure bots, commands, hooks, and shell behavior.",
    icon: Workflow,
    items: [
      {
        to: "/settings/bots",
        label: "Bots",
        detail: "Triggers and runs",
        icon: Bot,
        keywords: ["trigger", "run"],
      },
      {
        to: "/settings/commands",
        label: "Commands",
        detail: "Slash registry",
        icon: Command,
        keywords: ["slash", "command"],
      },
      {
        to: "/settings/hooks",
        label: "Hooks",
        detail: "Lifecycle runs",
        icon: Workflow,
        keywords: ["lifecycle", "event"],
      },
      {
        to: "/settings/terminal",
        label: "Terminal",
        detail: "Interactive shell",
        icon: SquareTerminal,
        keywords: ["shell", "command line"],
      },
    ],
  },
  {
    id: "connections",
    label: "Connections",
    description: "Control server, sync, remote access, and network routing.",
    icon: Link2,
    items: [
      {
        to: "/settings/connection",
        label: "Server Connection",
        detail: "Server and allowlist",
        icon: ShieldCheck,
        keywords: ["server", "desktop", "allowlist"],
      },
      {
        to: "/settings/sync",
        label: "Settings Sync",
        detail: "Settings state",
        icon: CloudCog,
        keywords: ["state", "backup"],
      },
      {
        to: "/settings/remote-control",
        label: "Remote Control",
        detail: "Relay sessions",
        icon: Wifi,
        keywords: ["relay", "remote"],
      },
      {
        to: "/settings/traffic-proxy",
        label: "ACP Proxy",
        detail: "Proxy and CA",
        icon: Network,
        keywords: ["proxy", "certificate", "ca"],
      },
    ],
  },
  {
    id: "diagnostics",
    label: "Diagnostics and History",
    description: "Inspect usage, logs, crash data, and archived tasks.",
    icon: BarChart3,
    items: [
      {
        to: "/settings/usage",
        label: "Usage",
        detail: "Historical tokens and cost",
        icon: BarChart3,
        keywords: [
          "stats",
          "telemetry",
          "history",
          "monthly",
          "spend",
          "monthly spend",
        ],
      },
      {
        to: "/settings/activity",
        label: "Activity",
        detail: "Logs and parity",
        icon: GitBranch,
        keywords: ["logs", "history"],
      },
      {
        to: "/settings/crash-reporting",
        label: "Crash Reporting",
        detail: "Archive and Sentry",
        icon: Bug,
        keywords: ["error", "sentry"],
      },
      {
        to: "/settings/archive",
        label: "Task Archive",
        detail: "Old task cleanup",
        icon: ArchiveRestore,
        keywords: ["cleanup", "old tasks"],
      },
    ],
  },
];

// This route remains reachable for existing deep links, but its Local ADE
// surface duplicates the dedicated Hooks and Plugins settings pages.
export const SETTINGS_HIDDEN_DUPLICATE_ROUTES: SettingsRouteTo[] = [
  "/settings/automation",
];

export const SETTINGS_NAV_ITEMS = SETTINGS_NAV_GROUPS.flatMap(
  (group) => group.items
);

export function findSettingsNavItem(to: SettingsRouteTo) {
  return SETTINGS_NAV_ITEMS.find((item) => item.to === to);
}

export function filterSettingsGroups(query: string): SettingsNavGroup[] {
  const normalizedQuery = normalizeSearchTerm(query);

  if (!normalizedQuery) {
    return SETTINGS_NAV_GROUPS;
  }

  return SETTINGS_NAV_GROUPS.map((group) => {
    const groupMatches = matchesGroup(group, normalizedQuery);
    const items = groupMatches
      ? group.items
      : group.items.filter((item) => matchesItem(item, normalizedQuery));

    return { ...group, items };
  }).filter((group) => group.items.length > 0);
}

function matchesGroup(group: SettingsNavGroup, query: string) {
  return [group.label, group.description, group.id]
    .map(normalizeSearchTerm)
    .some((value) => value.includes(query));
}

function matchesItem(item: SettingsNavItem, query: string) {
  return [item.label, item.detail, ...(item.keywords ?? [])]
    .map(normalizeSearchTerm)
    .some((value) => value.includes(query));
}

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase();
}
