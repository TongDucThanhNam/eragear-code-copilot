"use client";

import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import Markdown from "react-native-markdown-display";

export default function MarkdownText({
  done,
  ...props
}: React.ComponentProps<typeof Markdown> & { done?: boolean }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  useEffect(() => {
    if (process.env.EXPO_OS === "ios") {
      if (done) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.selectionAsync();
      }
    }
  }, [done]);
  return (
    <>
      <Markdown
        debugPrintTree={false}
        style={{
          body: {
            color: isDark ? "#E5E7EB" : "#111827",
            paddingHorizontal: 0,
          },
          paragraph: {
            fontSize: 16,
            lineHeight: 22,
          },
          em: {
            fontStyle: "italic",
          },
          code_inline: {
            backgroundColor: isDark ? "#1F2937" : "#E5E7EB",
            paddingHorizontal: 2,
            borderRadius: 2,
            paddingVertical: 0,
          },
          strong: {},
          blockquote: {
            backgroundColor: isDark ? "#111827" : "#F3F4F6",
          },
          fence: {
            borderWidth: 0,
            backgroundColor: isDark ? "#111827" : "#F3F4F6",
          },
        }}
        {...props}
      />
      {/* TODO: Add a toolbar to the end of the text message when it's complete. */}
    </>
  );
}
