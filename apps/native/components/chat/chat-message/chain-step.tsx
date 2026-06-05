import type { UIMessagePart } from "@repo/shared";
import { cn } from "heroui-native";
import type React from "react";
import { View } from "react-native";
import { getChainIcon } from "./agentic-chain.utils";

interface ChainStepProps {
  part: UIMessagePart;
  isLast: boolean;
  isActive: boolean;
  children: React.ReactNode;
}

export function ChainStep({
  part,
  isLast,
  isActive,
  children,
}: ChainStepProps) {
  return (
    <View className="flex-row gap-2.5">
      <View className="w-5 items-center">
        <View
          className={cn(
            "h-5 w-5 items-center justify-center rounded-full bg-default",
            isActive && "bg-accent/10"
          )}
        >
          {getChainIcon(part, isActive)}
        </View>
        {!isLast && (
          <View
            className="mt-1 w-px flex-1 bg-divider/70"
            style={{ minHeight: 8 }}
          />
        )}
      </View>
      <View className={cn("min-w-0 flex-1", !isLast && "pb-2")}>
        {children}
      </View>
    </View>
  );
}
