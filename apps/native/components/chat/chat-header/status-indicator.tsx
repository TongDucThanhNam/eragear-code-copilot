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
      <View className={`mr-2 h-2 w-2 rounded-full ${statusColor}`} />
      <Text className="text-muted text-sm">{statusText}</Text>
    </View>
  );
}
