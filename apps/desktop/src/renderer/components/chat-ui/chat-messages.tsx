// biome-ignore-all lint: Legacy migrated renderer lint debt is preserved during Electron-first extraction; normalize in focused UI cleanup.
"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon, MessageSquareIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AgenticMessage } from "@/components/chat-ui/agentic-message";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export interface ChatMessagesProps {
  chatId: string | null;
  messageIds: readonly string[];
  showThinkingPlaceholder?: boolean;
  canLoadOlder?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
}

const ThinkingMessagePlaceholder = memo(function ThinkingMessagePlaceholder() {
  return (
    <Message from="assistant">
      <MessageContent className="text-muted-foreground text-sm">
        <div aria-live="polite" role="status">
          <Shimmer duration={1}>Thinking...</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
});

const CHAT_OVERSCAN = 8;
const CHAT_SCROLL_END_THRESHOLD = 96;
const LOAD_OLDER_ESTIMATE = 48;
const THINKING_ESTIMATE = 72;
const MESSAGE_ESTIMATE = 180;

type ChatVirtualItem =
  | { kind: "load-older" }
  | { kind: "message"; messageId: string }
  | { kind: "thinking" };

function isNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    CHAT_SCROLL_END_THRESHOLD
  );
}

/**
 * Shallow compare for messageIds array - optimized for common case of
 * messages being appended at the end. Same-length changes are fully checked so
 * a middle insert/replacement cannot leave the rendered DOM stale.
 */
function shallowCompareMessageIds(
  prev: readonly string[],
  next: readonly string[]
): boolean {
  if (prev === next) {
    return true;
  }
  const len = prev.length;
  if (len !== next.length) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    if (prev[i] !== next[i]) {
      return false;
    }
  }
  return true;
}

