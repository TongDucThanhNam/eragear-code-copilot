"use client";

import {
  Bot,
  Bug,
  ChevronDown,
  Folder,
  GitBranch,
  Hammer,
  Monitor,
  ScanSearch,
  SearchCode,
} from "lucide-react";
import { useRef, useState } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { renderAgentIcon } from "@/components/left-sidebar/agent-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ChatInput, type InjectedChatPrompt } from "./chat-input";

interface DraftAgent {
  id: string;
  name: string;
  type?: string | null;
}

interface NewChatDraftProps {
  agents: DraftAgent[];
  isCreatingSession: boolean;
  onAgentChange: (agentId: string) => void;
  onSubmit: (message: PromptInputMessage) => void | Promise<void>;
  project: {
    id: string;
    name: string;
    path?: string | null;
  };
  selectedAgentId: string | null;
}

const STARTER_PROMPTS = [
  {
    icon: SearchCode,
    label: "Explore and understand code",
    prompt:
      "Explore this codebase and explain how its main parts fit together.",
    tone: "text-sky-500",
  },
  {
    icon: Hammer,
    label: "Build a new feature, app, or tool",
    prompt: "Help me design and build a new feature in this project.",
    tone: "text-violet-500",
  },
  {
    icon: ScanSearch,
    label: "Review code and suggest changes",
    prompt:
      "Review the current code and suggest the highest-value improvements.",
    tone: "text-emerald-500",
  },
  {
    icon: Bug,
    label: "Fix issues and failures",
    prompt: "Find and fix the most important issue in this project.",
    tone: "text-orange-500",
  },
] as const;

export function NewChatDraft({
  agents,
  isCreatingSession,
  onAgentChange,
  onSubmit,
  project,
  selectedAgentId,
}: NewChatDraftProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [injectedPrompt, setInjectedPrompt] =
    useState<InjectedChatPrompt | null>(null);
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const gitStatusQuery = trpc.git.actions.status.useQuery(
    { projectId: project.id },
    {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 10_000,
    }
  );
  let branchLabel = "No Git repository";
  if (gitStatusQuery.isLoading) {
    branchLabel = "Checking Git…";
  } else if (gitStatusQuery.data?.isRepository) {
    branchLabel = gitStatusQuery.data.refName ?? "Git repository";
  }

  const stageStarterPrompt = (prompt: string) => {
    setInjectedPrompt({
      autoSubmit: false,
      id: `new-chat-starter-${Date.now()}`,
      text: prompt,
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-10 px-6 py-12">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border bg-muted/30 text-muted-foreground shadow-sm">
            <Bot className="size-6" />
          </div>
          <h2 className="text-balance font-medium text-2xl tracking-tight sm:text-3xl">
            What should we build in{" "}
            <span className="underline decoration-muted-foreground/50 underline-offset-4">
              {project.name}
            </span>
            ?
          </h2>
          <p className="text-muted-foreground text-sm">
            The ACP session will start only after you send the first prompt.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STARTER_PROMPTS.map((starter) => {
            const Icon = starter.icon;
            return (
              <button
                className="group flex min-h-32 flex-col items-start justify-between rounded-2xl border bg-card/40 p-5 text-left shadow-sm transition-colors hover:bg-muted/45"
                key={starter.label}
                onClick={() => stageStarterPrompt(starter.prompt)}
                type="button"
              >
                <Icon className={cn("size-5", starter.tone)} />
                <span className="max-w-40 font-medium text-sm leading-5">
                  {starter.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/98 to-transparent px-4 pt-10 pb-4">
        <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border bg-background/95 shadow-xl backdrop-blur">
          <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/25 px-4 py-2 text-xs">
            <span
              className="inline-flex min-w-0 items-center gap-2"
              title={project.path ?? project.name}
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="max-w-64 truncate font-medium">
                {project.name}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Monitor className="size-4" />
              Local
            </span>
            <span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
              <GitBranch className="size-4 shrink-0" />
              <span className="max-w-48 truncate">{branchLabel}</span>
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="ml-auto h-7 max-w-56 gap-2 px-2 text-xs"
                  disabled={agents.length === 0 || isCreatingSession}
                  type="button"
                  variant="ghost"
                >
                  {selectedAgent ? (
                    renderAgentIcon(
                      {
                        agentId: selectedAgent.id,
                        agentName: selectedAgent.name,
                        agentType: selectedAgent.type,
                      },
                      "size-4"
                    )
                  ) : (
                    <Bot className="size-4" />
                  )}
                  <span className="truncate">
                    {selectedAgent?.name ?? "No ACP agent"}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>ACP agent for this chat</DropdownMenuLabel>
                {agents.map((agent) => (
                  <DropdownMenuItem
                    key={agent.id}
                    onSelect={() => onAgentChange(agent.id)}
                  >
                    {renderAgentIcon(
                      {
                        agentId: agent.id,
                        agentName: agent.name,
                        agentType: agent.type,
                      },
                      "size-4"
                    )}
                    <span className="truncate">{agent.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ChatInput
            availableCommands={[]}
            availableConfigOptions={[]}
            availableModels={[]}
            availableModes={[]}
            chatId=""
            connStatus={isCreatingSession ? "connecting" : "connected"}
            currentModeId={null}
            currentModelId={null}
            imageInputSupported={false}
            injectedPrompt={injectedPrompt}
            onConfigOptionChange={() => undefined}
            onInjectedPromptConsumed={(id) => {
              setInjectedPrompt((current) =>
                current?.id === id ? null : current
              );
            }}
            onModeChange={() => undefined}
            onModelChange={() => undefined}
            onSubmit={onSubmit}
            status={isCreatingSession ? "connecting" : "ready"}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </div>
  );
}
