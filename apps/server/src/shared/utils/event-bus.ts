// Simple event bus implementation
import type { EventBusPort } from "../../shared/types/ports";

export class EventBus implements EventBusPort {
  private listeners: Array<(event: any) => void> = [];

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  publish(event: any): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[EventBus] Listener error:", err);
      }
    }
  }
}
