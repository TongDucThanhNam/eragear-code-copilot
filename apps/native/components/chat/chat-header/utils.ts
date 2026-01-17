import type { ConnectionStatus } from "./types";

export function getStatusColor(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-success";
    case "connecting":
      return "bg-warning";
    case "error":
      return "bg-danger";
    default:
      return "bg-muted";
  }
}

export function getStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}
