"use client";

import React from "react";
import { Text, type TextProps, useColorScheme } from "react-native";

type PlainTextProps = TextProps & {
  children?: React.ReactNode;
  done?: boolean;
};

function PlainTextInner({ done, style, children, ...props }: PlainTextProps) {
  const colorScheme = useColorScheme();

  return (
    <Text
      style={[
        {
          color: colorScheme === "dark" ? "#E5E7EB" : "#111827",
          fontSize: 16,
          lineHeight: 22,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}

const PlainText = React.memo(PlainTextInner, (prev, next) => {
  return (
    prev.children === next.children &&
    prev.done === next.done &&
    prev.numberOfLines === next.numberOfLines &&
    prev.style === next.style
  );
});

export default PlainText;
