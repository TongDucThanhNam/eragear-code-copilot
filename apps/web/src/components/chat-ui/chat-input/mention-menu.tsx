"use client";

import { FileTextIcon } from "lucide-react";
import { useCallback, useEffect, type RefObject } from "react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";

export interface MentionItem {
  path: string;
  name: string;
  dir: string;
}

interface MentionMenuProps {
  open: boolean;
  items: MentionItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  mentionStart: number | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onAddMention: (path: string) => void;
  onClose: () => void;
  registerSelect: (fn: ((index?: number) => void) | null) => void;
}

export function MentionMenu({
  open,
  items,
  activeIndex,
  onActiveIndexChange,
  mentionStart,
  textareaRef,
  onAddMention,
  onClose,
  registerSelect,
}: MentionMenuProps) {
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
