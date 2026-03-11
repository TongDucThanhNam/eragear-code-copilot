"use client";

import React from "react";
import { useThemeColor } from "heroui-native";
import { Text, type TextProps } from "react-native";

type PlainTextProps = TextProps & {
  children?: React.ReactNode;
  done?: boolean;
};

function PlainTextInner({ done, style, children, ...props }: PlainTextProps) {
  const foregroundColor = useThemeColor("foreground");

  return (
    <Text
      style={[
        {
          color: foregroundColor,
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
