import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

interface CommandPolicy {
  command: string;
  allowAnyArgs?: boolean;
  allowedArgs?: string[];
  allowedArgPatterns?: string[];
}

interface BootAllowlistsResponse {
  mode: "standard" | "compiled";
  sourcePath?: string;
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedTerminalCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  warnings: string[];
}

interface CommandPolicyDraft {
  id: string;
  command: string;
  allowAnyArgs: boolean;
  allowedArgsInput: string;
  allowedArgPatternsInput: string;
}

interface PolicyValidationResult {
  policies: CommandPolicy[];
  rowErrors: Record<string, string>;
  issues: string[];
}

interface PolicyRowEditorProps {
  label: string;
  rowError?: string;
  draft: CommandPolicyDraft;
  onChange: (next: CommandPolicyDraft) => void;
  onRemove: () => void;
}

interface PolicyListEditorProps {
  title: string;
  addButtonLabel: string;
  drafts: CommandPolicyDraft[];
  rowErrors: Record<string, string>;
  onChange: (next: CommandPolicyDraft[]) => void;
}

const ABSOLUTE_WINDOWS_PATH_REGEX = /^[A-Za-z]:[\\/]/;
const ENV_KEY_SPLIT_REGEX = /\r?\n|,/;
const TOKEN_SPLIT_REGEX = /[\s,]+/;
let draftCounter = 0;

function createDraftId(): string {
  draftCounter += 1;
  return `policy-${Date.now()}-${draftCounter}`;
}

function createEmptyPolicyDraft(): CommandPolicyDraft {
  return {
    id: createDraftId(),
    command: "",
    allowAnyArgs: true,
    allowedArgsInput: "",
    allowedArgPatternsInput: "",
  };
}

function ensureAtLeastOneDraft(
  drafts: CommandPolicyDraft[]
): CommandPolicyDraft[] {
  if (drafts.length > 0) {
    return drafts;
  }
  return [createEmptyPolicyDraft()];
}

function toDraft(policy: CommandPolicy): CommandPolicyDraft {
  return {
    id: createDraftId(),
    command: policy.command,
    allowAnyArgs: policy.allowAnyArgs === true,
    allowedArgsInput: (policy.allowedArgs ?? []).join(", "),
    allowedArgPatternsInput: (policy.allowedArgPatterns ?? []).join(", "),
  };
}

function parseTokenInput(input: string): string[] {
  const tokens = input
    .split(TOKEN_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(tokens)];
}

function parseEnvKeyInput(input: string): string[] {
  const keys = input
    .split(ENV_KEY_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(keys)];
}

function isAbsoluteCommandPath(command: string): boolean {
  if (command.startsWith("/")) {
    return true;
  }
  return ABSOLUTE_WINDOWS_PATH_REGEX.test(command);
}

function validatePolicyDrafts(
  sectionName: string,
  drafts: CommandPolicyDraft[]
): PolicyValidationResult {
  const rowErrors: Record<string, string> = {};
  const issues: string[] = [];
  const policies: CommandPolicy[] = [];
  const commandToIds = new Map<string, string[]>();

  drafts.forEach((draft, index) => {
    const command = draft.command.trim();
    if (!command) {
      rowErrors[draft.id] = "Command path is required.";
      issues.push(`${sectionName} row ${index + 1}: command path is required.`);
      return;
    }
    if (!isAbsoluteCommandPath(command)) {
      rowErrors[draft.id] =
        "Command must be an absolute path (Unix or Windows).";
      issues.push(
        `${sectionName} row ${index + 1}: command must be an absolute path.`
      );
      return;
    }

    const key = command.toLowerCase();
    const ids = commandToIds.get(key) ?? [];
    ids.push(draft.id);
    commandToIds.set(key, ids);

    if (draft.allowAnyArgs) {
      policies.push({
        command,
        allowAnyArgs: true,
      });
      return;
    }

    policies.push({
      command,
      allowAnyArgs: false,
      allowedArgs: parseTokenInput(draft.allowedArgsInput),
      allowedArgPatterns: parseTokenInput(draft.allowedArgPatternsInput),
    });
  });

  for (const ids of commandToIds.values()) {
    if (ids.length < 2) {
      continue;
    }
    for (const id of ids) {
      rowErrors[id] = "Duplicate command path in this section.";
    }
    issues.push(`${sectionName}: duplicate command paths are not allowed.`);
  }

  return { policies, rowErrors, issues };
}

