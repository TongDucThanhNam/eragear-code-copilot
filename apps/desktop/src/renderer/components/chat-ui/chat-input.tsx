// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import type {
  SessionConfigOption,
  SupervisorDecisionSummary,
  SupervisorSessionState,
} from "@eragear-code-copilot/shared";
import {
  CheckIcon,
  ChevronDown,
  FileTextIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type MouseEvent,
  memo,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandInput,
  PromptInputCommandList,
  PromptInputCommandSeparator,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { CommandDialog } from "@/components/ui/command";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MovingBorder } from "@/components/ui/moving-border";
import { ATTACHMENT_HARD_LIMIT_BYTES } from "@/config/attachments";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/store/file-store";
import { MentionMenu } from "./chat-input/mention-menu";
import {
  ProjectMemoryActionMenu,
  type ProjectMemoryMenuPreset,
  type ProjectMemoryMenuSource,
} from "./chat-input/project-memory-action-menu";
import {
  areStringArraysEqual,
  buildMentionItems,
  findMentionTrigger,
  MAX_QUICK_SLASH_COMMANDS,
  MAX_RECENT_SLASH_COMMANDS,
  normalizeConfigOptions,
  normalizeModelProviders,
  parseRecentSlashCommandNames,
  readRecentSlashCommandNames,
  SLASH_COMMAND_RECENTS_STORAGE_KEY,
} from "./chat-input/shared";
import { SlashCommandActionMenuItem } from "./chat-input/slash-command-action-menu-item";
import { SlashCommandInlinePopup } from "./chat-input/slash-command-inline-popup";
import { SlashCommandPaletteItem } from "./chat-input/slash-command-palette-item";
import {
  isPromptSubmitDisabled,
  resolvePromptInputSubmitStatus,
} from "./chat-input-submit-status";
import type { SlashCommand, SlashCommandPopupRef } from "./slash-command-popup";
import { SupervisorControl } from "./supervisor-control";

export type ChatInputStatus =
  | "inactive"
  | "connecting"
  | "ready"
  | "submitted"
  | "streaming"
  | "awaiting_permission"
  | "cancelling"
  | "error";
export type ConnStatus = "idle" | "connecting" | "connected" | "error";

