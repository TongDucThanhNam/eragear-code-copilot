import { useMemo } from "react";
import {
  Linking,
  type ImageStyle,
  ScrollView,
  type StyleProp,
  Text,
  type TextStyle,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";
import Markdown from "markdown-to-jsx/native";
import { isTerminalOutput } from "./utils";

interface ToolResultDisplayProps {
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

export function ToolResultDisplay({ content, status }: ToolResultDisplayProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isError = status === "error" || status === "failed";
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
                  options={{
                    styles: terminalMarkdownStyles,
                    onLinkPress: (url) => {
                      Linking.openURL(url);
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
                  options={{
                    styles: blockMarkdownStyles,
                    onLinkPress: (url) => {
                      Linking.openURL(url);
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