function normalizeBootPayload(response: BootAllowlistsResponse): {
  agentDrafts: CommandPolicyDraft[];
  terminalDrafts: CommandPolicyDraft[];
  envKeys: string[];
} {
  const agentDrafts = ensureAtLeastOneDraft(
    response.allowedAgentCommandPolicies.map(toDraft)
  );
  const terminalDrafts = ensureAtLeastOneDraft(
    response.allowedTerminalCommandPolicies.map(toDraft)
  );
  const envKeys = parseEnvKeyInput(response.allowedEnvKeys.join(","));

  return {
    agentDrafts,
    terminalDrafts,
    envKeys,
  };
}

function PolicyRowEditor({
  label,
  rowError,
  draft,
  onChange,
  onRemove,
}: PolicyRowEditorProps) {
  const handleCommandChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...draft,
      command: event.target.value,
    });
  };

  const handleAllowAnyArgsChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...draft,
      allowAnyArgs: event.target.checked,
    });
  };

  const handleAllowedArgsChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...draft,
      allowedArgsInput: event.target.value,
    });
  };

  const handleAllowedPatternsChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    onChange({
      ...draft,
      allowedArgPatternsInput: event.target.value,
    });
  };

  return (
    <article className="border border-ink bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="border border-ink bg-[#f0f0ec] px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted uppercase tracking-widest">
          Absolute executable path
        </span>
        <button
          className="btn btn-sm btn-danger ml-auto min-h-[34px]"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <label className="block">
          <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
            Command Path
          </span>
          <input
            className="input-underline w-full"
            onChange={handleCommandChange}
            placeholder="/usr/local/bin/claude-code-acp"
            spellCheck={false}
            type="text"
            value={draft.command}
          />
        </label>

        <label className="flex min-h-[44px] items-center gap-2 border border-ink bg-[#f8f8f4] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">
          <input
            checked={draft.allowAnyArgs}
            onChange={handleAllowAnyArgsChange}
            type="checkbox"
          />
          Allow Any Args
        </label>
      </div>

      {draft.allowAnyArgs ? (
        <p className="mt-3 font-mono text-[10px] text-muted uppercase tracking-widest">
          Any argument is currently allowed for this command.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
              Allowed Args
            </span>
            <input
              className="input-underline w-full"
              onChange={handleAllowedArgsChange}
              placeholder="--version, --help"
              spellCheck={false}
              type="text"
              value={draft.allowedArgsInput}
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-[10px] uppercase tracking-widest">
              Allowed Patterns
            </span>
            <input
              className="input-underline w-full"
              onChange={handleAllowedPatternsChange}
              placeholder="--model=*"
              spellCheck={false}
              type="text"
              value={draft.allowedArgPatternsInput}
            />
          </label>
        </div>
      )}

      {rowError ? (
        <div className="mt-3 border border-red-700 bg-red-50 p-2 font-mono text-red-700 text-xs">
          {rowError}
        </div>
      ) : null}
    </article>
  );
}

function PolicyListEditor({
  title,
  addButtonLabel,
  drafts,
  rowErrors,
  onChange,
}: PolicyListEditorProps) {
  const handleUpdateDraft =
    (id: string) => (nextDraft: CommandPolicyDraft): void => {
      onChange(drafts.map((draft) => (draft.id === id ? nextDraft : draft)));
    };

  const handleRemoveDraft = (id: string) => {
    const next = drafts.filter((draft) => draft.id !== id);
    onChange(ensureAtLeastOneDraft(next));
  };

  const handleAddDraft = () => {
    onChange([...drafts, createEmptyPolicyDraft()]);
  };

  return (
    <section className="border border-ink bg-[#f8f8f4]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-ink border-b px-4 py-3">
        <div>
          <h3 className="font-black font-display text-2xl leading-none tracking-tight">
            {title}
          </h3>
          <p className="mt-2 font-body text-muted text-sm leading-relaxed">
            One policy per executable. Relative command names are blocked.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
            {drafts.length} policies
          </span>
          <button
            className="btn btn-secondary min-h-[36px]"
            onClick={handleAddDraft}
            type="button"
          >
            {addButtonLabel}
          </button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {drafts.map((draft, index) => (
          <PolicyRowEditor
            draft={draft}
            key={draft.id}
            label={`Policy ${index + 1}`}
            onChange={handleUpdateDraft(draft.id)}
            onRemove={() => handleRemoveDraft(draft.id)}
            rowError={rowErrors[draft.id]}
          />
        ))}
      </div>
    </section>
  );
}

