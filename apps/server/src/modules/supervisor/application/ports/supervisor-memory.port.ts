/**
 * One memory lookup result returned to supervisor decision prompts.
 *
 * Invariant: snippets should be bounded and relevant; adapters must not return
 * whole notes or unbounded vault content.
 */
export interface SupervisorMemoryResult {
  title: string;
  path?: string;
  snippets: string[];
}

/**
 * Project-specific memory routing configuration.
 *
 * Caller contract: missing `obsidianProjectPath` disables project-folder scoped
 * lookup but does not disable generic tech-stack context.
 */
export interface SupervisorProjectMemoryConfig {
  obsidianProjectPath?: string;
  techStackTags: string[];
}

/**
 * Memory context included in one supervisor decision.
 *
 * Invariant: `lookupCommands` is diagnostic guidance for traceability; it is not
 * executable command input for the agent.
 */
export interface SupervisorMemoryContext {
  projectBlueprint?: string;
  results: SupervisorMemoryResult[];
  lookupCommands?: string[];
}

/**
 * Request for retrieving local project memory.
 *
 * Security contract: adapters should scope lookups to configured vault/project
 * paths and return bounded snippets only.
 */
export interface SupervisorMemoryLookupInput {
  query: string;
  chatId: string;
  projectRoot: string;
  projectMemory?: SupervisorProjectMemoryConfig;
}

/**
 * Durable supervisor memory/audit log request.
 *
 * Side effect: adapters may persist this as a project memory note; callers must
 * avoid including secrets or raw high-volume output.
 */
export interface SupervisorMemoryLogInput {
  chatId: string;
  projectRoot: string;
  turnId?: string;
  action: string;
  reason: string;
  autoResumeSignal?: string;
  continuationCount?: number;
  latestAssistantTextPart: string;
}

/**
 * Supervisor local memory adapter.
 *
 * Contract: `lookup` is read-only context retrieval; `appendLog` records durable
 * supervisor observations and must not be required for prompt correctness.
 */
export interface SupervisorMemoryPort {
  lookup(input: SupervisorMemoryLookupInput): Promise<SupervisorMemoryContext>;
  appendLog(input: SupervisorMemoryLogInput): Promise<void>;
}

// ── Audit Port ──────────────────────────────────────────────────────────────
// Records every supervisor decision for traceability. Separate from
// SupervisorMemoryPort so that memoryPort.lookup() returns only durable
// SAVE_MEMORY facts, not raw audit entries.

/**
 * Trace entry for a supervisor decision.
 *
 * Invariant: audit entries are for explainability/debugging and should be kept
 * separate from memory lookup facts used in future decisions.
 */
export interface SupervisorAuditEntry {
  chatId: string;
  projectRoot: string;
  turnId?: string;
  semanticAction: string;
  reason: string;
  autoResumeSignal?: string;
  continuationCount?: number;
  latestAssistantTextPart: string;
}

/**
 * Append-only supervisor audit sink.
 *
 * Side effect: implementations may persist entries outside the session store;
 * failure should be logged but should not normally block user prompt flow.
 */
export interface SupervisorAuditPort {
  appendEntry(input: SupervisorAuditEntry): Promise<void>;
}
