import Ionicons from "@expo/vector-icons/Ionicons";
import { PressableFeedback, Spinner, Text } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { ChainOfThoughtProps } from "./agentic-chain.types";
import { summarizeChainItems } from "./agentic-chain.utils";
import { ChainContent } from "./chain-content";
import { ChainStep } from "./chain-step";
import { deduplicateKeys } from "./utils";

const ACTIVITY_TIMER_MS = 1000;

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export function ChainOfThought({
  items,
  isStreaming,
  messageId,
}: ChainOfThoughtProps) {
  const [isOpen, setIsOpen] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const chainSummary = useMemo(() => summarizeChainItems(items), [items]);
  const itemKeys = useMemo(() => deduplicateKeys(items), [items]);
  const activeKey =
    chainSummary.activeIndex >= 0 ? itemKeys[chainSummary.activeIndex] : null;
  const [expandedKey, setExpandedKey] = useState<string | null>(activeKey);

  useEffect(() => {
    setExpandedKey(activeKey ?? null);
  }, [activeKey]);

  useEffect(() => {
    startedAtRef.current = null;
    setElapsedMs(null);
  }, [messageId]);

  useEffect(() => {
    if (!isStreaming) {
      if (startedAtRef.current !== null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
      return;
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }

    const updateElapsed = () => {
      if (startedAtRef.current !== null) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    };

    updateElapsed();
    const timer = setInterval(updateElapsed, ACTIVITY_TIMER_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isStreaming]);

  if (items.length === 0) {
    return null;
  }

  const activityLabel =
    isStreaming && elapsedMs === null
      ? "Working..."
      : elapsedMs !== null
      ? `${isStreaming ? "Working" : "Worked"} for ${formatDuration(elapsedMs)}`
      : `Worked through ${items.length} step${items.length === 1 ? "" : "s"}`;

  return (
    <View className="w-full">
      <PressableFeedback
        animation={{ scale: { value: 0.97 } }}
        className="self-center rounded-full px-2 py-1"
        onPress={() => setIsOpen((current) => !current)}
      >
        <View className="flex-row items-center gap-1.5">
          {isStreaming ? (
            <Spinner color="accent" size="sm" />
          ) : null}
          <Text color="muted" type="body-sm">
            {activityLabel}
          </Text>
          <Ionicons
            className="text-muted-foreground"
            name={isOpen ? "chevron-up-outline" : "chevron-down-outline"}
            size={13}
          />
        </View>
      </PressableFeedback>

      {isOpen ? (
        <View className="mt-3 gap-1">
          <View className="flex-col gap-2">
            {itemKeys.map((key, index) => {
              const item = items[index];
              if (!item) {
                return null;
              }
              return (
                <ChainStep
                  isActive={index === chainSummary.activeIndex}
                  isLast={index === items.length - 1}
                  key={key}
                  part={item}
                >
                  <ChainContent
                    isExpanded={expandedKey === key}
                    onToggle={() => {
                      setExpandedKey((current) =>
                        current === key ? null : key
                      );
                    }}
                    part={item}
                  />
                </ChainStep>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Re-export types and utils for backward compatibility
export type { ChainSummary } from "./agentic-chain.types";
export { summarizeChainItems } from "./agentic-chain.utils";
