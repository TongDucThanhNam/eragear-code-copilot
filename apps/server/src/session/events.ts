import type { BroadcastEvent, ChatSession } from "./types";

export const chats = new Map<string, ChatSession>();

// Helper to broadcast to both SSE (legacy) and tRPC Emitter
export function broadcastToSession(chatId: string, event: BroadcastEvent) {
  const session = chats.get(chatId);
  if (!session) {
    return;
  }

  // 1. Buffer
  session.messageBuffer.push(event);

  // 2. Emit to tRPC subscribers
  // console.log(`[Server] Emitting event ${event.type} to tRPC listeners`);
  session.emitter.emit("data", event);
}
