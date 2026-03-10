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

interface BootCommonSettings {
  wsAuthTimeoutMs?: number;
  wsSessionRevalidateIntervalMs?: number;
  wsHeartbeatIntervalMs?: number;
  wsMaxPayloadBytes?: number;
  logFileEnabled?: boolean;
  logRetentionDays?: number;
  acpEnableFsWrite?: boolean;
  acpEnableTerminal?: boolean;
  storageMaxDbSizeMb?: number;
  authAllowSignup?: boolean;
}

interface BootAllowlistsResponse {
  mode: "standard" | "compiled";
  sourcePath?: string;
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedTerminalCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  commonSettings?: BootCommonSettings;
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

// Validation constraints for common settings
const COMMON_SETTINGS_CONSTRAINTS = {
  wsAuthTimeoutMs: {
    min: 1000,
    max: 60_000,
    label: "WS Auth Timeout",
    unit: "ms",
  },
  wsSessionRevalidateIntervalMs: {
    min: 10_000,
    max: 3_600_000,
    label: "WS Session Revalidate Interval",
    unit: "ms",
  },
  wsHeartbeatIntervalMs: {
    min: 5000,
    max: 300_000,
    label: "WS Heartbeat Interval",
    unit: "ms",
  },
  wsMaxPayloadBytes: {
    min: 65_536,
    max: 104_857_600,
    label: "WS Max Payload",
    unit: "bytes",
  },
  logRetentionDays: {
    min: 1,
    max: 365,
    label: "Log Retention",
    unit: "days",
  },
  storageMaxDbSizeMb: {
    min: 10,
    max: 50_000,
    label: "Max DB Size",
    unit: "MB",
  },
} as const;

type NumericSettingKey = keyof typeof COMMON_SETTINGS_CONSTRAINTS;

interface CommonSettingsErrors {
  [key: string]: string;
}

function validateCommonSettingsClient(
  settings: BootCommonSettings
): CommonSettingsErrors {
  const errors: CommonSettingsErrors = {};

  // Validate numeric fields
  for (const [key, constraint] of Object.entries(COMMON_SETTINGS_CONSTRAINTS)) {
    const value = settings[key as NumericSettingKey];
    if (value === undefined || value === null) {
      continue;
    }
    if (!Number.isInteger(value)) {
      errors[key] = "Must be an integer.";
      continue;
    }
    if (value < constraint.min) {
      errors[key] =
        `Min: ${constraint.min.toLocaleString()} ${constraint.unit}`;
      continue;
    }
    if (value > constraint.max) {
      errors[key] =
        `Max: ${constraint.max.toLocaleString()} ${constraint.unit}`;
    }
  }

  // Cross-field validations
  if (
    settings.wsHeartbeatIntervalMs !== undefined &&
    settings.wsSessionRevalidateIntervalMs !== undefined &&
    settings.wsHeartbeatIntervalMs >= settings.wsSessionRevalidateIntervalMs
  ) {
    errors.wsHeartbeatIntervalMs = "Must be less than Revalidate Interval.";
  }

  return errors;
}

function formatConstraintHint(key: NumericSettingKey): string {
  const c = COMMON_SETTINGS_CONSTRAINTS[key];
  return `${c.min.toLocaleString()}–${c.max.toLocaleString()} ${c.unit}`;
}

interface NumericSettingInputProps {
  settingKey: NumericSettingKey;
  label: string;
  placeholder: string;
  value: number | undefined;
  error: string | undefined;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  showRestart?: boolean;
}

function NumericSettingInput({
  settingKey,
  label,
  placeholder,
  value,
  error,
  onChange,
  showRestart = true,
}: NumericSettingInputProps) {
  const constraint = COMMON_SETTINGS_CONSTRAINTS[settingKey];
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-widest">
        {label} {showRestart ? <span className="text-amber-600">*</span> : null}
      </span>
      <input
        className={`input-underline w-full ${error ? "border-red-500" : ""}`}
        max={constraint.max}
        min={constraint.min}
        onChange={onChange}
        placeholder={placeholder}
        type="number"
        value={value ?? ""}
      />
      <span className="mt-1 block font-mono text-[9px] text-muted">
        {formatConstraintHint(settingKey)}
      </span>
      {error ? (
        <span className="mt-1 block font-mono text-[10px] text-red-600">
          {error}
        </span>
      ) : null}
    </label>
  );
}

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
    (id: string) =>
    (nextDraft: CommandPolicyDraft): void => {
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
  const [commonSettings, setCommonSettings] = useState<BootCommonSettings>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agentRowErrors, setAgentRowErrors] = useState<Record<string, string>>(
    {}
  );
  const [terminalRowErrors, setTerminalRowErrors] = useState<
    Record<string, string>
  >({});
  const [commonSettingsErrors, setCommonSettingsErrors] =
    useState<CommonSettingsErrors>({});

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
      setCommonSettings(data.commonSettings ?? {});
      setWarnings(data.warnings ?? []);
      setAgentRowErrors({});
      setTerminalRowErrors({});
      setCommonSettingsErrors({});
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
    setEnvKeys(envKeys.filter((entry) => entry.trim() !== keyToRemove.trim()));
  };

  const handleClearEnvKeys = () => {
    setEnvKeys([]);
  };

  const handleCommonSettingChange =
    <K extends keyof BootCommonSettings>(key: K) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      if (input.type === "checkbox") {
        setCommonSettings((prev) => {
          const next = { ...prev, [key]: input.checked };
          // Clear error for this field on change
          setCommonSettingsErrors((errs) => {
            const copy = { ...errs };
            delete copy[key];
            return copy;
          });
          return next;
        });
      } else {
        const rawValue = input.value.trim();
        if (rawValue === "") {
          setCommonSettings((prev) => {
            const next = { ...prev, [key]: undefined };
            setCommonSettingsErrors(validateCommonSettingsClient(next));
            return next;
          });
          return;
        }
        const num = Number.parseInt(rawValue, 10);
        setCommonSettings((prev) => {
          const next = {
            ...prev,
            [key]: Number.isFinite(num) ? num : prev[key],
          };
          setCommonSettingsErrors(validateCommonSettingsClient(next));
          return next;
        });
      }
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

    // Validate common settings
    const commonSettingsValidation =
      validateCommonSettingsClient(commonSettings);
    setCommonSettingsErrors(commonSettingsValidation);

    const nextEnvKeys = [...new Set(envKeys.map((entry) => entry.trim()))]
      .filter((entry) => entry.length > 0)
      .filter((entry) => entry !== "*");

    const commonSettingsIssues = Object.entries(commonSettingsValidation).map(
      ([key, msg]) => {
        const constraint =
          COMMON_SETTINGS_CONSTRAINTS[key as NumericSettingKey];
        return constraint ? `${constraint.label}: ${msg}` : `${key}: ${msg}`;
      }
    );

    const issues = [
      ...agentValidation.issues,
      ...terminalValidation.issues,
      ...commonSettingsIssues,
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
          commonSettings,
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
      setCommonSettings(data.commonSettings ?? {});
      setWarnings(data.warnings ?? []);
      setNotice("Command allowlists saved. Runtime policy has been reloaded.");
      setAgentRowErrors({});
      setTerminalRowErrors({});
      setCommonSettingsErrors({});
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

          {/* Common Boot Settings Section */}
          <section className="border border-ink bg-[#f8f8f4]">
            <div className="border-ink border-b px-4 py-3">
              <h3 className="font-black font-display text-2xl leading-none tracking-tight">
                Common Boot Settings
              </h3>
              <p className="mt-2 font-body text-muted text-sm leading-relaxed">
                Adjust timeouts, limits, and feature toggles. Some settings
                require a server restart.
              </p>
            </div>

            <div className="space-y-4 p-4">
              {/* WebSocket Settings */}
              <div className="border border-ink bg-white p-4">
                <span className="mb-3 block w-max border border-ink bg-[#f0f0ec] px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
                  WebSocket
                </span>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <NumericSettingInput
                    error={commonSettingsErrors.wsAuthTimeoutMs}
                    label="Auth Timeout (ms)"
                    onChange={handleCommonSettingChange("wsAuthTimeoutMs")}
                    placeholder="5000"
                    settingKey="wsAuthTimeoutMs"
                    value={commonSettings.wsAuthTimeoutMs}
                  />
                  <NumericSettingInput
                    error={commonSettingsErrors.wsSessionRevalidateIntervalMs}
                    label="Revalidate Interval (ms)"
                    onChange={handleCommonSettingChange(
                      "wsSessionRevalidateIntervalMs"
                    )}
                    placeholder="60000"
                    settingKey="wsSessionRevalidateIntervalMs"
                    value={commonSettings.wsSessionRevalidateIntervalMs}
                  />
                  <NumericSettingInput
                    error={commonSettingsErrors.wsHeartbeatIntervalMs}
                    label="Heartbeat Interval (ms)"
                    onChange={handleCommonSettingChange(
                      "wsHeartbeatIntervalMs"
                    )}
                    placeholder="30000"
                    settingKey="wsHeartbeatIntervalMs"
                    value={commonSettings.wsHeartbeatIntervalMs}
                  />
                  <NumericSettingInput
                    error={commonSettingsErrors.wsMaxPayloadBytes}
                    label="Max Payload (bytes)"
                    onChange={handleCommonSettingChange("wsMaxPayloadBytes")}
                    placeholder="10485760"
                    settingKey="wsMaxPayloadBytes"
                    value={commonSettings.wsMaxPayloadBytes}
                  />
                </div>
              </div>

              {/* ACP Feature Toggles */}
              <div className="border border-ink bg-white p-4">
                <span className="mb-3 block w-max border border-ink bg-[#f0f0ec] px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
                  ACP Capabilities
                </span>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 border border-ink bg-[#f8f8f4] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">
                    <input
                      checked={commonSettings.acpEnableFsWrite ?? true}
                      onChange={handleCommonSettingChange("acpEnableFsWrite")}
                      type="checkbox"
                    />
                    Enable File System Write
                  </label>
                  <label className="flex items-center gap-2 border border-ink bg-[#f8f8f4] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">
                    <input
                      checked={commonSettings.acpEnableTerminal ?? true}
                      onChange={handleCommonSettingChange("acpEnableTerminal")}
                      type="checkbox"
                    />
                    Enable Terminal
                  </label>
                  <label className="flex items-center gap-2 border border-ink bg-[#f8f8f4] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">
                    <input
                      checked={commonSettings.authAllowSignup ?? true}
                      onChange={handleCommonSettingChange("authAllowSignup")}
                      type="checkbox"
                    />
                    Allow Signup <span className="text-amber-600">*</span>
                  </label>
                </div>
              </div>

              {/* Storage & Logging */}
              <div className="border border-ink bg-white p-4">
                <span className="mb-3 block w-max border border-ink bg-[#f0f0ec] px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
                  Storage & Logging
                </span>
                <div className="grid gap-4 md:grid-cols-3">
                  <NumericSettingInput
                    error={commonSettingsErrors.storageMaxDbSizeMb}
                    label="Max DB Size (MB)"
                    onChange={handleCommonSettingChange("storageMaxDbSizeMb")}
                    placeholder="500"
                    settingKey="storageMaxDbSizeMb"
                    value={commonSettings.storageMaxDbSizeMb}
                  />
                  <label className="mt-5 flex items-center gap-2 border border-ink bg-[#f8f8f4] px-3 py-2 font-mono text-[10px] uppercase tracking-widest">
                    <input
                      checked={commonSettings.logFileEnabled ?? false}
                      onChange={handleCommonSettingChange("logFileEnabled")}
                      type="checkbox"
                    />
                    Enable File Logging{" "}
                    <span className="text-amber-600">*</span>
                  </label>
                  <NumericSettingInput
                    error={commonSettingsErrors.logRetentionDays}
                    label="Log Retention (days)"
                    onChange={handleCommonSettingChange("logRetentionDays")}
                    placeholder="7"
                    settingKey="logRetentionDays"
                    value={commonSettings.logRetentionDays}
                  />
                </div>
              </div>

              <p className="font-mono text-[10px] text-muted uppercase tracking-widest">
                <span className="text-amber-600">*</span> Changes require server
                restart to take effect. ACP capabilities apply immediately.
              </p>
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
