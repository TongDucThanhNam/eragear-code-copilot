"use client";

import React from "react";
import { useColorScheme } from "react-native";
import Markdown from "react-native-markdown-display";

type MarkdownTextProps = React.ComponentProps<typeof Markdown> & {
  done?: boolean;
};

const LIGHT_STYLES = {
  body: { color: "#111827", paddingHorizontal: 0 },
  paragraph: { fontSize: 16, lineHeight: 22 },
  em: { fontStyle: "italic" as const },
  code_inline: {
    backgroundColor: "#E5E7EB",
    paddingHorizontal: 2,
    borderRadius: 2,
    paddingVertical: 0,
  },
  strong: {},
  blockquote: { backgroundColor: "#F3F4F6" },
  fence: { borderWidth: 0, backgroundColor: "#F3F4F6" },
};

const DARK_STYLES = {
  body: { color: "#E5E7EB", paddingHorizontal: 0 },
  paragraph: { fontSize: 16, lineHeight: 22 },
  em: { fontStyle: "italic" as const },
  code_inline: {
    backgroundColor: "#1F2937",
    paddingHorizontal: 2,
    borderRadius: 2,
    paddingVertical: 0,
  },
  strong: {},
  blockquote: { backgroundColor: "#111827" },
  fence: { borderWidth: 0, backgroundColor: "#111827" },
};

function MarkdownTextInner({ done, ...props }: MarkdownTextProps) {
  const colorScheme = useColorScheme();
  const styles = colorScheme === "dark" ? DARK_STYLES : LIGHT_STYLES;
  return <Markdown debugPrintTree={false} style={styles} {...props} />;
}

const MarkdownText = React.memo(MarkdownTextInner, (prev, next) => {
  // Only re-render when markdown content actually changes
  return prev.children === next.children && prev.done === next.done;
});

export default MarkdownText;
