import * as React from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type QuickSwitchSession = {
  id: string;
  name: string;
  projectName?: string | null;
};

interface QuickSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: QuickSwitchSession[];
  onSelect: (chatId: string) => void;
}

export function QuickSwitchDialog({
  open,
  onOpenChange,
  sessions,
  onSelect,
}: QuickSwitchDialogProps) {
  return (
    <CommandDialog onOpenChange={onOpenChange} open={open}>
      <Command className="w-full">
        <CommandInput placeholder="Switch sessions..." />
        <CommandList>
          <CommandEmpty>No sessions found.</CommandEmpty>
          <CommandGroup heading="Recent Sessions">
            {sessions.map((session) => (
              <CommandItem
                key={session.id}
                onSelect={() => onSelect(session.id)}
                value={`${session.name} ${session.projectName ?? ""}`}
              >
                <div className="flex w-full flex-col gap-0.5">
                  <span className="text-xs font-medium">{session.name}</span>
                  {session.projectName && (
                    <span className="text-[10px] text-muted-foreground">
                      {session.projectName}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
