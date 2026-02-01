import { compiler as compileMarkdown } from "markdown-to-jsx/native";
import { Children, isValidElement, useCallback, useMemo } from "react";
import {
  Linking,
  Pressable,
  type ImageStyle,
  ScrollView,
  type StyleProp,
  Text,
  type TextStyle,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";
import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";
import type { ToolUIPart } from "@repo/shared";
import { DiffPart } from "./diff-part";
import { TerminalPart } from "./terminal-part";
import { isTerminalOutput } from "./utils";

interface ToolResultDisplayProps {
  output?: unknown;
  state: ToolUIPart["state"];
  terminalOutputs: Map<string, string>;
  errorText?: string;
}

type ToolOutputItem = ToolCallContent | { type: string; [key: string]: unknown };

const isToolOutputItem = (item: unknown): item is ToolOutputItem =>
  typeof item === "object" &&
  item !== null &&
  "type" in item &&
  typeof (item as { type?: unknown }).type === "string";

const isContentBlock = (content: unknown): content is ContentBlock =>
  typeof content === "object" &&
  content !== null &&
  "type" in content &&
  typeof (content as { type?: unknown }).type === "string";

export function ToolResultDisplay({
  output,
  state,
  terminalOutputs,
  errorText,
}: ToolResultDisplayProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isError = state === "output-error" || state === "output-denied";
  const errorLabel = state === "output-denied" ? "Permission denied." : errorText;
  const onLinkPress = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);
  const wrapTextNodes = useCallback(
    (node: React.ReactNode) =>
      Children.map(node, (child) => {
        if (typeof child === "string" || typeof child === "number") {
          return <Text>{child}</Text>;
        }
        if (isValidElement(child)) {
          return child;
        }
        return null;
      }),
    []
  );
  const terminalMarkdownStyles = useMemo(
    () =>
      ({
        paragraph: { marginBottom: 0 },
        text: {
          color: isDark ? "#ffffff" : "#333333",
          fontFamily: "monospace",
          fontSize: 12,
        },
        code: {
          color: isError ? "#ef4444" : "#22c55e",
          fontFamily: "monospace",
          fontSize: 12,
        },
        codeBlock: {
          color: isError ? "#ef4444" : "#22c55e",
          fontFamily: "monospace",
          fontSize: 12,
        },
        codeInline: {
          color: isError ? "#ef4444" : "#22c55e",
          fontFamily: "monospace",
          fontSize: 12,
        },
        pre: { backgroundColor: "transparent" },
        link: { color: "#58a6ff", textDecorationLine: "underline" },
      }) as Record<string, StyleProp<ViewStyle | TextStyle | ImageStyle>>,
    [isDark, isError]
  );
  const terminalMarkdownOptions = useMemo(
    () => ({
      styles: terminalMarkdownStyles,
      onLinkPress,
    }),
    [onLinkPress, terminalMarkdownStyles]
  );
  const blockMarkdownStyles = useMemo(
    () =>
      ({
        paragraph: { marginBottom: 0 },
        text: {
          color: isDark ? "#ffffff" : "#333333",
          fontFamily: "monospace",
          fontSize: 12,
        },
        code: {
          color: isError ? "#ef4444" : "#cccccc",
          fontFamily: "monospace",
          fontSize: 12,
        },
        codeBlock: {
          color: isError ? "#ef4444" : "#cccccc",
          fontFamily: "monospace",
          fontSize: 12,
        },
        codeInline: {
          color: isError ? "#ef4444" : "#cccccc",
          fontFamily: "monospace",
          fontSize: 12,
        },
        pre: { backgroundColor: "transparent" },
        link: { color: "#58a6ff", textDecorationLine: "underline" },
      }) as Record<string, StyleProp<ViewStyle | TextStyle | ImageStyle>>,
    [isDark, isError]
  );
  const blockMarkdownOptions = useMemo(
    () => ({
      styles: blockMarkdownStyles,
      onLinkPress,
    }),
    [blockMarkdownStyles, onLinkPress]
  );

  const renderTextBlock = (text: string, key: string) => {
    if (isTerminalOutput(text)) {
      const terminalMarkdown = wrapTextNodes(
        compileMarkdown(`\`\`\`text\n${text}\n\`\`\`\n`, terminalMarkdownOptions)
      );
      return (
        <View className="max-h-48 rounded bg-surface-foreground/5 p-2" key={key}>
          <ScrollView horizontal showsHorizontalScrollIndicator={true}>
            {terminalMarkdown}
          </ScrollView>
        </View>
      );
    }

    if (text.includes("\n")) {
      const blockMarkdown = wrapTextNodes(
        compileMarkdown(`\`\`\`text\n${text}\n\`\`\`\n`, blockMarkdownOptions)
      );
      return (
        <View className="max-h-48 rounded bg-surface-foreground/5 p-2" key={key}>
          <ScrollView horizontal showsHorizontalScrollIndicator={true}>
            {blockMarkdown}
          </ScrollView>
        </View>
      );
    }

    return (
      <Text
        className={`font-mono text-xs ${
          isError ? "text-danger" : "text-foreground/80"
        }`}
        key={key}
      >
        {text}
      </Text>
    );
  };

  const renderResourceBadge = (label: string, url?: string, key?: string) => (
    <Pressable
      className="rounded border border-divider px-2 py-1"
      disabled={!url}
      key={key}
      onPress={() => (url ? Linking.openURL(url) : undefined)}
    >
      <Text className="text-[11px] text-accent" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  const renderContentBlock = (block: ContentBlock, key: string) => {
    switch (block.type) {
      case "text":
        return renderTextBlock(block.text, key);
      case "resource_link":
        return renderResourceBadge(block.title ?? block.name ?? block.uri, block.uri, key);
      case "resource": {
        const title = block.resource.uri ?? "Resource";
        if ("text" in block.resource && block.resource.text) {
          return renderTextBlock(block.resource.text, key);
        }
        return renderResourceBadge(title, block.resource.uri, key);
      }
      case "image":
      case "audio":
        return renderResourceBadge(block.uri ?? block.mimeType ?? block.type, block.uri, key);
      default:
        return renderTextBlock(JSON.stringify(block, null, 2), key);
    }
  };

  const renderOutputItem = (item: ToolOutputItem, index: number) => {
    if (item.type === "content" && "content" in item && isContentBlock(item.content)) {
      return renderContentBlock(item.content, `content-${index}`);
    }
    if (
      item.type === "diff" &&
      typeof item.path === "string" &&
      typeof item.newText === "string"
    ) {
      return (
        <DiffPart
          key={`diff-${index}`}
          newText={item.newText}
          oldText={typeof item.oldText === "string" ? item.oldText : undefined}
          path={item.path}
        />
      );
    }
    if (item.type === "terminal" && typeof item.terminalId === "string") {
      return (
        <TerminalPart
          key={`terminal-${index}`}
          output={terminalOutputs.get(item.terminalId)}
        />
      );
    }
    if ("text" in item && typeof item.text === "string") {
      return renderTextBlock(item.text, `text-${index}`);
    }
    return renderTextBlock(JSON.stringify(item, null, 2), `raw-${index}`);
  };

  if (!output) {
    return (
      <View className="p-2">
        {errorLabel ? (
          <Text className="font-mono text-danger text-xs">{errorLabel}</Text>
        ) : (
          <Text className="font-mono text-muted text-xs italic">
            (no output)
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="gap-2">
      {errorLabel && (
        <Text className="font-mono text-danger text-xs">{errorLabel}</Text>
      )}
      {Array.isArray(output)
        ? output.map((item, index) => (
            <View key={index}>
              {isToolOutputItem(item)
                ? renderOutputItem(item, index)
                : renderTextBlock(
                    typeof item === "string"
                      ? item
                      : JSON.stringify(item, null, 2),
                    `raw-${index}`
                  )}
            </View>
          ))
        : renderTextBlock(
            typeof output === "string" ? output : JSON.stringify(output, null, 2),
            "output"
          )}
    </View>
  );
}
