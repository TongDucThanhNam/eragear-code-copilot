import {
  Activity,
  ArchiveRestore,
  BarChart3,
  Blocks,
  Bot,
  BrainCircuit,
  Bug,
  BookOpen,
  CloudCog,
  Command,
  CreditCard,
  Database,
  Fingerprint,
  GitBranch,
  KeyRound,
  Link2,
  Network,
  Paintbrush,
  PlugZap,
  SearchCode,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Workflow,
  Wifi,
} from "lucide-react";
import type { ComponentType } from "react";

export type SettingsRouteTo =
  | "/settings/agents"
  | "/settings/bots"
  | "/settings/connection"
  | "/settings/runtime"
  | "/settings/capabilities"
  | "/settings/credentials"
  | "/settings/crash-reporting"
  | "/settings/acp-auth"
  | "/settings/oauth"
  | "/settings/plan"
  | "/settings/sync"
  | "/settings/model-providers"
  | "/settings/prompt-enhancement"
  | "/settings/output-style"
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
    id: "setup",
    label: "Setup",
    description: "Connect the desktop app to agents, providers, and local runtime.",
    icon: ServerCog,
    items: [
      {
        to: "/settings/agents",
        label: "Agents",
        detail: "ACP profiles",
        icon: Bot,
        keywords: ["claude", "codex", "gemini", "opencode"],
      },
      {
        to: "/settings/connection",
        label: "Connection",
        detail: "Server and allowlist",
        icon: ShieldCheck,
        keywords: ["server", "desktop", "allowlist"],
      },
      {
        to: "/settings/runtime",
        label: "Runtime",
        detail: "Health and providers",
        icon: ServerCog,
        keywords: ["diagnostics", "quota", "local"],
      },
      {
        to: "/settings/model-providers",
        label: "Model Providers",
        detail: "Models and mappings",
        icon: BrainCircuit,
        keywords: ["models", "provider", "mapping"],
      },
      {
        to: "/settings/credentials",
        label: "Credentials",
        detail: "Encrypted secrets",
        icon: KeyRound,
        keywords: ["secret", "key", "token"],
      },
    ],
  },
  {
    id: "account-access",
    label: "Account and Access",
    description: "Manage identity, entitlement, OAuth, and sync boundaries.",
    icon: Fingerprint,
    items: [
      {
        to: "/settings/plan",
        label: "Plan",
        detail: "Entitlements",
        icon: CreditCard,
        keywords: ["billing", "subscription", "license"],
      },
      {
        to: "/settings/oauth",
        label: "OAuth",
        detail: "Provider login",
        icon: Link2,
        keywords: ["login", "auth", "provider"],
      },
      {
        to: "/settings/acp-auth",
        label: "ACP Auth",
        detail: "Provider files",
        icon: Fingerprint,
        keywords: ["auth", "files", "identity"],
      },
      {
        to: "/settings/sync",
        label: "Sync",
        detail: "Settings state",
        icon: CloudCog,
        keywords: ["state", "backup"],
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    description: "Configure repeatable actions, commands, hooks, and shell behavior.",
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
        to: "/settings/automation",
        label: "Automation",
        detail: "Hooks and plugins",
        icon: PlugZap,
        keywords: ["workflow", "background"],
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
    id: "extensions",
    label: "Extensions",
    description: "Install and govern external capabilities, skills, plugins, and MCP.",
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
        detail: "SKILL.md library",
        icon: BookOpen,
        keywords: ["skill", "instructions"],
      },
      {
        to: "/settings/mcp",
        label: "MCP",
        detail: "Servers and tools",
        icon: Activity,
        keywords: ["server", "tools", "connector"],
      },
      {
        to: "/settings/capabilities",
        label: "Capabilities",
        detail: "Registry toggles",
        icon: SlidersHorizontal,
        keywords: ["registry", "toggle"],
      },
    ],
  },
  {
    id: "workspace-intelligence",
    label: "Workspace Intelligence",
    description: "Tune memory, repo context, prompt assistance, and response style.",
    icon: BrainCircuit,
    items: [
      {
        to: "/settings/memory",
        label: "Memory",
        detail: "Trust and index",
        icon: Database,
        keywords: ["knowledge", "index"],
      },
      {
        to: "/settings/repo-snapshots",
        label: "Repo Snapshots",
        detail: "Index and search",
        icon: SearchCode,
        keywords: ["repository", "search", "index"],
      },
      {
        to: "/settings/prompt-enhancement",
        label: "Prompt",
        detail: "Enhancement rules",
        icon: Sparkles,
        keywords: ["prompt", "rewrite"],
      },
      {
        to: "/settings/output-style",
        label: "Output Style",
        detail: "Response tone",
        icon: Paintbrush,
        keywords: ["tone", "style"],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    description: "Inspect usage, logs, archives, crash data, and remote connectivity.",
    icon: BarChart3,
    items: [
      {
        to: "/settings/usage",
        label: "Usage",
        detail: "Stats and telemetry",
        icon: BarChart3,
        keywords: ["stats", "telemetry"],
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
        label: "Archive",
        detail: "Old task cleanup",
        icon: ArchiveRestore,
        keywords: ["cleanup", "old tasks"],
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
