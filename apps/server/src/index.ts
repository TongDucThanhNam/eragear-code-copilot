/**
 * Eragear Code Copilot Server - Entry Point
 *
 * This is the main entry point for the Eragear Code Copilot server application.
 * The server provides:
 * - HTTP UI server for the dashboard
 * - WebSocket server for real-time tRPC communication
 * - ACP (Agent Client Protocol) client connections
 *
 * @module index
 */

import { startServer } from "./bootstrap/server";
import { createLogger } from "./platform/logging/structured-logger";

const logger = createLogger("Server");

// Start the server and handle any initialization errors
startServer().catch((err) => {
  logger.error("Failed to start server", err as Error);
  process.exit(1);
});
