"use client";

import { FileTextIcon } from "lucide-react";
import { useCallback, type RefObject } from "react";
import {
  PromptInputActionMenuItem,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildProjectMemoryCommandText,
  getProjectMemoryRequestDraft,
  PROJECT_MEMORY_COMMAND_NAME,
} from "@/components/chat-ui/project-memory-command";

export interface ProjectMemoryMenuSource {
  id: string;
  label: string;
  relativePath: string;
  enabled: boolean;
  byteLength: number;
  warnings?: string[];
}

interface ProjectMemoryActionMenuProps {
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
  sources,
  textareaRef,
  onCommandApplied,
}: ProjectMemoryActionMenuProps) {
  const controller = usePromptInputController();
  const enabledSources = sources
    .filter((source) => source.enabled && source.relativePath.trim())
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const applyMemoryCommand = useCallback(
    (sourcePaths: string[]) => {
      const request = getProjectMemoryRequestDraft(controller.textInput.value);
      const commandText = buildProjectMemoryCommandText({
        request,
        sourcePaths,
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

  if (enabledSources.length === 0) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="items-start">
        <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <div className="font-medium text-xs">Project Memory</div>
          <div className="truncate text-muted-foreground text-xs">
            {enabledSources.length} enabled source
            {enabledSources.length === 1 ? "" : "s"}
          </div>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 w-80 overflow-y-auto p-1">
        <PromptInputActionMenuItem
          className="items-start"
          onSelect={() => applyMemoryCommand([])}
        >
          <FileTextIcon className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <div className="font-medium text-xs">All enabled sources</div>
            <div className="truncate text-muted-foreground text-xs">
              /memory request
            </div>
          </div>
        </PromptInputActionMenuItem>
        {enabledSources.map((source) => (
          <PromptInputActionMenuItem
            className="items-start"
            key={source.id}
            onSelect={() => applyMemoryCommand([source.relativePath])}
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