/** Stable anchored chat timeline for variable-height agent messages. */
export const ChatMessages = memo(
  function ChatMessages({
    chatId,
    messageIds,
    showThinkingPlaceholder = false,
    canLoadOlder = false,
    isLoadingOlder = false,
    onLoadOlder,
  }: ChatMessagesProps) {
    const parentRef = useRef<HTMLDivElement | null>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const isAtBottomRef = useRef(true);
    const canRenderLoadOlder = Boolean(canLoadOlder && onLoadOlder);
    const itemCount =
      messageIds.length +
      (canRenderLoadOlder ? 1 : 0) +
      (showThinkingPlaceholder ? 1 : 0);
    const isEmpty =
      messageIds.length === 0 &&
      !canRenderLoadOlder &&
      !(showThinkingPlaceholder || isLoadingOlder);

    const resolveVirtualItem = useCallback(
      (index: number): ChatVirtualItem => {
        if (canRenderLoadOlder && index === 0) {
          return { kind: "load-older" };
        }
        const messageIndex = index - (canRenderLoadOlder ? 1 : 0);
        if (messageIndex >= 0 && messageIndex < messageIds.length) {
          return { kind: "message", messageId: messageIds[messageIndex] ?? "" };
        }
        return { kind: "thinking" };
      },
      [canRenderLoadOlder, messageIds]
    );

    const getItemKey = useCallback(
      (index: number) => {
        const item = resolveVirtualItem(index);
        if (item.kind === "message") {
          return `message:${item.messageId}`;
        }
        return item.kind;
      },
      [resolveVirtualItem]
    );

    const estimateSize = useCallback(
      (index: number) => {
        const item = resolveVirtualItem(index);
        if (item.kind === "load-older") {
          return LOAD_OLDER_ESTIMATE;
        }
        if (item.kind === "thinking") {
          return THINKING_ESTIMATE;
        }
        return MESSAGE_ESTIMATE;
      },
      [resolveVirtualItem]
    );

    const rowVirtualizer = useVirtualizer({
      anchorTo: "end",
      count: itemCount,
      estimateSize,
      followOnAppend: "auto",
      gap: 24,
      getItemKey,
      getScrollElement: () => parentRef.current,
      overscan: CHAT_OVERSCAN,
      paddingEnd: 16,
      paddingStart: 16,
      scrollEndThreshold: CHAT_SCROLL_END_THRESHOLD,
      useAnimationFrameWithResizeObserver: true,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();
    const totalSize = rowVirtualizer.getTotalSize();

    const updateIsAtBottom = useCallback(() => {
      const element = parentRef.current;
      if (!element) {
        return;
      }
      const nextIsAtBottom = isNearBottom(element);
      if (isAtBottomRef.current !== nextIsAtBottom) {
        isAtBottomRef.current = nextIsAtBottom;
        setIsAtBottom(nextIsAtBottom);
      }
    }, []);

    const scrollToBottom = useCallback(
      (behavior: ScrollBehavior = "smooth") => {
        if (itemCount > 0) {
          rowVirtualizer.scrollToIndex(itemCount - 1, {
            align: "end",
            behavior,
          });
          return;
        }
        const element = parentRef.current;
        element?.scrollTo({ behavior, top: element.scrollHeight });
      },
      [itemCount, rowVirtualizer]
    );

    const handleLoadOlder = useCallback(() => {
      onLoadOlder?.();
    }, [onLoadOlder]);

    const handleScrollToBottom = useCallback(() => {
      scrollToBottom("smooth");
    }, [scrollToBottom]);

    useEffect(() => {
      updateIsAtBottom();
    }, [totalSize, updateIsAtBottom]);

    useLayoutEffect(() => {
      if (itemCount === 0 || !isAtBottomRef.current) {
        return;
      }
      scrollToBottom("auto");
    }, [itemCount, scrollToBottom]);

    const renderedItems = useMemo(
      () =>
        virtualItems.map((virtualItem) => {
          const item = resolveVirtualItem(virtualItem.index);
          return (
            <div
              className="absolute top-0 left-0 w-full"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={rowVirtualizer.measureElement}
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {item.kind === "load-older" ? (
                <div className="flex justify-center">
                  <Button
                    disabled={isLoadingOlder}
                    onClick={handleLoadOlder}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isLoadingOlder
                      ? "Loading older messages..."
                      : "Load older messages"}
                  </Button>
                </div>
              ) : item.kind === "thinking" ? (
                <ThinkingMessagePlaceholder />
              ) : (
                <AgenticMessage chatId={chatId} messageId={item.messageId} />
              )}
            </div>
          );
        }),
      [
        chatId,
        handleLoadOlder,
        isLoadingOlder,
        resolveVirtualItem,
        rowVirtualizer.measureElement,
        virtualItems,
      ]
    );

    return (
      <div
        className="relative h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden bg-[var(--bg_default_primary)] text-[color:var(--text_default_primary)]"
        role="log"
      >
        <div
          className="h-full min-h-0 overflow-y-auto overscroll-contain scroll-smooth"
          onScroll={updateIsAtBottom}
          ref={parentRef}
        >
          {isEmpty ? (
            <Empty className="mx-auto size-full max-w-sm border-none bg-transparent shadow-none">
              <EmptyMedia variant="icon">
                <MessageSquareIcon className="size-8" />
              </EmptyMedia>
              <EmptyContent>
                <EmptyTitle>No messages yet</EmptyTitle>
                <EmptyDescription>
                  Messages will appear here when the session starts.
                </EmptyDescription>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="mx-auto w-full max-w-4xl px-3 text-[color:var(--text_default_primary)] sm:px-5">
              <div
                className="relative w-full"
                style={{ height: `${totalSize}px` }}
              >
                {renderedItems}
              </div>
            </div>
          )}
        </div>

        {isLoadingOlder && messageIds.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center bg-gradient-to-b from-background via-background/85 to-transparent px-3 pt-2 pb-5">
            <div className="rounded-md border bg-background px-2.5 py-1 text-muted-foreground text-xs shadow-sm">
              Loading older messages...
            </div>
          </div>
        ) : null}

        {!isAtBottom && itemCount > 0 ? (
          <Button
            aria-label="Scroll to latest message"
            className={cn(
              "absolute bottom-5 left-[50%] z-10 translate-x-[-50%] rounded-full border-[color:var(--border_default)] bg-[var(--bg_grouped_secondary_elevated)] shadow-sm hover:bg-[var(--bg_interaction_tertiary_hover)]"
            )}
            onClick={handleScrollToBottom}
            size="icon"
            type="button"
            variant="outline"
          >
            <ArrowDownIcon className="size-4" />
          </Button>
        ) : null}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    shallowCompareMessageIds(prevProps.messageIds, nextProps.messageIds) &&
    prevProps.showThinkingPlaceholder === nextProps.showThinkingPlaceholder &&
    prevProps.canLoadOlder === nextProps.canLoadOlder &&
    prevProps.isLoadingOlder === nextProps.isLoadingOlder &&
    prevProps.onLoadOlder === nextProps.onLoadOlder
);
