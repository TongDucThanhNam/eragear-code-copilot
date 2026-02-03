/**
 * tRPC Type Definitions
 *
 * Type definitions for tRPC context, WebSocket connection params, and related types.
 * Ensures type safety throughout the tRPC layer.
 *
 * @module transport/trpc/types
 */

/**
 * WebSocket connection parameters passed from client to server
 *
 * Used during tRPC WebSocket connection initialization to pass API keys
 * or other authentication data.
 */
export interface WebSocketConnectionParams {
  /** API key for header-based authentication */
  apiKey?: string;
}

/**
 * WebSocket handler info object passed by tRPC
 *
 * Contains connection parameters and other metadata from the WebSocket connection.
 */
export interface WebSocketHandlerInfo {
  connectionParams?: WebSocketConnectionParams | null;
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
