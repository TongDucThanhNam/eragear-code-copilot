import type { ToolUIPart, UIMessagePart } from "@repo/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Accordion, Spinner } from "heroui-native";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  getActiveIndex,
  toToolViewState,
} from "./agentic-message-utils";
import { PartRenderers } from "./part-renderers";
import MarkdownText from "./text-part";
import { cn_inline, getPartKey } from "./utils";

type AccordionValue = string | string[] | undefined;

const getToolTone = (viewState: ReturnType<typeof toToolViewState>) => {
  switch (viewState) {
    case "error":
      return "text-danger";
    case "completed":
      return "text-success";
    case "approval-requested":
      return "text-warning";
    case "running":
      return "text-accent";
    default:
      return "text-muted-foreground";
  }
};

const getChainIcon = (part: UIMessagePart, isActive: boolean) => {
  if (part.type.startsWith("tool-")) {
    const viewState = toToolViewState(part as ToolUIPart);
    if (viewState === "running" && isActive) {
      return <Spinner color="accent" size="sm" />;
    }
    return (
      <Ionicons
        className={getToolTone(viewState)}
        name="construct-outline"
        size={14}
      />
    );
  }

  if (part.type === "reasoning") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="bulb-outline"
        size={14}
      />
    );
  }

  if (part.type === "text") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="chatbubble-ellipses-outline"
        size={14}
      />
    );
  }

  if (part.type === "source-url") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="link-outline"
        size={14}
      />
    );
  }

  if (part.type === "source-document") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="document-text-outline"
        size={14}
      />
    );
  }

  if (part.type === "file") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="document-outline"
        size={14}
      />
    );
  }

  if (part.type === "step-start") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="ellipse"
        size={10}
      />
    );
  }

  return (
    <Ionicons
      className="text-muted-foreground"
      name="sparkles-outline"
      size={14}
    />
  );
};

const ChainStep = ({
  part,
  isLast,
  isActive,
  children,
}: {
  part: UIMessagePart;
  isLast: boolean;
  isActive: boolean;
  children: React.ReactNode;
}) => (
  <View className="flex-row gap-3">
    <View className="w-6 items-center">
      <View
        className={cn_inline(
          "h-6 w-6 items-center justify-center rounded-full border border-divider bg-background",
          isActive && "border-accent/60 bg-accent/10"
        )}
      >
        {getChainIcon(part, isActive)}
      </View>
      {!isLast && (
        <View className="mt-1 w-px flex-1 bg-divider" style={{ minHeight: 12 }} />
      )}
    </View>
    <View className={cn_inline("flex-1", !isLast && "pb-3")}>
      {children}
    </View>
  </View>
);

const ChainContent = ({ part }: { part: UIMessagePart }) => {
  if (part.type === "text") {
    return (
      <View className="opacity-80">
        <MarkdownText>{part.text}</MarkdownText>
      </View>
    );
  }

  if (part.type === "step-start") {
    return (
      <Text className="text-xs text-muted-foreground">
        Step
      </Text>
    );
  }

  return <PartRenderers part={part} />;
};

export function ChainOfThought({
  items,
  isStreaming,
  messageId,
}: {
  items: UIMessagePart[];
  isStreaming: boolean;
  messageId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const activeIndex = useMemo(() => getActiveIndex(items), [items]);
  const toolCount = useMemo(
    () => items.filter((item) => item.type.startsWith("tool-")).length,
    [items]
  );
  const reasoningCount = useMemo(
    () => items.filter((item) => item.type === "reasoning").length,
    [items]
  );
  const textCount = useMemo(
    () => items.filter((item) => item.type === "text").length,
    [items]
  );

  if (items.length === 0) {
    return null;
  }

  const summaryParts = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
    reasoningCount
      ? `${reasoningCount} thought${reasoningCount === 1 ? "" : "s"}`
      : null,
    textCount ? `${textCount} note${textCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(" | ")
      : `${items.length} step${items.length === 1 ? "" : "s"}`;

  const itemValue = `chain-${messageId}`;

  return (
    <Accordion
      isDividerVisible={false}
      selectionMode="single"
      value={isOpen ? itemValue : undefined}
      onValueChange={(nextValue: AccordionValue) => {
        const open = Array.isArray(nextValue)
          ? nextValue.includes(itemValue)
          : nextValue === itemValue;
        setIsOpen(open);
      }}
      variant="surface"
      className="w-full rounded-xl border border-divider bg-surface-foreground/5"
    >
      <Accordion.Item value={itemValue}>
        <Accordion.Trigger className="min-h-10 px-3 py-2">
          <View className="flex-row items-center justify-between gap-2">
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
              <Text className="font-medium text-sm">Chain of Thought</Text>
              <Text className="text-xs text-muted-foreground">
                {summary}
              </Text>
            </View>
            <Accordion.Indicator />
          </View>
        </Accordion.Trigger>
        {isOpen ? (
          <Accordion.Content className="border-t border-divider px-3 pb-3 pt-2">
            <View className="flex-col gap-3">
              {items.map((item, index) => (
                <ChainStep
                  key={getPartKey(item, index)}
                  isActive={index === activeIndex}
                  isLast={index === items.length - 1}
                  part={item}
                >
                  <ChainContent part={item} />
                </ChainStep>
              ))}
            </View>
          </Accordion.Content>
        ) : null}
      </Accordion.Item>
    </Accordion>
  );
}
