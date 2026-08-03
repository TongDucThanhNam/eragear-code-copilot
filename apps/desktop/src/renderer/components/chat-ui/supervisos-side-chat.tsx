import type {
  GoalModeAuditEntry,
  SupervisorSessionState,
} from "@eragear-code-copilot/shared";
import {
  AlertTriangle,
  Bot,
  FileCheck2,
  GitBranch,
  Loader2,
  type LucideIcon,
  MessageSquareText,
  Route,
  Send,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  buildQueuedSupervisosMainPrompt,
  formatSupervisosHandoffStatus,
  isPromptBusyError,
  parseLegacyDelegatedHandoff,
} from "./supervisos-side-chat-utils";

interface SupervisosSideChatProps {
  chatId: string;
  disabled: boolean;
  goalModeAudit: GoalModeAuditEntry[];
  isSettingSupervisorMode: boolean;
  onEnableAutopilot: () => Promise<void>;
  onStageMainPrompt: (input: {
    autoSubmit: boolean;
    prompt: string;
  }) => Promise<void> | void;
  supervisor: SupervisorSessionState | null;
}

interface QuickAction {
  icon: LucideIcon;
  label: string;
  prompt: string;
}

interface SupervisosMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status?: "error";
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: ShieldCheck,
    label: "Gate",
    prompt: "Review the latest Goal Mode gate and name the next safe action.",
  },
  {
    icon: Route,
    label: "Scope",
    prompt:
      "Resolve the active scope and identify the primary files or evidence to inspect next.",
  },
  {
    icon: FileCheck2,
    label: "Verify",
    prompt:
      "Review verification evidence and identify anything that blocks continuation.",
  },
  {
    icon: GitBranch,
    label: "AST",
    prompt:
      "Use the precomputed AST import graph context to explain the relevant scope, symbols, imports, and imported-by relationships.",
  },
];

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;

