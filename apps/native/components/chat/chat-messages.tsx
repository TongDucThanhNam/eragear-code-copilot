import { FlashList } from "@shopify/flash-list";
import type { ScrollViewProps } from "react-native";
import { Text, useColorScheme, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Markdown from "react-native-markdown-display";
import type { ChatMessage, MessagePart } from "@/store/chat-store";

// Inline helper if not exists
const cn_inline = (...classes: (string | undefined)[]) =>
  classes.filter(Boolean).join(" ");

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
    return (
      <View className="mt-2 mb-2 rounded bg-surface p-2">
        <Text className="mb-1 font-bold text-success text-xs">
          RESULT: {part.status}
        </Text>
        <Text className="font-mono text-foreground/80 text-xs">
          {typeof part.output === "string"
            ? part.output
            : JSON.stringify(part.output, null, 2)}
        </Text>
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