export interface ChatInputProps {
  chatId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  status: ChatInputStatus;
  connStatus: ConnStatus;
  availableModes: { id: string; name: string; description?: string }[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: Array<{
    modelId: string;
    name: string;
    description?: string | null;
    provider?: string;
    providers?: string[];
  }>;
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  availableConfigOptions: SessionConfigOption[];
  onConfigOptionChange: (configId: string, value: string) => void;
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  // Supervisor props
  supervisor: SupervisorSessionState | null;
  supervisorCapable: boolean;
  isSettingSupervisorMode: boolean;
  lastSupervisorDecision: SupervisorDecisionSummary | null;
  onSetSupervisorMode: (mode: "off" | "full_autopilot") => Promise<void>;
  // Context Props
  activeTabs?: { path: string }[];
  projectRules?: { path: string; location: string }[];
  availableCommands?: SlashCommand[];
  projectMemoryPresets?: ProjectMemoryMenuPreset[];
  projectMemorySources?: ProjectMemoryMenuSource[];
  contextUsageRevision?: number;
  onCancel?: () => void;
  imageInputSupported?: boolean;
}

const CONTEXT_USAGE_DEBOUNCE_MS = 350;
interface ContextUsageIndicatorProps {
  chatId: string;
  currentModelId: string | null;
  mentionCount: number;
  revision: number;
}

function ContextUsageIndicator({
  chatId,
  currentModelId,
  mentionCount,
  revision,
}: ContextUsageIndicatorProps) {
  const controller = usePromptInputController();
  const attachments = usePromptInputAttachments();
  const draftValue = controller.textInput.value;
  const [debouncedDraftText, setDebouncedDraftText] = useState(draftValue);
  const attachmentStats = useMemo(
    () =>
      attachments.files.reduce(
        (stats, file) => ({
          count: stats.count + 1,
          bytes: stats.bytes + (file.file?.size ?? 0),
        }),
        { count: 0, bytes: 0 }
      ),
    [attachments.files]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDraftText(draftValue);
    }, CONTEXT_USAGE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draftValue]);

  const estimateInput = useMemo(
    () => ({
      chatId,
      draftText: debouncedDraftText,
      attachmentCount: attachmentStats.count,
      attachmentBytes: attachmentStats.bytes,
      mentionCount,
      ...(currentModelId ? { modelId: currentModelId } : {}),
    }),
    [
      attachmentStats.bytes,
      attachmentStats.count,
      chatId,
      currentModelId,
      debouncedDraftText,
      mentionCount,
    ]
  );
  const estimateQuery = trpc.contextUsage.estimate.useQuery(estimateInput, {
    enabled: Boolean(chatId),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 1000,
  });
  const { refetch } = estimateQuery;

  useEffect(() => {
    if (!chatId || revision <= 0) {
      return;
    }
    void refetch();
  }, [chatId, refetch, revision]);

  const estimate = estimateQuery.data;
  if (!estimate) {
    return null;
  }

  const contextModelId = currentModelId ?? estimate.modelId;

  return (
    <Context
      maxTokens={estimate.maxTokens}
      modelId={contextModelId ?? undefined}
      usedTokens={estimate.usedTokens}
    >
      <ContextTrigger
        aria-label="Show context usage"
        className={cn(
          "h-8 gap-1.5 px-2 text-muted-foreground text-xs",
          estimate.status === "warn" && "text-amber-600 dark:text-amber-400",
          estimate.status === "compact" &&
            "text-orange-600 dark:text-orange-400",
          estimate.status === "overflow" && "text-destructive"
        )}
      />
      <ContextContent align="end" className="w-72" side="top">
        <ContextContentHeader />
        <ContextContentBody className="space-y-2">
          <ContextUsageRow
            label="History"
            value={formatCompactTokens(estimate.breakdown.historyTokens)}
          />
          <ContextUsageRow
            label="Draft"
            value={formatCompactTokens(estimate.breakdown.draftTokens)}
          />
          <ContextUsageRow
            label="Attachments"
            value={formatCompactTokens(estimate.breakdown.attachmentTokens)}
          />
          <ContextUsageRow
            label="Mentions"
            value={formatCompactTokens(estimate.breakdown.mentionTokens)}
          />
          <ContextUsageRow
            className="pt-1"
            label="Remaining"
            value={formatCompactTokens(Math.max(0, estimate.remainingTokens))}
          />
          <div
            className={cn(
              "pt-1 text-muted-foreground text-xs",
              estimate.status === "warn" &&
                "text-amber-600 dark:text-amber-400",
              estimate.status === "compact" &&
                "text-orange-600 dark:text-orange-400",
              estimate.status === "overflow" && "text-destructive"
            )}
          >
            {estimate.truncatedHistory
              ? "History is already compacted for this model window."
              : "Local estimate includes history, draft, files, and mentions."}
          </div>
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}

