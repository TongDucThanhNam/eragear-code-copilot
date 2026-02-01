import { Text, View } from "react-native";
import type { ConnectionStatus } from "./types";
import { getStatusColor, getStatusLabel } from "./utils";

interface StatusIndicatorProps {
  status: ConnectionStatus;
  subtitle?: string;
}

export function StatusIndicator({ status, subtitle }: StatusIndicatorProps) {
  const statusColor = getStatusColor(status);
  const statusText = subtitle || getStatusLabel(status);

  return (
    <View className="flex-row items-center">
      <View className={`mr-2 h-1.5 w-1.5 rounded-full ${statusColor}`} />
      <Text className="text-muted text-xs">{statusText}</Text>
    </View>
  );
}
