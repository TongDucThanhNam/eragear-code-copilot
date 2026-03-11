import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Spinner } from "heroui-native";
import { deduplicateKeys } from "./utils";
import { ChainStep } from "./chain-step";
import { ChainContent } from "./chain-content";
import { summarizeChainItems } from "./agentic-chain.utils";
import type { ChainOfThoughtProps } from "./agentic-chain.types";

export function ChainOfThought({
  items,
  isStreaming,
  messageId,
}: ChainOfThoughtProps) {
  const [isOpen, setIsOpen] = useState(isStreaming);

  const chainSummary = useMemo(() => summarizeChainItems(items), [items]);
  const itemKeys = useMemo(() => deduplicateKeys(items), [items]);
  const activeKey =
    chainSummary.activeIndex >= 0 ? itemKeys[chainSummary.activeIndex] : null;
  const [expandedKey, setExpandedKey] = useState<string | null>(activeKey);

  useEffect(() => {
    setExpandedKey(activeKey ?? null);
  }, [activeKey, messageId]);

  useEffect(() => {
    if (activeKey) {
      setIsOpen(true);
    }
  }, [activeKey]);

  if (items.length === 0) {
    return null;
  }

  return (
    <View
      className="w-full rounded-xl border border-divider bg-surface-foreground/5"
    >
      <Pressable
        className="min-h-10 flex-row items-center justify-between px-3 py-2"
        onPress={() => setIsOpen((current) => !current)}
      >
        <View className="flex-row items-center gap-2">
          {isStreaming ? (
            <Spinner color="accent" size="sm" />
          ) : (
            <Ionicons
              className="text-muted-foreground"
              name="sparkles-outline"
              size={14}
            />
          )}
          <Text className="font-medium text-foreground text-sm">
            Chain of Thought
          </Text>
          <Text className="text-muted-foreground text-xs">
            {chainSummary.summary}
          </Text>
        </View>
        <Ionicons
          className="text-muted-foreground"
          name={isOpen ? "chevron-up-outline" : "chevron-down-outline"}
          size={16}
        />
      </Pressable>
      {isOpen ? (
        <View className="border-divider border-t px-3 pt-2 pb-3">
          <View className="flex-col gap-3">
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
