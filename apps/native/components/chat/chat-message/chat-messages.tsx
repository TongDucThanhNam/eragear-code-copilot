import { FlashList } from "@shopify/flash-list";
import { Accordion } from "heroui-native";
import type { ScrollViewProps } from "react-native";
import { ScrollView, Text, useColorScheme, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Markdown from "react-native-markdown-display";
import type { ChatMessage, MessagePart } from "@/store/chat-store";

// Inline helper if not exists
const cn_inline = (...classes: (string | undefined)[]) =>
  classes.filter(Boolean).join(" ");

// Terminal output detection patterns (defined at module level for performance)
const TERMINAL_PATTERNS = [
  /^\$ /mu, // Command prompt
  /^(?:npm|yarn|pnpm|bun|node|python|git|docker) /mu, // Common CLI prompts
  /\n(?:error|warning|info|success):/imu, // Log prefixes
  /\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[a-zA-Z0-9_./-]*)?(?::\d+)?(?::\d+)?/u,
] as const;

function isTerminalOutput(output: unknown): boolean {
  if (typeof output !== "string") {
    return false;
  }
  return TERMINAL_PATTERNS.some((pattern) => pattern.test(output));
}

function ToolResultDisplay({
  content,
  status,
}: {
  content?: Array<{
    type: string;
    text?: string;
    source?: {
      type: string;
      text?: string;
      oldText?: string;
      path?: string;
    };
  }>;
  status: string;
}): React.ReactNode {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isError = status === "error" || status === "failed";

  // Debug: show when content is missing or empty
  if (!content || content.length === 0) {
    return (
      <View className="p-2">
        <Text className="font-mono text-muted text-xs italic">
          (no content - status: {status})
        </Text>
      </View>
    );
  }

  const renderContentItem = (
    item: (typeof content)[number]
  ): React.ReactNode => {
    const { type, text, source } = item;

    switch (type) {
      case "text": {
        if (!text) {
          return null;
        }
        // Check if it looks like terminal output
        if (isTerminalOutput(text)) {
          return (
            <View
              className="max-h-48 rounded bg-surface-foreground/5 p-2"
              key={text.slice(0, 20)}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <Markdown
                  mergeStyle={false}
                  style={{
                    codeblock: {
                      backgroundColor: "transparent",
                      fontFamily: "monospace",
                    },
                    pre: {
                      backgroundColor: "transparent",
                      padding: 0,
                      margin: 0,
                    },
                    code: {
                      backgroundColor: "transparent",
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: isError ? "#ef4444" : "#22c55e",
                    },
                    text: {
                      color: isDark ? "#ffffff" : "#333333",
                      fontFamily: "monospace",
                      fontSize: 12,
                    },
                  }}
                >
                  {`\`\`\`text\n${text}\n\`\`\`\n`}
                </Markdown>
              </ScrollView>
            </View>
          );
        }

        // Multi-line text
        if (text.includes("\n")) {
          return (
            <View
              className="max-h-48 rounded bg-surface-foreground/5 p-2"
              key={text.slice(0, 20)}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                <Markdown
                  mergeStyle={false}
                  style={{
                    codeblock: {
                      backgroundColor: "transparent",
                      fontFamily: "monospace",
                    },
                    pre: {
                      backgroundColor: "transparent",
                      padding: 0,
                      margin: 0,
                    },
                    code: {
                      backgroundColor: "transparent",
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: isError ? "#ef4444" : "#cccccc",
                    },
                    text: {
                      color: isDark ? "#ffffff" : "#333333",
                      fontFamily: "monospace",
                      fontSize: 12,
                    },
                  }}
                >
                  {`\`\`\`text\n${text}\n\`\`\`\n`}
                </Markdown>
              </ScrollView>
            </View>
          );
        }

        // Single line text
        return (
          <Text
            className={`font-mono text-xs ${
              isError ? "text-danger" : "text-foreground/80"
            }`}
            key={text.slice(0, 20)}
          >
            {text}
          </Text>
        );
      }

      case "diff": {
        if (!source) {
          return null;
        }
        return (
          <View
            className="rounded bg-surface-foreground/5 p-2"
            key={source.path ?? text?.slice(0, 20)}
          >
            {source.path && (
              <Text className="mb-1 font-bold text-accent text-xs">
                {source.path}
              </Text>
            )}
            {source.oldText && (
              <View className="mb-1" key="old">
                <Text className="font-mono text-danger text-xs">
                  -{source.oldText}
                </Text>
              </View>
            )}
            <View key="new">
              <Text className="font-mono text-success text-xs">
                +{source.text ?? ""}
              </Text>
            </View>
          </View>
        );
      }

      default:
        // Fallback for unknown types
        if (text) {
          return (
            <Text
              className="font-mono text-foreground/80 text-xs"
              key={text.slice(0, 20)}
            >
              {text}
            </Text>
          );
        }
        return null;
    }
  };

  return (
    <View className="gap-2">
      {content.map((item, index) => (
        <View key={index}>{renderContentItem(item)}</View>
      ))}
    </View>
  );
}

function getPartKey(part: MessagePart, index: number): string {
  switch (part.type) {
    case "text":
    case "reasoning":
      return `${part.type}-${part.text.slice(0, 30)}`;
    case "tool_call":
    case "tool_result":
      return `${part.type}-${part.toolCallId}`;
    case "plan":
      return `${part.type}-${part.items.length}-${part.items[0]?.content.slice(0, 20) ?? "empty"}`;
    case "diff":
      return `${part.type}-${part.path}`;
    case "terminal":
      return `${part.type}-${part.terminalId}`;
    default: {
      const _exhaustive: never = part;
      return `${_exhaustive}-${index}`;
    }
  }
}

