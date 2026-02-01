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
    <View className="flex-1 px-2">
      <Text className="font-semibold text-base text-foreground" numberOfLines={1}>
        {title}
      </Text>
      <StatusIndicator status={status} subtitle={subtitle} />
    </View>
  );
}