function ContextUsageRow({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-xs",
        className
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function formatCompactTokens(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

export const ChatInput = memo(function ChatInput({
  chatId,
  textareaRef,
  status,
  connStatus,
  availableModes,
  currentModeId,
  onModeChange,
  availableModels,
  currentModelId,
  onModelChange,
  availableConfigOptions,
  onConfigOptionChange,
  onSubmit,
  supervisor,
  supervisorCapable,
  isSettingSupervisorMode,
  lastSupervisorDecision,
  onSetSupervisorMode,
  activeTabs = [],
  projectRules = [],
  availableCommands = [],
  projectMemoryPresets = [],
  projectMemorySources = [],
  contextUsageRevision = 0,
  onCancel,
  imageInputSupported = false,
}: ChatInputProps) {
  const files = useFileStore((state) => state.files);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [mentions, setMentions] = useState<{ id: string; path: string }[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const deferredMentionQuery = useDeferredValue(mentionQuery);
  const [slashCommandPickerOpen, setSlashCommandPickerOpen] = useState(false);
  const [recentSlashCommandNames, setRecentSlashCommandNames] = useState<
    string[]
  >(readRecentSlashCommandNames);
  const slashPopupRef = useRef<SlashCommandPopupRef | null>(null);
  const mentionSelectRef = useRef<((index?: number) => void) | null>(null);

  const modelsWithDetails = useMemo(
    () =>
      availableModels.map((model) => {
        const providers = normalizeModelProviders(model);
        const primaryProvider = providers[0];
        return {
          ...model,
          id: model.modelId,
          groupLabel: primaryProvider?.toUpperCase() ?? "MODELS",
          provider: primaryProvider,
          providers,
        };
      }),
    [availableModels]
  );

  // Limit rendered model items to prevent UI freeze with large lists
  const MODEL_SELECTOR_SEARCH_LIMIT = 50;
  /** Runtime cap for model list sent to clients. Must match DEFAULT_MAX_VISIBLE_MODEL_COUNT in packages/runtime/src/config/constants.ts */
  const MODEL_LIST_SERVER_CAP = 100;
  const [modelSelectorSearch, setModelSelectorSearch] = useState("");
  const deferredModelSelectorSearch = useDeferredValue(modelSelectorSearch);

  // Show capped indicator when model list is at or above the server cap
  const showCappedIndicator = useMemo(
    () => availableModels.length >= MODEL_LIST_SERVER_CAP,
    [availableModels.length]
  );

  const modelGroups = useMemo(() => {
    const out = new Map<string, typeof modelsWithDetails>();
    for (const model of modelsWithDetails) {
      const group = out.get(model.groupLabel);
      if (group) {
        group.push(model);
        continue;
      }
      out.set(model.groupLabel, [model]);
    }
    return [...out.entries()];
  }, [modelsWithDetails]);

  // Step 1: filter on FULL dataset before any capping
  const fullFilteredGroups = useMemo(() => {
    const search = deferredModelSelectorSearch.toLowerCase();
    const result: [string, typeof modelsWithDetails, number][] = []; // [groupLabel, filteredModels, totalInGroup]

    for (const [groupLabel, models] of modelGroups) {
      const filteredModels = search
        ? models.filter(
            (m) =>
              m.id.toLowerCase().includes(search) ||
              m.name.toLowerCase().includes(search) ||
              (m.provider ?? "").toLowerCase().includes(search)
          )
        : [...models];

      if (filteredModels.length > 0) {
        result.push([groupLabel, filteredModels, models.length]);
      }
    }

    return result;
  }, [modelGroups, deferredModelSelectorSearch]);

  // Step 2: cap the filtered result for rendering, keeping current model visible
  const renderedModelGroups = useMemo(() => {
    const result: [string, typeof modelsWithDetails, number][] = [];
    let itemCount = 0;

    for (const [
      groupLabel,
      filteredModels,
      totalInGroup,
    ] of fullFilteredGroups) {
      if (itemCount >= MODEL_SELECTOR_SEARCH_LIMIT) {
        break;
      }

      // Check if current model is in filteredModels
      const currentModelIndex = filteredModels.findIndex(
        (m) => m.id === currentModelId
      );

      if (currentModelIndex !== -1) {
        // current model is in filtered set — include it and fill remaining slots
        const modelsBeforeCurrent = filteredModels.slice(0, currentModelIndex);
        const modelsAfterCurrent = filteredModels.slice(currentModelIndex + 1);

        // Take up to (limit - 1) from before current
        const beforeTaken = modelsBeforeCurrent.slice(
          0,
          MODEL_SELECTOR_SEARCH_LIMIT - itemCount - 1
        );
        // Then fill from after
        const remainingSlots =
          MODEL_SELECTOR_SEARCH_LIMIT - itemCount - 1 - beforeTaken.length;
        const afterTaken = modelsAfterCurrent.slice(0, remainingSlots);

        result.push([
          groupLabel,
          [...beforeTaken, filteredModels[currentModelIndex], ...afterTaken],
          totalInGroup,
        ]);
        itemCount += beforeTaken.length + 1 + afterTaken.length;
      } else if (
        itemCount + filteredModels.length <=
        MODEL_SELECTOR_SEARCH_LIMIT
      ) {
        // current model not in filtered set; take all filtered
        result.push([groupLabel, filteredModels, totalInGroup]);
        itemCount += filteredModels.length;
      } else {
        // current model not in filtered set AND we're at the boundary
        // Still add the current model for discoverability even if not in search results
        const taken = [
          ...filteredModels.slice(
            0,
            MODEL_SELECTOR_SEARCH_LIMIT - itemCount - 1
          ),
        ];
        // Note: we intentionally do NOT force-add the non-matching current model
        // because that would produce a confusing UX (selected model doesn't match search).
        // The user can clear search to see all models.
        if (taken.length > 0) {
          result.push([groupLabel, taken, totalInGroup]);
          itemCount += taken.length;
        }
      }
    }

    return result;
  }, [fullFilteredGroups, currentModelId]);

  // For hint: total filtered count across all groups (before cap)
  const totalFilteredCount = useMemo(
    () =>
      fullFilteredGroups.reduce(
        (acc, [, filtered]) => acc + filtered.length,
        0
      ),
    [fullFilteredGroups]
  );
  const customModelId = deferredModelSelectorSearch.trim();
  const canUseCustomModel = useMemo(() => {
    if (!customModelId) {
      return false;
    }
    const normalized = customModelId.toLowerCase();
    return !modelsWithDetails.some(
      (model) =>
        model.id.toLowerCase() === normalized ||
        model.name.toLowerCase() === normalized
    );
  }, [customModelId, modelsWithDetails]);
  const selectedModelData =
    modelsWithDetails.find((m) => m.id === currentModelId) ??
    (currentModelId
      ? {
          id: currentModelId,
          modelId: currentModelId,
          name: currentModelId,
          description: "Selected model",
          groupLabel: "MODELS",
          provider: undefined,
          providers: [],
        }
      : undefined);
  const configSelectors = useMemo(
    () => normalizeConfigOptions(availableConfigOptions),
    [availableConfigOptions]
  );
  const hasModeConfigOption = configSelectors.some(
    (option) => option.category === "mode"
  );
  const hasModelConfigOption = configSelectors.some(
    (option) => option.category === "model"
  );
  const slashCommands = useMemo(() => {
    const seen = new Set<string>();
    return availableCommands.filter((command) => {
      if (seen.has(command.name)) {
        return false;
      }
      seen.add(command.name);
      return true;
    });
  }, [availableCommands]);
  const slashCommandsByName = useMemo(
    () => new Map(slashCommands.map((command) => [command.name, command])),
    [slashCommands]
  );
  const recentSlashCommands = useMemo(
    () =>
      recentSlashCommandNames
        .map((name) => slashCommandsByName.get(name))
        .filter((command): command is SlashCommand => Boolean(command)),
    [recentSlashCommandNames, slashCommandsByName]
  );
  const quickSlashCommands = useMemo(() => {
    const selected: SlashCommand[] = [];
    const selectedNames = new Set<string>();

    for (const command of recentSlashCommands) {
      if (selectedNames.has(command.name)) {
        continue;
      }
      selected.push(command);
      selectedNames.add(command.name);
      if (selected.length >= MAX_QUICK_SLASH_COMMANDS) {
        return selected;
      }
    }

    for (const command of slashCommands) {
      if (selectedNames.has(command.name)) {
        continue;
      }
      selected.push(command);
      selectedNames.add(command.name);
      if (selected.length >= MAX_QUICK_SLASH_COMMANDS) {
        break;
      }
    }

    return selected;
  }, [recentSlashCommands, slashCommands]);
  const remainingSlashCommands = useMemo(() => {
    if (recentSlashCommands.length === 0) {
      return slashCommands;
    }
    const recentNames = new Set(
      recentSlashCommands.map((command) => command.name)
    );
    return slashCommands.filter((command) => !recentNames.has(command.name));
  }, [recentSlashCommands, slashCommands]);
  const showSlashCommandBrowserAction =
    slashCommands.length > quickSlashCommands.length;

  const mentionItems = useMemo(() => {
    return buildMentionItems({
      activeTabs,
      files,
      mentionQuery: deferredMentionQuery,
    });
  }, [activeTabs, deferredMentionQuery, files]);

  useEffect(() => {
    if (!mentionOpen) {
      return;
    }
    setMentionIndex(0);
  }, [mentionOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SLASH_COMMAND_RECENTS_STORAGE_KEY) {
        return;
      }
      const next = parseRecentSlashCommandNames(event.newValue);
      setRecentSlashCommandNames((prev) =>
        areStringArraysEqual(prev, next) ? prev : next
      );
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (recentSlashCommandNames.length === 0) {
      window.localStorage.removeItem(SLASH_COMMAND_RECENTS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      SLASH_COMMAND_RECENTS_STORAGE_KEY,
      JSON.stringify(recentSlashCommandNames)
    );
  }, [recentSlashCommandNames]);

  const addMention = useCallback((path: string) => {
    setMentions((prev) => {
      if (prev.some((item) => item.path === path)) {
        return prev;
      }
      return prev.concat({ id: `${path}-${Date.now()}`, path });
    });
  }, []);

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((item) => item.id !== id));
  }, []);
  const rememberSlashCommand = useCallback((commandName: string) => {
    setRecentSlashCommandNames((prev) => {
      const next = [
        commandName,
        ...prev.filter((name) => name !== commandName),
      ];
      return next.slice(0, MAX_RECENT_SLASH_COMMANDS);
    });
  }, []);

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      const cursor = event.currentTarget.selectionStart ?? value.length;
      const trigger = findMentionTrigger(value, cursor);
      if (trigger) {
        setMentionOpen(true);
        setMentionQuery(trigger.query);
        setMentionStart(trigger.start);
      } else {
        setMentionOpen(false);
        setMentionQuery("");
        setMentionStart(null);
      }

      setMentions((prev) =>
        prev.filter((mention) => value.includes(`@${mention.path}`))
      );
    },
    []
  );

  const handleTextClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      const cursor = event.currentTarget.selectionStart ?? value.length;
      const trigger = findMentionTrigger(value, cursor);
      if (trigger) {
        setMentionOpen(true);
        setMentionQuery(trigger.query);
        setMentionStart(trigger.start);
      } else {
        setMentionOpen(false);
        setMentionQuery("");
        setMentionStart(null);
      }
    },
    []
  );

  const closeMentionMenu = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionStart(null);
  }, []);

  const handleTextKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashPopupRef.current?.handleKeyDown(event)) {
        return;
      }

      if (!mentionOpen) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((prev) =>
          Math.min(prev + 1, Math.max(mentionItems.length - 1, 0))
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        mentionSelectRef.current?.(mentionIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMentionMenu();
        return;
      }
    },
    [closeMentionMenu, mentionIndex, mentionItems.length, mentionOpen]
  );

  const registerMentionSelect = useCallback(
    (fn: ((index?: number) => void) | null) => {
      mentionSelectRef.current = fn;
    },
    []
  );

  const handleSubmitWithMentions = useCallback(
    (message: PromptInputMessage) => {
      const result = onSubmit({
        ...message,
        mentions: mentions.map((mention) => mention.path),
      });

      if (result instanceof Promise) {
        return result.then(() => {
          setMentions([]);
        });
      }
      setMentions([]);
      return result;
    },
    [mentions, onSubmit]
  );

  const handleAttachmentError = useCallback(
    (err: {
      code: "max_files" | "max_file_size" | "accept";
      message: string;
    }) => toast.error(err.message),
    []
  );

  // Supervisor visibility gate debug — logs inputs that control SupervisorControl render
  useEffect(() => {
    const willRender = connStatus === "connected" && supervisorCapable;
    console.debug(
      `[SupervisorDebug] visibility inputs — connStatus=${connStatus} supervisorCapable=${supervisorCapable} supervisorMode=${supervisor?.mode ?? "null"} supervisorStatus=${supervisor?.status ?? "null"} supervisorReason=${supervisor?.reason ?? "null"} willRender=${willRender}`
    );
  }, [connStatus, supervisorCapable, supervisor]);

  const isStreaming = status === "streaming";
  const submitStatus = resolvePromptInputSubmitStatus({
    connStatus,
    status,
  });
  const submitDisabled = isPromptSubmitDisabled({ connStatus, status });

  const promptInputContent = (
    <PromptInput
      accept="image/*"
      globalDrop={imageInputSupported}
      maxFileSize={ATTACHMENT_HARD_LIMIT_BYTES}
      multiple
      onError={handleAttachmentError}
      onSubmit={handleSubmitWithMentions}
    >
      <PromptInputHeader>
        {mentions.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 px-2 py-1">
            {mentions.map((mention) => (
              <div
                className="group flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs"
                key={mention.id}
              >
                <FileTextIcon className="size-3 text-muted-foreground" />
                <span className="max-w-[220px] truncate">{mention.path}</span>
                <Button
                  className="size-5 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(event) => {
                    event.preventDefault();
                    removeMention(mention.id);
                  }}
                  type="button"
                  variant="ghost"
                >
                  <XIcon className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          onChange={handleTextChange}
          onClick={handleTextClick}
          onKeyDown={handleTextKeyDown}
          ref={textareaRef}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent
              className="w-72 p-1"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <PromptInputActionAddAttachments
                disabled={!imageInputSupported}
                label={
                  imageInputSupported ? "Add image" : "Image input unavailable"
                }
              />
              {(projectMemorySources.some((source) => source.enabled) ||
                projectMemoryPresets.length > 0) && (
                <>
                  <DropdownMenuSeparator />
                  <ProjectMemoryActionMenu
                    onCommandApplied={rememberSlashCommand}
                    presets={projectMemoryPresets}
                    sources={projectMemorySources}
                    textareaRef={textareaRef}
                  />
                </>
              )}
              {quickSlashCommands.length > 0 && <DropdownMenuSeparator />}
              {quickSlashCommands.map((cmd) => (
                <SlashCommandActionMenuItem
                  command={cmd}
                  key={cmd.name}
                  onCommandApplied={rememberSlashCommand}
                  textareaRef={textareaRef}
                />
              ))}
              {showSlashCommandBrowserAction && (
                <>
                  <DropdownMenuSeparator />
                  <PromptInputActionMenuItem
                    onSelect={() => setSlashCommandPickerOpen(true)}
                  >
                    <SearchIcon className="size-4 text-muted-foreground" />
                    Browse slash commands...
                  </PromptInputActionMenuItem>
                </>
              )}
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          {connStatus === "connected" && supervisorCapable && (
            <SupervisorControl
              isPending={isSettingSupervisorMode}
              lastDecision={lastSupervisorDecision}
              mode={supervisor?.mode ?? "off"}
              onSetMode={onSetSupervisorMode}
              reason={supervisor?.reason ?? null}
              status={supervisor?.status ?? "idle"}
            />
          )}

          {connStatus === "connected" &&
            configSelectors.map((option) => (
              <PromptInputSelect
                key={option.id}
                onValueChange={(nextValue: string) =>
                  onConfigOptionChange(option.id, nextValue)
                }
                value={option.currentValue}
              >
                <PromptInputSelectTrigger className="h-8 min-w-20 px-2 py-0">
                  <PromptInputSelectValue placeholder={option.name} />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {option.values.map((value) => (
                    <PromptInputSelectItem
                      key={`${value.groupLabel ?? "value"}:${value.value}`}
                      value={value.value}
                    >
                      {value.groupLabel ? `${value.groupLabel} / ` : ""}
                      {value.name}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            ))}

          {connStatus === "connected" &&
            availableModes.length > 0 &&
            !hasModeConfigOption && (
              <PromptInputSelect
                onValueChange={(val: string) => onModeChange(val)}
                value={currentModeId || ""}
              >
                <PromptInputSelectTrigger className="h-8 min-w-17.5 px-2 py-0">
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {availableModes.map((mode) => (
                    <PromptInputSelectItem key={mode.id} value={mode.id}>
                      {mode.name}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            )}

          {connStatus === "connected" &&
            availableModels.length > 0 &&
            !hasModelConfigOption && (
              <ModelSelector
                onOpenChange={setModelSelectorOpen}
                open={modelSelectorOpen}
              >
                <ModelSelectorTrigger asChild>
                  <Button
                    className="h-8 w-50 justify-between"
                    variant="outline"
                  >
                    {selectedModelData?.provider && (
                      <ModelSelectorLogo
                        provider={selectedModelData.provider}
                      />
                    )}
                    {selectedModelData?.name && (
                      <ModelSelectorName>
                        {selectedModelData.name}
                      </ModelSelectorName>
                    )}
                    <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </ModelSelectorTrigger>
                <ModelSelectorContent>
                  <ModelSelectorInput
                    onValueChange={setModelSelectorSearch}
                    placeholder="Search models..."
                    value={modelSelectorSearch}
                  />
                  {showCappedIndicator && (
                    <div
                      aria-live="polite"
                      className="px-3 py-1.5 text-muted-foreground text-xs"
                    >
                      Showing top {MODEL_LIST_SERVER_CAP} models. Search to find
                      more.
                    </div>
                  )}
                  {totalFilteredCount < modelsWithDetails.length && (
                    <div className="px-3 py-1.5 text-muted-foreground text-xs">
                      Showing{" "}
                      {renderedModelGroups.reduce(
                        (acc, [, m]) => acc + m.length,
                        0
                      )}{" "}
                      of {modelsWithDetails.length} models — type to search…
                    </div>
                  )}
                  <ModelSelectorList>
                    <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                    {canUseCustomModel && (
                      <ModelSelectorGroup heading="Custom">
                        <ModelSelectorItem
                          key={`custom:${customModelId}`}
                          onSelect={() => {
                            onModelChange(customModelId);
                            setModelSelectorOpen(false);
                          }}
                          value={customModelId}
                        >
                          <ModelSelectorName>
                            Use {customModelId}
                          </ModelSelectorName>
                        </ModelSelectorItem>
                      </ModelSelectorGroup>
                    )}
                    {renderedModelGroups.map(([groupLabel, models]) => (
                      <ModelSelectorGroup heading={groupLabel} key={groupLabel}>
                        {models.map((model) => (
                          <ModelSelectorItem
                            key={model.id}
                            onSelect={() => {
                              onModelChange(model.id);
                              setModelSelectorOpen(false);
                            }}
                            value={model.id}
                          >
                            {model.provider && (
                              <ModelSelectorLogo provider={model.provider} />
                            )}
                            <ModelSelectorName>{model.name}</ModelSelectorName>
                            {model.providers.length > 0 && (
                              <ModelSelectorLogoGroup>
                                {model.providers.map((provider) => (
                                  <ModelSelectorLogo
                                    key={provider}
                                    provider={provider}
                                  />
                                ))}
                              </ModelSelectorLogoGroup>
                            )}
                            {currentModelId === model.id ? (
                              <CheckIcon className="ml-auto size-4" />
                            ) : (
                              <div className="ml-auto size-4" />
                            )}
                          </ModelSelectorItem>
                        ))}
                      </ModelSelectorGroup>
                    ))}
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector>
            )}
        </PromptInputTools>
        <div className="flex items-center gap-1">
          <ContextUsageIndicator
            chatId={chatId}
            currentModelId={currentModelId}
            mentionCount={mentions.length}
            revision={contextUsageRevision}
          />
          <PromptInputSubmit
            disabled={submitDisabled}
            onStop={onCancel}
            status={submitStatus}
          />
        </div>
      </PromptInputFooter>
      {slashCommands.length > 0 && (
        <SlashCommandInlinePopup
          commands={slashCommands}
          onCommandApplied={rememberSlashCommand}
          popupRef={slashPopupRef}
          textareaRef={textareaRef}
        />
      )}
      {slashCommands.length > 0 && (
        <CommandDialog
          className="max-w-[calc(100%-2rem)] p-0 sm:max-w-xl"
          description="Search and insert slash commands into the input"
          onOpenChange={setSlashCommandPickerOpen}
          open={slashCommandPickerOpen}
          title="Slash Commands"
        >
          <PromptInputCommand className="w-full">
            <PromptInputCommandInput
              autoFocus
              className="border-none focus-visible:ring-0"
              placeholder="Search slash commands..."
            />
            <PromptInputCommandList className="max-h-[60vh]">
              <PromptInputCommandEmpty className="p-3 text-muted-foreground text-sm">
                No commands found.
              </PromptInputCommandEmpty>
              {recentSlashCommands.length > 0 && (
                <>
                  <PromptInputCommandGroup heading="Recent">
                    {recentSlashCommands.map((command) => (
                      <SlashCommandPaletteItem
                        command={command}
                        key={`recent:${command.name}`}
                        onClose={() => setSlashCommandPickerOpen(false)}
                        onCommandApplied={rememberSlashCommand}
                        textareaRef={textareaRef}
                      />
                    ))}
                  </PromptInputCommandGroup>
                  {remainingSlashCommands.length > 0 && (
                    <PromptInputCommandSeparator />
                  )}
                </>
              )}
              {remainingSlashCommands.length > 0 && (
                <PromptInputCommandGroup
                  heading={
                    recentSlashCommands.length > 0 ? "All commands" : "Commands"
                  }
                >
                  {remainingSlashCommands.map((command) => (
                    <SlashCommandPaletteItem
                      command={command}
                      key={`all:${command.name}`}
                      onClose={() => setSlashCommandPickerOpen(false)}
                      onCommandApplied={rememberSlashCommand}
                      textareaRef={textareaRef}
                    />
                  ))}
                </PromptInputCommandGroup>
              )}
            </PromptInputCommandList>
          </PromptInputCommand>
        </CommandDialog>
      )}
    </PromptInput>
  );

  return (
    <div className="relative w-full px-2 py-2">
      <PromptInputProvider>
        <div className="relative">
          {isStreaming ? (
            <MovingBorder borderRadius="0" borderWidth={1} duration={4}>
              {promptInputContent}
            </MovingBorder>
          ) : (
            <div className="relative">{promptInputContent}</div>
          )}
          <MentionMenu
            activeIndex={mentionIndex}
            items={mentionItems}
            mentionStart={mentionStart}
            onActiveIndexChange={setMentionIndex}
            onAddMention={addMention}
            onClose={closeMentionMenu}
            open={mentionOpen}
            registerSelect={registerMentionSelect}
            textareaRef={textareaRef}
          />
        </div>
      </PromptInputProvider>
    </div>
  );
});
