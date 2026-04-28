export interface SupervisorMemoryResult {
  title: string;
  path?: string;
  snippets: string[];
}

export interface SupervisorMemoryContext {
  projectBlueprint?: string;
  results: SupervisorMemoryResult[];
}

export interface SupervisorMemoryLookupInput {
  query: string;
  chatId: string;
  projectRoot: string;
}

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

export interface SupervisorMemoryPort {
  lookup(input: SupervisorMemoryLookupInput): Promise<SupervisorMemoryContext>;
  appendLog(input: SupervisorMemoryLogInput): Promise<void>;
}

// ── Audit Port ──────────────────────────────────────────────────────────────
// Records every supervisor decision for traceability. Separate from
// SupervisorMemoryPort so that memoryPort.lookup() returns only durable
// SAVE_MEMORY facts, not raw audit entries.

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

export interface SupervisorAuditPort {
  appendEntry(input: SupervisorAuditEntry): Promise<void>;
}