export function SupervisosSideChat({
  chatId,
  disabled,
  goalModeAudit,
  isSettingSupervisorMode,
  onEnableAutopilot,
  onStageMainPrompt,
  supervisor,
}: SupervisosSideChatProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<SupervisosMessage[]>([]);
  const previousChatIdRef = useRef(chatId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const forceNextScrollToBottomRef = useRef(false);
  const lastScrollSignatureRef = useRef("");
  const { isPending, mutateAsync } = trpc.supervisorChat.useMutation();
  const supervisorMode = supervisor?.mode ?? "off";
  const statusLabel =
    supervisorMode === "off" ? "off" : (supervisor?.status ?? "idle");
  const auditContext = useMemo(
    () => goalModeAudit.slice(0, 6).map(toGoalModeAuditSummary),
    [goalModeAudit]
  );
  const canSubmit = Boolean(chatId) && !(disabled || isPending);
  const canEnableAutopilot =
    supervisorMode !== "full_autopilot" &&
    !(disabled || isSettingSupervisorMode);

  useEffect(() => {
    if (previousChatIdRef.current === chatId) {
      return;
    }
    previousChatIdRef.current = chatId;
    stickToBottomRef.current = true;
    forceNextScrollToBottomRef.current = true;
    lastScrollSignatureRef.current = "";
    setDraft("");
    setMessages([]);
  });

  const updateScrollStickiness = useCallback(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottomRef.current =
      distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  useLayoutEffect(() => {
    const latestMessage = messages.at(-1);
    const signature = [
      latestMessage?.id ?? "empty",
      messages.length,
      isPending ? "pending" : "idle",
    ].join(":");
    if (lastScrollSignatureRef.current === signature) {
      return;
    }
    lastScrollSignatureRef.current = signature;

    const node = scrollRef.current;
    if (!node) {
      return;
    }
    if (!(forceNextScrollToBottomRef.current || stickToBottomRef.current)) {
      return;
    }
    forceNextScrollToBottomRef.current = false;
    node.scrollTop = node.scrollHeight;
    stickToBottomRef.current = true;
  }, [isPending, messages]);

  const stageMainPrompt = useCallback(
    async (prompt: string, autoSubmit: boolean) => {
      await onStageMainPrompt({ autoSubmit, prompt });
    },
    [onStageMainPrompt]
  );

  const resolveAssistantContent = useCallback(
    async (response: { message: { content: string } }) => {
      const stageAction = getStageMainPromptAction(response);
      if (stageAction) {
        await stageMainPrompt(stageAction.prompt, stageAction.autoSubmit);
        return formatStagedPromptContent(stageAction.autoSubmit);
      }

      const legacyHandoff = parseLegacyDelegatedHandoff(
        response.message.content
      );
      if (!legacyHandoff) {
        return response.message.content;
      }

      let activation: "already_active" | "enabled" | "failed" =
        supervisorMode === "full_autopilot" ? "already_active" : "enabled";
      let activationError: string | undefined;
      if (supervisorMode !== "full_autopilot") {
        try {
          await onEnableAutopilot();
        } catch (error) {
          activation = "failed";
          activationError = getErrorMessage(error);
        }
      }
      return formatSupervisosHandoffStatus({
        activation,
        activationError,
        status: legacyHandoff.status,
        turnId: legacyHandoff.turnId,
      });
    },
    [onEnableAutopilot, stageMainPrompt, supervisorMode]
  );

  const appendBusyFallback = useCallback(
    async (text: string) => {
      const autoSubmit = supervisorMode === "full_autopilot";
      await stageMainPrompt(buildQueuedSupervisosMainPrompt(text), autoSubmit);
      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant-queued"),
          role: "assistant",
          content: formatStagedPromptContent(autoSubmit),
          createdAt: Date.now(),
        },
      ]);
    },
    [stageMainPrompt, supervisorMode]
  );

  const submitMessage = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!(text && chatId && canSubmit)) {
        return;
      }
      const history = messages
        .filter((item) => !item.status)
        .slice(-12)
        .map((item) => ({ content: item.content, role: item.role }));
      const userMessage: SupervisosMessage = {
        id: createMessageId("user"),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };

      forceNextScrollToBottomRef.current = true;
      setMessages((current) => [...current, userMessage]);
      setDraft("");

      try {
        const response = await mutateAsync({
          chatId,
          context: { goalModeAudit: auditContext },
          history,
          message: text,
        });
        const assistantContent = await resolveAssistantContent(response);
        setMessages((current) => [
          ...current,
          {
            id: createMessageId("assistant"),
            role: "assistant",
            content: assistantContent,
            createdAt: response.message.createdAt,
          },
        ]);
      } catch (error) {
        if (isPromptBusyError(error)) {
          try {
            await appendBusyFallback(text);
          } catch (queueError) {
            setMessages((current) => [
              ...current,
              {
                id: createMessageId("assistant-error"),
                role: "assistant",
                content: getErrorMessage(queueError),
                createdAt: Date.now(),
                status: "error",
              },
            ]);
            setDraft(text);
          }
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: createMessageId("assistant-error"),
            role: "assistant",
            content: getErrorMessage(error),
            createdAt: Date.now(),
            status: "error",
          },
        ]);
        setDraft(text);
      }
    },
    [
      appendBusyFallback,
      auditContext,
      canSubmit,
      chatId,
      messages,
      mutateAsync,
      resolveAssistantContent,
    ]
  );

  const runSubmit = useCallback(() => {
    submitMessage(draft).catch(() => undefined);
  }, [draft, submitMessage]);

  const runEnableAutopilot = useCallback(() => {
    onEnableAutopilot().catch(() => undefined);
  }, [onEnableAutopilot]);

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">
            Supervisos Chat
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {supervisorMode !== "full_autopilot" ? (
            <Button
              className="h-6 px-2 text-xs"
              disabled={!canEnableAutopilot}
              onClick={runEnableAutopilot}
              type="button"
              variant="outline"
            >
              {isSettingSupervisorMode ? "..." : "Enable"}
            </Button>
          ) : null}
          <Badge variant={getStatusTone(statusLabel, supervisorMode)}>
            {statusLabel}
          </Badge>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={updateScrollStickiness}
        ref={scrollRef}
      >
        {messages.length === 0 ? (
          <div className="rounded border border-dashed px-3 py-3 text-muted-foreground text-xs">
            No Supervisos messages yet.
          </div>
        ) : (
          <div className="grid gap-2">
            {messages.map((message) => (
              <SupervisosMessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
        {isPending ? (
          <div className="mt-2 flex justify-start">
            <div className="flex max-w-[92%] items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-muted-foreground text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Supervisos is thinking...
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t p-3">
        <div className="mb-2 grid grid-cols-4 gap-1">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                className="h-7 justify-center gap-1 px-1 text-xs"
                disabled={!canSubmit}
                key={action.label}
                onClick={() => {
                  submitMessage(action.prompt).catch(() => undefined);
                }}
                title={action.prompt}
                type="button"
                variant="outline"
              >
                <Icon className="size-3.5" />
                {action.label}
              </Button>
            );
          })}
        </div>

        <Textarea
          aria-label="Message Supervisos"
          className={cn(
            "max-h-28 min-h-16 resize-none text-xs",
            disabled && "bg-muted/40"
          )}
          disabled={disabled || isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              runSubmit();
            }
          }}
          placeholder={
            disabled ? "Configure Supervisor first..." : "Ask Supervisos..."
          }
          value={draft}
        />

        <Button
          className="mt-2 h-8 w-full justify-center gap-1.5"
          disabled={!(draft.trim() && canSubmit)}
          onClick={runSubmit}
          size="sm"
          type="button"
        >
          <Send className="size-3.5" />
          {isPending ? "Sending" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function SupervisosMessageBubble({ message }: { message: SupervisosMessage }) {
  const isUser = message.role === "user";
  let Icon = Bot;
  if (message.status === "error") {
    Icon = AlertTriangle;
  } else if (isUser) {
    Icon = User;
  }
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-md border px-2.5 py-2 text-xs leading-relaxed",
          isUser
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-muted/25 text-foreground",
          message.status === "error" &&
            "border-destructive/50 bg-destructive/10 text-destructive"
        )}
      >
        <div
          className={cn(
            "mb-1 flex items-center gap-1 text-[11px]",
            isUser ? "text-primary-foreground/80" : "text-muted-foreground",
            message.status === "error" && "text-destructive"
          )}
        >
          <Icon className="size-3" />
          <span>{isUser ? "You" : "Supervisos"}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}

