"use client";

import { TerminalIcon } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SlashCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface SlashCommandPopupProps {
  commands: SlashCommand[];
  inputValue: string;
  onSelectCommand: (command: SlashCommand) => void;
}

export interface SlashCommandPopupRef {
  isOpen: boolean;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

// Regex pattern for slash command detection - hoisted to module level
const SLASH_COMMAND_PATTERN = /^\/(\w*)$/;

export const SlashCommandPopup = forwardRef<
  SlashCommandPopupRef,
  SlashCommandPopupProps
>(({ commands, inputValue, onSelectCommand }, ref) => {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Detect if we should show the popup (starts with / at beginning of input)
  const slashMatch = useMemo(() => {
    const match = inputValue.match(SLASH_COMMAND_PATTERN);
    if (match) {
      return { query: match[1] };
    }
    return null;
  }, [inputValue]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!slashMatch) {
      return [];
    }
    const query = slashMatch.query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query)
    );
  }, [commands, slashMatch]);

  // Open/close popup based on slash detection
  useEffect(() => {
    if (slashMatch && filteredCommands.length > 0) {
      setOpen(true);
      setSelectedIndex(0);
    } else {
      setOpen(false);
    }
  }, [slashMatch, filteredCommands]);

  // Scroll selected item into view
  useEffect(() => {
    if (open && commandListRef.current) {
      const items = commandListRef.current.querySelectorAll("[cmdk-item]");
      const selectedItem = items[selectedIndex];
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, open]);

  const handleSelect = useCallback(
    (command: SlashCommand) => {
      onSelectCommand(command);
      setOpen(false);
    },
    [onSelectCommand]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!open || filteredCommands.length === 0) {
        return false;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          );
          return true;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          );
          return true;

        case "Tab":
        case "Enter":
          if (filteredCommands[selectedIndex]) {
            e.preventDefault();
            handleSelect(filteredCommands[selectedIndex]);
            return true;
          }
          return false;

        case "Escape":
          e.preventDefault();
          setOpen(false);
          return true;

        default:
          return false;
      }
    },
    [open, filteredCommands, selectedIndex, handleSelect]
  );

  // Expose methods to parent
  useImperativeHandle(
    ref,
    () => ({
      isOpen: open,
      handleKeyDown,
    }),
    [open, handleKeyDown]
  );

  if (!open || filteredCommands.length === 0) {
    return null;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverAnchor asChild>
        <span
          style={{
            position: "absolute",
            left: 0,
            bottom: "100%",
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        side="top"
        sideOffset={8}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-60" ref={commandListRef}>
            <CommandEmpty>No commands found.</CommandEmpty>
            <CommandGroup heading="Slash Commands">
              {filteredCommands.map((cmd, index) => (
                <CommandItem
                  className={cn(
                    "flex items-start gap-2 px-3 py-2",
                    index === selectedIndex && "bg-accent"
                  )}
                  key={cmd.name}
                  onSelect={() => handleSelect(cmd)}
                  value={cmd.name}
                >
                  <TerminalIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">/{cmd.name}</span>
                    <span className="line-clamp-2 text-muted-foreground text-xs">
                      {cmd.description}
                    </span>
                    {cmd.input?.hint && (
                      <span className="text-muted-foreground/70 text-xs italic">
                        {cmd.input.hint}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t px-3 py-2 text-muted-foreground text-xs">
          <span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ↑↓
            </kbd>{" "}
            to navigate
          </span>
          <span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              Tab
            </kbd>{" "}
            or{" "}
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to select
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
});

SlashCommandPopup.displayName = "SlashCommandPopup";
