/**
 * tRPC Type Definitions
 *
 * Type definitions for tRPC WebSocket handler metadata and related types.
 * Ensures type safety throughout the tRPC layer.
 *
 * @module transport/trpc/types
 */

/**
 * WebSocket handler info object passed by tRPC
 *
 * Carries adapter metadata only. Authentication must come from headers/cookies,
 * not from ad-hoc connection params.
 */
export interface WebSocketHandlerInfo {
  isInternal?: boolean;
}

/**
 * WebSocket upgrade request object
 *
 * Used internally when upgrading HTTP connection to WebSocket.
 */
export interface WebSocketRequest {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}