function getPlanStatusIcon(status: string): string {
  if (status === "completed") {
    return "✓";
  }
  if (status === "in_progress") {
    return "►";
  }
  return "○";
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  terminalOutputs: Map<string, string>;
  onApprove?: (requestId: string, decision: string) => void;
  onReject?: (requestId: string, decision: string) => void;
  contentPaddingBottom?: number;
  keyboardBottomOffset?: number;
}

export function ChatMessages({
  messages,
  terminalOutputs,
  contentPaddingBottom = 100,
  keyboardBottomOffset = 0,
}: ChatMessagesProps) {
  const listPaddingBottom = Math.max(100, contentPaddingBottom);
  const renderScrollComponent = (props: ScrollViewProps) => (
    <KeyboardAwareScrollView {...props} bottomOffset={keyboardBottomOffset} />
  );

  return (
    <FlashList
      contentContainerStyle={{ padding: 16, paddingBottom: listPaddingBottom }}
      data={messages}
      // estimatedItemSize={100}
      // inverted={false}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <MessageItem message={item} terminalOutputs={terminalOutputs} />
      )}
      renderScrollComponent={renderScrollComponent}
    />
  );
}

function MessageItem({
  message,
  terminalOutputs,
}: {
  message: ChatMessage;
  terminalOutputs: Map<string, string>;
}) {
  const isUser = message.role === "user";

  return (
    <View
      className={cn_inline(
        "mb-4 flex-row",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <View
        className={cn_inline(
          "max-w-[85%] rounded-2xl p-3",
          isUser ? "bg-accent" : "bg-surface"
        )}
      >
        {message.parts.map((part, index) => (
          <MessagePartItem
            key={getPartKey(part, index)}
            part={part}
            terminalOutputs={terminalOutputs}
          />
        ))}
      </View>
    </View>
  );
}

function MessagePartItem({
  part,
  terminalOutputs,
}: {
  part: MessagePart;
  terminalOutputs: Map<string, string>;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  if (part.type === "text") {
    return (
      <Markdown
        mergeStyle={false}
        style={{
          text: { color: isDark ? "#ffffff" : "#333333" },
          code: { color: isDark ? "#58a6ff" : "#333333" },
          blockquote: { color: isDark ? "#a0a0a0" : "#666666" },
          link: { color: "#58a6ff" },
        }}
      >
        {part.text}
      </Markdown>
    );
  }

  if (part.type === "reasoning") {
    return (
      <View className="mb-2 border-muted border-l-2 pl-2">
        <Text className="text-muted text-sm italic">{part.text}</Text>
      </View>
    );
  }

  if (part.type === "tool_call") {
    return (
      <View className="mt-2 mb-2 rounded bg-surface p-2">
        <Text className="mb-1 font-bold text-warning text-xs">
          TOOL: {part.name}
        </Text>
        <Text className="mb-2 font-mono text-muted text-xs">
          {JSON.stringify(part.args, null, 2)}
        </Text>
      </View>
    );
  }

  if (part.type === "tool_result") {
    const isError = part.status === "error" || part.status === "failed";
    const statusIcon = isError ? "✗" : "✓";

    return (
      <View className="mt-2">
        <Accordion variant="surface">
          <Accordion.Item value={part.toolCallId}>
            <Accordion.Trigger className="min-h-8 py-2">
              <View className="flex-row items-center gap-2">
                <Text
                  className={`font-bold text-xs ${isError ? "text-danger" : "text-success"}`}
                >
                  {statusIcon}
                </Text>
                <Text
                  className={`font-mono text-xs ${isError ? "text-danger" : "text-success"}`}
                >
                  {part.toolCallId}
                </Text>
              </View>
              <Accordion.Indicator />
            </Accordion.Trigger>
            <Accordion.Content className="px-2 pt-0 pb-2">
              <ToolResultDisplay content={part.content} status={part.status} />
            </Accordion.Content>
          </Accordion.Item>
        </Accordion>
      </View>
    );
  }

  if (part.type === "plan") {
    return (
      <View className="mt-2 mb-2 rounded bg-surface p-2">
        <Text className="mb-1 font-bold text-accent text-xs">PLAN</Text>
        {part.items.map((item) => (
          <View
            className="mb-1 flex-row items-start"
            key={`${item.status}-${item.content.slice(0, 15)}`}
          >
            <Text className="mr-2 text-foreground/80">
              {getPlanStatusIcon(item.status)}
            </Text>
            <Text className="text-foreground/90 text-sm">{item.content}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (part.type === "diff") {
    return (
      <View className="mt-2 mb-2 rounded bg-surface p-2">
        <Text className="mb-1 font-bold text-accent text-xs">
          DIFF: {part.path}
        </Text>
        {part.oldText && (
          <View className="mb-1">
            <Text className="font-mono text-danger text-xs">
              -{part.oldText}
            </Text>
          </View>
        )}
        <View>
          <Text className="font-mono text-success text-xs">
            +{part.newText}
          </Text>
        </View>
      </View>
    );
  }

  if (part.type === "terminal") {
    const output = terminalOutputs.get(part.terminalId);
    if (!output) {
      return null;
    }
    return (
      <View className="mt-2 mb-2 rounded bg-surface p-2">
        <Text className="mb-1 font-bold text-success text-xs">TERMINAL</Text>
        <View className="max-h-40 rounded bg-surface-foreground/10 p-2">
          <Text className="font-mono text-success/80 text-xs">
            {output.slice(-2000)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text className="text-danger">{JSON.stringify(part)}</Text>
    </View>
  );
}
