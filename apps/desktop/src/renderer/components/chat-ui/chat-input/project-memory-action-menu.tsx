"use client";

import { FileTextIcon } from "lucide-react";
import { type RefObject, useCallback } from "react";
import {
  PromptInputActionMenuItem,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  buildProjectMemoryCommandText,
  getProjectMemoryRequestDraft,
  PROJECT_MEMORY_COMMAND_NAME,
} from "@/components/chat-ui/project-memory-command";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

export interface ProjectMemoryMenuSource {
  id: string;
  label: string;
  relativePath: string;
  enabled: boolean;
  byteLength: number;
  warnings?: string[];
}

export interface ProjectMemoryMenuPreset {
  id: string;
  name: string;
  sourcePaths: string[];
  defaultQuery?: string;
  retrievalMode?: "full" | "semantic";
  maxBytes: number;
  maxChunks?: number;
  diagnostics?: string[];
}

interface ProjectMemoryActionMenuProps {
  presets?: ProjectMemoryMenuPreset[];
  sources: ProjectMemoryMenuSource[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCommandApplied?: (commandName: string) => void;
}

function formatMemoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function ProjectMemoryActionMenu({
  presets = [],
  sources,
  textareaRef,
  onCommandApplied,
}: ProjectMemoryActionMenuProps) {
  const controller = usePromptInputController();
  const enabledSources = sources
    .filter((source) => source.enabled && source.relativePath.trim())
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const visiblePresets = presets
    .filter((preset) => preset.id.trim() && preset.sourcePaths.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));

  const applyMemoryCommand = useCallback(
    (input: {
      sourcePaths?: string[];
      presetId?: string;
      request?: string;
      retrievalMode?: "full" | "semantic";
      maxChunks?: number;
    }) => {
      const request = getProjectMemoryRequestDraft(controller.textInput.value);
      const commandText = buildProjectMemoryCommandText({
        request: input.request ?? request,
        retrievalMode: input.retrievalMode,
        presetId: input.presetId,
        sourcePaths: input.sourcePaths ?? [],
        maxChunks: input.maxChunks,
      });
      controller.textInput.setInput(commandText);
      onCommandApplied?.(PROJECT_MEMORY_COMMAND_NAME);

      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      requestAnimationFrame(() => {
        const cursorPos = commandText.length;
        textarea.selectionStart = cursorPos;
        textarea.selectionEnd = cursorPos;
      });
    },
    [
      controller.textInput.setInput,
      controller.textInput.value,
      onCommandApplied,
      textareaRef,
    ]
  );

  if (enabledSources.length === 0 && visiblePresets.length === 0) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="items-start">
        <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <div className="font-medium text-xs">Project Memory</div>
          <div className="truncate text-muted-foreground text-xs">
            {visiblePresets.length > 0
              ? `${visiblePresets.length} preset${visiblePresets.length === 1 ? "" : "s"}`
              : `${enabledSources.length} enabled source${enabledSources.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 w-80 overflow-y-auto p-1">
        <PromptInputActionMenuItem
          className="items-start"
          onSelect={() => applyMemoryCommand({ sourcePaths: [] })}
        >
          <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <div className="font-medium text-xs">All enabled sources</div>
            <div className="truncate text-muted-foreground text-xs">
              /memory request
            </div>
          </div>
        </PromptInputActionMenuItem>
        <PromptInputActionMenuItem
          className="items-start"
          onSelect={() =>
            applyMemoryCommand({ retrievalMode: "semantic", maxChunks: 4 })
          }
        >
          <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <div className="font-medium text-xs">Best matching chunks</div>
            <div className="truncate text-muted-foreground text-xs">
              /memory --semantic request
            </div>
          </div>
        </PromptInputActionMenuItem>
        {visiblePresets.map((preset) => (
          <PromptInputActionMenuItem
            className="items-start"
            key={preset.id}
            onSelect={() =>
              applyMemoryCommand({
                presetId: preset.id,
                request: preset.defaultQuery ?? "",
              })
            }
          >
            <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 space-y-0.5">
              <div className="truncate font-medium text-xs">{preset.name}</div>
              <div className="truncate text-muted-foreground text-xs">
                {preset.sourcePaths.length} source
                {preset.sourcePaths.length === 1 ? "" : "s"} -{" "}
                {formatMemoryBytes(preset.maxBytes)}
                {preset.retrievalMode === "semantic" ? " - semantic" : ""}
                {preset.diagnostics?.length ? " - warning" : ""}
              </div>
            </div>
          </PromptInputActionMenuItem>
        ))}
        {enabledSources.map((source) => (
          <PromptInputActionMenuItem
            className="items-start"
            key={source.id}
            onSelect={() =>
              applyMemoryCommand({ sourcePaths: [source.relativePath] })
            }
          >
            <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 space-y-0.5">
              <div className="truncate font-medium text-xs">{source.label}</div>
              <div className="truncate text-muted-foreground text-xs">
                {source.relativePath} - {formatMemoryBytes(source.byteLength)}
                {source.warnings?.length ? " - warning" : ""}
              </div>
            </div>
          </PromptInputActionMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
