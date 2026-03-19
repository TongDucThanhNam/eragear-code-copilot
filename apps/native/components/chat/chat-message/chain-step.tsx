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
    <View className="flex-row gap-3">
      <View className="w-6 items-center">
        <View
          className={cn(
            "h-6 w-6 items-center justify-center rounded-full border border-divider bg-background",
            isActive && "border-accent/60 bg-accent/10"
          )}
        >
          {getChainIcon(part, isActive)}
        </View>
        {!isLast && (
          <View
            className="mt-1 w-px flex-1 bg-divider"
            style={{ minHeight: 12 }}
          />
        )}
      </View>
      <View className={cn("flex-1", !isLast && "pb-3")}>{children}</View>
    </View>
  );
}