export function BootAllowlistsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"standard" | "compiled">("standard");
  const [sourcePath, setSourcePath] = useState<string | undefined>(undefined);
  const [agentDrafts, setAgentDrafts] = useState<CommandPolicyDraft[]>([
    createEmptyPolicyDraft(),
  ]);
  const [terminalDrafts, setTerminalDrafts] = useState<CommandPolicyDraft[]>([
    createEmptyPolicyDraft(),
  ]);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [envInput, setEnvInput] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agentRowErrors, setAgentRowErrors] = useState<Record<string, string>>(
    {}
  );
  const [terminalRowErrors, setTerminalRowErrors] = useState<
    Record<string, string>
  >({});

  const loadBootAllowlists = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/boot-allowlists");
      const payload = (await response.json()) as
        | BootAllowlistsResponse
        | { error?: string };
      if (!response.ok) {
        const errorPayload = payload as { error?: string };
        throw new Error(errorPayload.error ?? `HTTP ${response.status}`);
      }
      const data = payload as BootAllowlistsResponse;
      const normalized = normalizeBootPayload(data);
      setMode(data.mode);
      setSourcePath(data.sourcePath);
      setAgentDrafts(normalized.agentDrafts);
      setTerminalDrafts(normalized.terminalDrafts);
      setEnvKeys(normalized.envKeys);
      setWarnings(data.warnings ?? []);
      setAgentRowErrors({});
      setTerminalRowErrors({});
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load boot allowlists."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBootAllowlists().catch(() => undefined);
  }, [loadBootAllowlists]);

  const normalizedEnvKeys = useMemo(() => {
    return [...new Set(envKeys.map((entry) => entry.trim()).filter(Boolean))];
  }, [envKeys]);

  const handleEnvInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEnvInput(event.target.value);
  };

  const handleEnvInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    handleAddEnvKeys();
  };

  const handleAddEnvKeys = () => {
    const toAdd = parseEnvKeyInput(envInput);
    if (toAdd.length === 0) {
      return;
    }
    setEnvKeys([...new Set([...normalizedEnvKeys, ...toAdd])]);
    setEnvInput("");
  };

  const handleRemoveEnvKey = (keyToRemove: string) => {
    setEnvKeys(
      envKeys.filter((entry) => entry.trim() !== keyToRemove.trim())
    );
  };

  const handleClearEnvKeys = () => {
    setEnvKeys([]);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    const agentValidation = validatePolicyDrafts("Agent policy", agentDrafts);
    const terminalValidation = validatePolicyDrafts(
      "Terminal policy",
      terminalDrafts
    );
    setAgentRowErrors(agentValidation.rowErrors);
    setTerminalRowErrors(terminalValidation.rowErrors);

    const nextEnvKeys = [...new Set(envKeys.map((entry) => entry.trim()))]
      .filter((entry) => entry.length > 0)
      .filter((entry) => entry !== "*");

    const issues = [
      ...agentValidation.issues,
      ...terminalValidation.issues,
      ...(nextEnvKeys.length === 0
        ? ["Allowed environment keys must contain at least one key."]
        : []),
      ...(envKeys.some((entry) => entry.trim() === "*")
        ? ["Allowed environment keys cannot contain wildcard *."]
        : []),
    ];

    if (issues.length > 0) {
      setError(issues.join("\n"));
      setSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/boot-allowlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          allowedAgentCommandPolicies: agentValidation.policies,
          allowedTerminalCommandPolicies: terminalValidation.policies,
          allowedEnvKeys: nextEnvKeys,
        }),
      });
      const payload = (await response.json()) as
        | BootAllowlistsResponse
        | { error?: string };
      if (!response.ok) {
        const errorPayload = payload as { error?: string };
        throw new Error(errorPayload.error ?? `HTTP ${response.status}`);
      }
      const data = payload as BootAllowlistsResponse;
      const normalized = normalizeBootPayload(data);
      setMode(data.mode);
      setSourcePath(data.sourcePath);
      setAgentDrafts(normalized.agentDrafts);
      setTerminalDrafts(normalized.terminalDrafts);
      setEnvKeys(normalized.envKeys);
      setWarnings(data.warnings ?? []);
      setNotice("Command allowlists saved. Runtime policy has been reloaded.");
      setAgentRowErrors({});
      setTerminalRowErrors({});
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save boot allowlists."
      );
    } finally {
      setSaving(false);
    }
  };

  let buttonLabel = "Save Command Allowlists";
  if (loading) {
    buttonLabel = "Loading...";
  }
  if (saving) {
    buttonLabel = "Saving...";
  }

  const modeLabel = mode === "compiled" ? "Compiled Mode" : "Standard Mode";

  return (
    <form className="mt-8" onSubmit={handleSave}>
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-black font-display text-3xl tracking-tight">
                Command Allowlists
              </h2>
              <p className="mt-2 max-w-2xl font-body text-muted text-sm leading-relaxed">
                Define exactly which executables and argument patterns are
                allowed for agents and terminal calls.
              </p>
              <p className="mt-2 font-mono text-[10px] text-muted uppercase tracking-widest">
                source: {sourcePath ?? "not found (runtime ENV fallback)"}
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-widest">
                {modeLabel}
              </span>
              <button
                className="btn btn-secondary min-h-[36px]"
                disabled={loading || saving}
                onClick={() => {
                  loadBootAllowlists().catch(() => undefined);
                }}
                type="button"
              >
                Reload from Server
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid gap-4 xl:grid-cols-2">
            <PolicyListEditor
              addButtonLabel="Add Agent Policy"
              drafts={agentDrafts}
              onChange={setAgentDrafts}
              rowErrors={agentRowErrors}
              title="Agent Command Policies"
            />
            <PolicyListEditor
              addButtonLabel="Add Terminal Policy"
              drafts={terminalDrafts}
              onChange={setTerminalDrafts}
              rowErrors={terminalRowErrors}
              title="Terminal Command Policies"
            />
          </div>

          <section className="border border-ink bg-[#f8f8f4]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-ink border-b px-4 py-3">
              <div>
                <h3 className="font-black font-display text-2xl leading-none tracking-tight">
                  Allowed Environment Keys
                </h3>
                <p className="mt-2 font-body text-muted text-sm leading-relaxed">
                  Only these environment variables will be forwarded to agent
                  processes.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
                  {normalizedEnvKeys.length} keys
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={normalizedEnvKeys.length === 0}
                  onClick={handleClearEnvKeys}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input-underline flex-1"
                  onChange={handleEnvInputChange}
                  onKeyDown={handleEnvInputKeyDown}
                  placeholder="PATH, HOME, API_KEY"
                  spellCheck={false}
                  type="text"
                  value={envInput}
                />
                <button
                  className="btn btn-secondary min-h-[44px] sm:min-h-[36px]"
                  onClick={handleAddEnvKeys}
                  type="button"
                >
                  Add Key
                </button>
              </div>

              <p className="font-mono text-[10px] text-muted uppercase tracking-widest">
                Press Enter or click Add Key. Comma and newline separators are
                supported.
              </p>

              {normalizedEnvKeys.length === 0 ? (
                <div className="border border-ink border-dashed bg-white p-4 text-center font-mono text-[10px] text-muted uppercase tracking-widest">
                  No environment keys configured.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {normalizedEnvKeys.map((envKey) => (
                    <button
                      className="flex items-center gap-2 border border-ink bg-white px-3 py-2 font-mono text-xs transition-colors hover:bg-[#f0f0ec]"
                      key={envKey}
                      onClick={() => handleRemoveEnvKey(envKey)}
                      type="button"
                    >
                      <span>{envKey}</span>
                      <span aria-hidden className="font-black">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {warnings.length > 0 ? (
            <div className="border border-yellow-700 bg-yellow-50 p-3">
              <p className="mb-2 font-mono text-[10px] text-yellow-900 uppercase tracking-widest">
                Warnings
              </p>
              <div className="space-y-1 font-mono text-xs text-yellow-900">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="border border-red-700 bg-red-50 p-3">
              <p className="mb-2 font-mono text-[10px] text-red-700 uppercase tracking-widest">
                Validation Error
              </p>
              <p className="whitespace-pre-line font-mono text-red-700 text-xs">
                {error}
              </p>
            </div>
          ) : null}

          {notice ? (
            <div className="border border-green-700 bg-green-50 p-3">
              <p className="font-mono text-green-700 text-xs">{notice}</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-ink border-t-2 pt-6">
        <p className="font-mono text-[10px] text-muted uppercase tracking-widest">
          Runtime policy is reloaded immediately after save.
        </p>
        <button
          className="btn btn-secondary min-h-[52px] px-10 text-base"
          disabled={loading || saving}
          type="submit"
        >
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}
