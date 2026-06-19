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
  /** Whether ACP thought chunks are recorded as visible reasoning parts */
  showReasoning: boolean;
}

export type AcpPromptMetaPolicy = "allowlist" | "always" | "never";
export type SupervisorWebSearchProvider = "none" | "exa";
export type SupervisorMemoryProvider = "none" | "obsidian";

/**
 * Runtime application configuration (hot-reload without restart)
 */
export interface AppConfig {
  /** Idle timeout before runtime session cleanup */
  sessionIdleTimeoutMs: number;
  /** Maximum page size for session list endpoints */
  sessionListPageMaxLimit: number;
  /** Maximum page size for session message endpoints */
  sessionMessagesPageMaxLimit: number;
  /** Global minimum level for emitted server logs */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Runtime max-tokens hint for prompt requests */
  maxTokens: number;
  /** Preferred model to apply for new sessions when available */
  defaultModel: string;
  /** Whether project supervisor features are enabled in the local runtime */
  supervisorEnabled: boolean;
  /** Model id used for supervisor decisions */
  supervisorModel: string;
  /** DeepSeek API key used when supervisorModel targets DeepSeek */
  supervisorDeepSeekApiKey: string;
  /** Timeout for one supervisor decision in milliseconds */
  supervisorDecisionTimeoutMs: number;
  /** Maximum retry attempts for one supervisor decision */
  supervisorDecisionMaxAttempts: number;
  /** Maximum supervisor loop runtime in milliseconds */
  supervisorMaxRuntimeMs: number;
  /** Maximum repeated prompts before supervisor halts */
  supervisorMaxRepeatedPrompts: number;
  /** Optional web search provider used by supervisor research */
  supervisorWebSearchProvider: SupervisorWebSearchProvider;
  /** API key for the configured supervisor web search provider */
  supervisorWebSearchApiKey: string;
  /** Optional local memory provider used by supervisor decisions */
  supervisorMemoryProvider: SupervisorMemoryProvider;
  /** Command used for Obsidian supervisor memory integration */
  supervisorObsidianCommand: string;
  /** Optional Obsidian vault name for supervisor memory */
  supervisorObsidianVault: string;
  /** Optional Obsidian blueprint path for supervisor memory */
  supervisorObsidianBlueprintPath: string;
  /** Optional Obsidian log path for supervisor memory */
  supervisorObsidianLogPath: string;
  /** Obsidian search path for supervisor memory */
  supervisorObsidianSearchPath: string;
  /** Maximum Obsidian search results for supervisor memory */
  supervisorObsidianSearchLimit: number;
  /** Timeout for one Obsidian memory command in milliseconds */
  supervisorObsidianTimeoutMs: number;
  /** Optional endpoint for model-backed Project Memory and Project Index embeddings */
  projectIndexEmbeddingEndpoint: string;
  /** Embedding model id used by Project Memory and Project Index */
  projectIndexEmbeddingModel: string;
  /** Optional API key for the configured embedding endpoint */
  projectIndexEmbeddingApiKey: string;
  /** Timeout for one embedding request in milliseconds */
  projectIndexEmbeddingTimeoutMs: number;
  /** Policy controlling whether prompt metadata (_meta) is attached to ACP prompt requests */
  acpPromptMetaPolicy: AcpPromptMetaPolicy;
  /** Allowlist used when acpPromptMetaPolicy=allowlist */
  acpPromptMetaAllowlist: string[];
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
  /** Runtime app policy configurable from dashboard */
  app: AppConfig;
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
