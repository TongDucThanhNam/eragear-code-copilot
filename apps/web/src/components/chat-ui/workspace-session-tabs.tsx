"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceSessionTab } from "@/store/workspace-session-store";

interface WorkspaceSessionTabsProps {
  tabs: WorkspaceSessionTab[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onClose: (chatId: string) => void;
}

export function WorkspaceSessionTabs({
  tabs,
  activeChatId,
  onSelect,
  onClose,
}: WorkspaceSessionTabsProps) {
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/20 px-2">
      {tabs.map((tab) => {
        const active = tab.chatId === activeChatId;
        return (
          <div
            className={cn(
              "group flex h-7 max-w-64 shrink-0 items-center gap-2 border px-2 text-left text-xs transition-colors",
              active
                ? "border-primary/40 bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:bg-background hover:text-foreground"
            )}
            key={tab.chatId}
            onClick={() => onSelect(tab.chatId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(tab.chatId);
              }
            }}
            role="button"
            tabIndex={0}
            title={tab.projectName ? `${tab.projectName} / ${tab.title}` : tab.title}
          >
            <span className="min-w-0 truncate font-medium">{tab.title}</span>
            {tab.projectName ? (
              <span className="hidden max-w-24 truncate text-muted-foreground sm:inline">
                {tab.projectName}
              </span>
            ) : null}
            <Button
              aria-label="Close workspace tab"
              className="size-5 shrink-0 p-0 opacity-60 hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.chatId);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
