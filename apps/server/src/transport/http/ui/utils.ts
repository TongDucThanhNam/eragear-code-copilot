import type { TabKey } from "@/transport/http/ui/dashboard-data";

export function normalizeTab(tab?: string): TabKey {
  switch (tab) {
    case "projects":
    case "agents":
    case "auth":
    case "settings":
    case "sessions":
    case "logs":
      return tab;
    default:
      return "sessions";
  }
}

export function formatUptime(seconds: number): string {
  if (!seconds) {
    return "0h 0m";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function formatTimeAgo(timestamp: number): string {
  if (!timestamp) {
    return "Never";
  }
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "Just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatDateTime(value: string | number | null): string {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleString();
}
