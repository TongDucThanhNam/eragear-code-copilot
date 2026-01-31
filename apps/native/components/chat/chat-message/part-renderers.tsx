import { Accordion } from "heroui-native";
import { useMemo } from "react";
import {
  Linking,
  type ImageStyle,
  type StyleProp,
  Text,
  type TextStyle,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";
import Markdown from "markdown-to-jsx/native";
import type { MessagePart } from "@/store/chat-store";
import { ToolResultDisplay } from "./tool-result-display";
import { getPlanStatusIcon } from "./utils";

interface TextPartProps {
  text: string;
}

export function TextPart({ text }: TextPartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const markdownStyles = useMemo(
    () =>
      ({
        paragraph: { marginBottom: 8 },
        text: { color: isDark ? "#ffffff" : "#333333" },
        code: { color: isDark ? "#58a6ff" : "#333333" },
        blockquote: { color: isDark ? "#a0a0a0" : "#666666" },
        link: { color: "#58a6ff", textDecorationLine: "underline" },
      }) as Record<string, StyleProp<ViewStyle | TextStyle | ImageStyle>>,
    [isDark]
  );

  return (
    <Markdown
      options={{
        styles: markdownStyles,
        onLinkPress: (url) => {
          Linking.openURL(url);
        },
      }}
    >
      {text}
    </Markdown>
  );
}

interface ReasoningPartProps {
  text: string;
}

export function ReasoningPart({ text }: ReasoningPartProps) {
  return (
    <View className="mb-2 border-muted border-l-2 pl-2">
      <Text className="text-muted text-sm italic">{text}</Text>
    </View>
  );
}

interface ToolCallPartProps {
  name: string;
  args: Record<string, unknown>;
}

export function ToolCallPart({ name, args }: ToolCallPartProps) {
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-warning text-xs">TOOL: {name}</Text>
      <Text className="mb-2 font-mono text-muted text-xs">
        {JSON.stringify(args, null, 2)}
      </Text>
    </View>
  );
}

interface ToolResultPartProps {
  toolCallId: string;
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
}

export function ToolResultPart({
  toolCallId,
  content,
  status,
}: ToolResultPartProps) {
  const isError = status === "error" || status === "failed";
  const statusIcon = isError ? "✗" : "✓";

  return (
    <View className="mt-2">
      <Accordion variant="surface">
        <Accordion.Item value={toolCallId}>
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
                {toolCallId}
              </Text>
            </View>
            <Accordion.Indicator />
          </Accordion.Trigger>
          <Accordion.Content className="px-2 pt-0 pb-2">
            <ToolResultDisplay content={content} status={status} />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </View>
  );
}

interface PlanItem {
  status: string;
  content: string;
}

interface PlanPartProps {
  items: PlanItem[];
}

export function PlanPart({ items }: PlanPartProps) {
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-accent text-xs">PLAN</Text>
      {items.map((item) => (
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

interface DiffPartProps {
  path: string;
  oldText?: string;
  newText?: string;
}

export function DiffPart({ path, oldText, newText }: DiffPartProps) {
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-accent text-xs">DIFF: {path}</Text>
      {oldText && (
        <View className="mb-1">
          <Text className="font-mono text-danger text-xs">-{oldText}</Text>
        </View>
      )}
      <View>
        <Text className="font-mono text-success text-xs">+{newText}</Text>
      </View>
    </View>
  );
}

interface TerminalPartProps {
  // TODO: Embeb Terminal
  // terminalId: string;
  output: string | undefined;
}

export function TerminalPart({
  // terminalId,
  output,
}: TerminalPartProps) {
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

interface PartRenderersProps {
  part: MessagePart;
  terminalOutputs: Map<string, string>;
}

export function PartRenderers({ part, terminalOutputs }: PartRenderersProps) {
  switch (part.type) {
    case "text":
      return <TextPart text={part.text} />;

    case "reasoning":
      return <ReasoningPart text={part.text} />;

    case "tool_call":
      return <ToolCallPart args={part.args} name={part.name} />;

    case "tool_result":
      return (
        <ToolResultPart
          content={part.content}
          status={part.status}
          toolCallId={part.toolCallId}
        />
      );

    case "plan":
      return <PlanPart items={part.items} />;

    case "diff":
      return (
        <DiffPart
          newText={part.newText}
          oldText={part.oldText}
          path={part.path}
        />
      );

    case "terminal":
      return (
        <TerminalPart
          output={terminalOutputs.get(part.terminalId)}
          // terminalId={part.terminalId}
        />
      );

    default:
      return (
        <View>
          <Text className="text-danger">{JSON.stringify(part)}</Text>
        </View>
      );
  }
}
