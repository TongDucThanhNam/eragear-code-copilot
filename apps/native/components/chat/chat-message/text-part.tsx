import Markdown from "markdown-to-jsx/native";
import { useCallback, useMemo } from "react";
import {
  type ImageStyle,
  Linking,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";

interface TextPartProps {
  text: string;
}

export function TextPart({ text }: TextPartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const textColor = isDark ? "#E5E5E5" : "#1A1A1A";
  const codeColor = isDark ? "#7DD3FC" : "#0369A1";
  const linkColor = isDark ? "#60A5FA" : "#2563EB";
  const blockquoteColor = isDark ? "#A1A1AA" : "#71717A";

  const onLinkPress = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);

  const markdownStyles = useMemo(
    () =>
      StyleSheet.create({
        // Text styles
        text: { color: textColor, fontSize: 15, lineHeight: 22 },
        paragraph: { color: textColor, marginBottom: 8 },
        span: { color: textColor },

        // Headings
        heading1: {
          color: textColor,
          fontSize: 24,
          fontWeight: "bold",
          marginVertical: 8,
        },
        heading2: {
          color: textColor,
          fontSize: 20,
          fontWeight: "bold",
          marginVertical: 6,
        },
        heading3: {
          color: textColor,
          fontSize: 18,
          fontWeight: "600",
          marginVertical: 4,
        },

        // Emphasis
        strong: { color: textColor, fontWeight: "bold" },
        em: { color: textColor, fontStyle: "italic" },

        // Code
        code: {
          color: codeColor,
          backgroundColor: isDark ? "#1E293B" : "#F1F5F9",
          paddingHorizontal: 4,
          borderRadius: 4,
          fontFamily: "monospace",
        },
        codeBlock: {
          color: codeColor,
          backgroundColor: isDark ? "#1E293B" : "#F1F5F9",
          padding: 12,
          borderRadius: 8,
          marginVertical: 8,
          fontFamily: "monospace",
        },

        // Blockquote
        blockquote: {
          color: blockquoteColor,
          borderLeftWidth: 3,
          borderLeftColor: isDark ? "#4B5563" : "#D1D5DB",
          paddingLeft: 12,
          marginVertical: 8,
        },

        // Links
        link: { color: linkColor, textDecorationLine: "underline" },

        // Lists
        listItem: { color: textColor, marginVertical: 2 },
        listItemText: { color: textColor },
      }) as Record<string, StyleProp<ViewStyle | TextStyle | ImageStyle>>,
    [isDark, textColor, codeColor, linkColor, blockquoteColor]
  );

  const markdownOptions = useMemo(
    () => ({
      styles: markdownStyles,
      onLinkPress,
      wrapper: "Text",
    }),
    [markdownStyles, onLinkPress]
  );

  return (
    <View>
      <Markdown options={markdownOptions}>{text}</Markdown>
    </View>
  );
}
