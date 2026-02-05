"use client";

import {
  CheckIcon,
  ChevronDown,
  Command,
  FileTextIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type MouseEvent,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
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
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandInput,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputHoverCard,
  PromptInputHoverCardContent,
  PromptInputHoverCardTrigger,
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
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { MovingBorder } from "@/components/ui/moving-border";
import { ATTACHMENT_HARD_LIMIT_BYTES } from "@/config/attachments";
import { cn } from "@/lib/utils";
import { useFileStore } from "@/store/file-store";
import type { SlashCommand } from "./slash-command-popup";

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
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  status: ChatInputStatus;
  connStatus: ConnStatus;
  availableModes: { id: string; name: string; description?: string }[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: { modelId: string; name: string; description?: string }[];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  // Context Props
  activeTabs?: { path: string }[];
  projectRules?: { path: string; location: string }[];
  availableCommands?: SlashCommand[];
  onCancel?: () => void;
}

// Inner component for @ menu command items with controller access
function SlashCommandMenuItem({
  command,
  textareaRef,
}: {
  command: SlashCommand;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const controller = usePromptInputController();

  const handleSelect = useCallback(() => {
    const commandText = `/${command.name} `;
    controller.textInput.setInput(commandText);
    if (textareaRef.current) {
      textareaRef.current.focus();
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = commandText.length;
          textareaRef.current.selectionEnd = commandText.length;
        }
      }, 0);
    }
  }, [command.name, controller.textInput, textareaRef]);

  return (
    <PromptInputCommandItem onSelect={handleSelect}>
      <span>/{command.name}</span>
      <span className="ml-2 text-muted-foreground text-xs">
        - {command.description}
      </span>
    </PromptInputCommandItem>
  );
}

type MentionItem = {
  path: string;
  name: string;
  dir: string;
};

const findMentionTrigger = (value: string, cursor: number) => {
  const upToCursor = value.slice(0, cursor);
  const atIndex = upToCursor.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }

  const before = upToCursor.slice(0, atIndex);
  if (before.length > 0 && !/\\s/.test(before.slice(-1))) {
    return null;
  }

  const query = upToCursor.slice(atIndex + 1);
  if (query.includes(" ") || query.includes("\\n")) {
    return null;
  }

  return { start: atIndex, query };
};

