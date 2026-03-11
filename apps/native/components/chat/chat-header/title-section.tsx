import { Text, View } from "react-native";
import { StatusIndicator } from "./status-indicator";
import type { ConnectionStatus } from "./types";

interface TitleSectionProps {
  title: string;
  status: ConnectionStatus;
  subtitle?: string;
}

export function TitleSection({ title, status, subtitle }: TitleSectionProps) {
  return (
    <View className="min-w-0 flex-1 px-2">
      <Text
        className="font-semibold text-[17px] text-foreground"
        numberOfLines={1}
      >
        {title}
      </Text>
      <View className="mt-0.5 flex-row items-center gap-2">
        {subtitle ? (
          <Text
            className="min-w-0 flex-1 text-muted-foreground text-xs"
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        <StatusIndicator status={status} />
      </View>
    </View>
  );
}
