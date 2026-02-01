import { compiler as compileMarkdown } from "markdown-to-jsx/native";
import { Children, isValidElement, useCallback, useMemo } from "react";
import {
  type ImageStyle,
  Linking,
  type StyleProp,
  Text,
  type TextStyle,
  useColorScheme,
} from "react-native";

interface TextPartProps {
  text: string;
}

export function TextPart({ text }: TextPartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

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

  const markdownOptions = useMemo(
    () => ({
      styles: markdownStyles,
      onLinkPress,
    }),
    [markdownStyles, onLinkPress]
  );

  const renderedMarkdown = useMemo(
    () => wrapTextNodes(compileMarkdown(text, markdownOptions)),
    [markdownOptions, text, wrapTextNodes]
  );

  return <>{renderedMarkdown}</>;
}