function MentionMenu({
  open,
  items,
  activeIndex,
  onActiveIndexChange,
  mentionStart,
  textareaRef,
  onAddMention,
  onClose,
  registerSelect,
}: {
  open: boolean;
  items: MentionItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  mentionStart: number | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onAddMention: (path: string) => void;
  onClose: () => void;
  registerSelect: (fn: ((index?: number) => void) | null) => void;
}) {
  const controller = usePromptInputController();

  const handleSelect = useCallback(
    (path: string) => {
      const textarea = textareaRef.current;
      if (!textarea || mentionStart === null) {
        return;
      }

      const value = controller.textInput.value;
      const cursor = textarea.selectionStart ?? value.length;
      const before = value.slice(0, mentionStart);
      const after = value.slice(cursor);
      const mentionText = `@${path}`;
      const nextValue = `${before}${mentionText} ${after}`;

      controller.textInput.setInput(nextValue);
      onAddMention(path);
      onClose();

      requestAnimationFrame(() => {
        const pos = before.length + mentionText.length + 1;
        textarea.focus();
        textarea.selectionStart = pos;
        textarea.selectionEnd = pos;
      });
    },
    [controller.textInput, mentionStart, onAddMention, onClose, textareaRef]
  );

  const selectAtIndex = useCallback(
    (index?: number) => {
      const targetIndex = index ?? activeIndex;
      const item = items[targetIndex];
      if (item) {
        handleSelect(item.path);
      }
    },
    [activeIndex, handleSelect, items]
  );

  useEffect(() => {
    registerSelect(selectAtIndex);
    return () => registerSelect(null);
  }, [registerSelect, selectAtIndex]);

  if (!open) {
    return null;
  }

  return (
    <div className="absolute right-2 bottom-full left-2 z-50 mb-2">
      <div className="rounded-lg border bg-popover shadow-lg">
        <div className="max-h-72 overflow-auto p-1">
          {items.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-sm">
              No matching files.
            </div>
          ) : (
            items.map((item, index) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/60"
                )}
                key={item.path}
                onClick={() => handleSelect(item.path)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onActiveIndexChange(index)}
                type="button"
              >
                <div className="flex size-7 items-center justify-center rounded-md border bg-muted/60">
                  <FileTextIcon className="size-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  {item.dir && (
                    <div className="truncate text-muted-foreground text-xs">
                      {item.dir}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const ChatInputBase = ({
  textareaRef,
  status,
  connStatus,
  availableModes,
  currentModeId,
  onModeChange,
  availableModels,
  currentModelId,
  onModelChange,
  onSubmit,
  activeTabs = [],
  projectRules = [],
  availableCommands = [],
  onCancel,
}: ChatInputProps) => {
  const files = useFileStore((state) => state.files);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [mentions, setMentions] = useState<{ id: string; path: string }[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionSelectRef = useRef<((index?: number) => void) | null>(null);

  const getProviderFromModelId = (modelId: string) => {
    if (modelId.startsWith("anthropic")) {
      return "anthropic";
    }
    if (modelId.startsWith("google") || modelId.startsWith("gemini")) {
      return "google";
    }
    if (modelId.startsWith("openai") || modelId.startsWith("gpt")) {
      return "openai";
    }
    if (modelId.startsWith("deepseek")) {
      return "deepseek";
    }
    if (modelId.startsWith("mistral")) {
      return "mistral";
    }
    if (modelId.startsWith("meta") || modelId.startsWith("llama")) {
      return "meta";
    }
    return "opencode"; // default
  };

  const modelsWithDetails = availableModels.map((m) => {
    const providerSlug = getProviderFromModelId(m.modelId);
    return {
      ...m,
      id: m.modelId,
      chef: providerSlug.toUpperCase(),
      chefSlug: providerSlug,
      providers: [providerSlug],
    };
  });

  const chefs = Array.from(new Set(modelsWithDetails.map((m) => m.chef)));
  const fallbackProvider = currentModelId
    ? getProviderFromModelId(currentModelId)
    : null;
  const selectedModelData =
    modelsWithDetails.find((m) => m.id === currentModelId) ??
    (currentModelId && fallbackProvider
      ? {
          id: currentModelId,
          modelId: currentModelId,
          name: currentModelId,
          description: "Selected model",
          chef: fallbackProvider.toUpperCase(),
          chefSlug: fallbackProvider,
          providers: [fallbackProvider],
        }
      : undefined);

  const mentionItems = useMemo(() => {
    const normalized = mentionQuery.trim().toLowerCase();
    const activeTabPaths = activeTabs.map((tab) => tab.path);
    const seen = new Set<string>();
    const candidates = normalized
      ? files.filter((path) => path.toLowerCase().includes(normalized))
      : [...activeTabPaths, ...files];

    const unique = candidates.filter((path) => {
      if (seen.has(path)) {
        return false;
      }
      seen.add(path);
      return true;
    });

    return unique.slice(0, 60).map((path) => {
      const parts = path.split("/");
      const name = parts.pop() ?? path;
      const dir = parts.join("/");
      return { path, name, dir };
    });
  }, [activeTabs, files, mentionQuery]);

  useEffect(() => {
    if (!mentionOpen) {
      return;
    }
    setMentionIndex(0);
  }, [mentionOpen, mentionQuery, mentionItems.length]);

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

  const isStreaming = status === "streaming";

  const promptInputContent = (
    <PromptInput
      globalDrop
      maxFileSize={ATTACHMENT_HARD_LIMIT_BYTES}
      multiple
      onError={handleAttachmentError}
      onSubmit={handleSubmitWithMentions}
    >
      <PromptInputHeader>
        <PromptInputHoverCard>
          <PromptInputHoverCardTrigger>
            <PromptInputButton
              className="h-8!"
              size="icon-sm"
              variant="outline"
            >
              <Command className="text-muted-foreground" size={12} />
            </PromptInputButton>
          </PromptInputHoverCardTrigger>
          <PromptInputHoverCardContent className="w-100 p-0">
            <PromptInputCommand>
              <PromptInputCommandInput
                className="border-none focus-visible:ring-0"
                placeholder="Add files, folders, docs..."
              />
              <PromptInputCommandList>
                <PromptInputCommandEmpty className="p-3 text-muted-foreground text-sm">
                  No results found.
                </PromptInputCommandEmpty>
                {availableCommands.map((cmd) => (
                  <SlashCommandMenuItem
                    command={cmd}
                    key={cmd.name}
                    textareaRef={textareaRef}
                  />
                ))}
              </PromptInputCommandList>
            </PromptInputCommand>
          </PromptInputHoverCardContent>
        </PromptInputHoverCard>

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
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          {connStatus === "connected" && availableModes.length > 0 && (
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

          {connStatus === "connected" && availableModels.length > 0 && (
            <ModelSelector
              onOpenChange={setModelSelectorOpen}
              open={modelSelectorOpen}
            >
              <ModelSelectorTrigger asChild>
                <Button className="h-8 w-50 justify-between" variant="outline">
                  {selectedModelData?.chefSlug && (
                    <ModelSelectorLogo provider={selectedModelData.chefSlug} />
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
                <ModelSelectorInput placeholder="Search models..." />
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                  {chefs.map((chef) => (
                    <ModelSelectorGroup heading={chef} key={chef}>
                      {modelsWithDetails
                        .filter((model) => model.chef === chef)
                        .map((model) => (
                          <ModelSelectorItem
                            key={model.id}
                            onSelect={() => {
                              onModelChange(model.id);
                              setModelSelectorOpen(false);
                            }}
                            value={model.id}
                          >
                            <ModelSelectorLogo provider={model.chefSlug} />
                            <ModelSelectorName>{model.name}</ModelSelectorName>
                            <ModelSelectorLogoGroup>
                              {model.providers.map((provider) => (
                                <ModelSelectorLogo
                                  key={provider}
                                  provider={provider}
                                />
                              ))}
                            </ModelSelectorLogoGroup>
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
        <PromptInputSubmit
          disabled={connStatus !== "connected"}
          onStop={onCancel}
          status={status}
        />
      </PromptInputFooter>
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
};

export const ChatInput = memo(ChatInputBase);
ChatInput.displayName = "ChatInput";