function getStatusTone(
  statusLabel: string,
  supervisorMode: string
): "destructive" | "outline" | "secondary" {
  if (
    statusLabel === "error" ||
    statusLabel === "aborted" ||
    statusLabel === "needs_user"
  ) {
    return "destructive";
  }
  return supervisorMode === "full_autopilot" ? "secondary" : "outline";
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Supervisos chat failed.";
}

function formatStagedPromptContent(autoSubmit: boolean): string {
  return autoSubmit
    ? "Enhanced prompt added to the main ChatInput. Autopilot will submit it when the main chat is ready."
    : "Enhanced prompt added to the main ChatInput. Review or edit it, then send when ready.";
}

function getStageMainPromptAction(response: unknown): {
  autoSubmit: boolean;
  prompt: string;
  type: "stage_main_prompt";
} | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const action = (response as { action?: unknown }).action;
  if (!action || typeof action !== "object") {
    return null;
  }
  const candidate = action as Record<string, unknown>;
  if (
    candidate.type !== "stage_main_prompt" ||
    typeof candidate.prompt !== "string" ||
    typeof candidate.autoSubmit !== "boolean"
  ) {
    return null;
  }
  return {
    autoSubmit: candidate.autoSubmit,
    prompt: candidate.prompt,
    type: "stage_main_prompt",
  };
}

function toGoalModeAuditSummary(entry: GoalModeAuditEntry) {
  const verification =
    entry.verification?.exitCode === undefined
      ? undefined
      : `${entry.verification.command}: ${entry.verification.exitCode ?? "no exit"}`;
  const summary =
    entry.gate?.reasons.join(", ") ||
    entry.decisionReason ||
    entry.outcomeSummary?.keyDecision ||
    verification ||
    entry.scopeResolution?.resolverVersion;

  return {
    phaseId: entry.phaseId,
    kind: entry.kind,
    ...(entry.gate?.decision ? { decision: entry.gate.decision } : {}),
    ...(summary ? { summary } : {}),
    ...(entry.scopeResolution?.primaryTarget.path
      ? { targetPath: entry.scopeResolution.primaryTarget.path }
      : {}),
    ...(verification ? { verification } : {}),
    ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
  };
}
