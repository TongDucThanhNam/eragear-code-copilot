/**
 * Settings Types
 *
 * Type definitions for UI settings, MCP server configurations, and application settings.
 *
 * @module shared/types/settings.types
 */

/**
 * UI appearance and behavior settings
 */
export interface UiSettings {
  /** Color theme: light, dark, or system preference */
  theme: "light" | "dark" | "system";
  /** Accent color in hex format */
  accentColor: string;
  /** UI density: comfortable or compact */
  density: "comfortable" | "compact";
  /** Font scale factor (0.8 to 1.3) */
  fontScale: number;
}

/**
 * Complete application settings
 */
export interface Settings {
  /** UI appearance settings */
  ui: UiSettings;
  /** List of project root directories */
  projectRoots: string[];
  /** MCP server configurations */
  mcpServers?: McpServerConfig[];
}

/**
 * Environment variable for MCP server
 */
export interface McpServerEnv {
  /** Environment variable name */
  name: string;
  /** Environment variable value */
  value: string;
}

/**
 * HTTP header for MCP server
 */
export interface McpServerHeader {
  /** Header name */
  name: string;
  /** Header value */
  value: string;
}

/**
 * Stdio-based MCP server configuration
 */
export interface McpStdioServerConfig {
  /** Server display name */
  name: string;
  /** Command to execute */
  command: string;
  /** Command arguments */
  args: string[];
  /** Optional environment variables */
  env?: McpServerEnv[];
}

/**
 * HTTP-based MCP server configuration
 */
export interface McpHttpServerConfig {
  /** Server type indicator */
  type: "http";
  /** Server display name */
  name: string;
  /** Server URL */
  url: string;
  /** HTTP headers to include */
  headers: McpServerHeader[];
}

/**
 * SSE-based MCP server configuration
 */
export interface McpSseServerConfig {
  /** Server type indicator */
  type: "sse";
  /** Server display name */
  name: string;
  /** Server URL */
  url: string;
  /** HTTP headers to include */
  headers: McpServerHeader[];
}

/**
 * Union type for all MCP server configurations
 */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig
  | McpSseServerConfig;
