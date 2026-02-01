import { Text, View } from "react-native";
import { getPlanStatusIcon } from "./utils";

interface PlanItem {
  status: string;
  content: string;
}

interface PlanPartProps {
  items: PlanItem[];
}

export function PlanPart({ items }: PlanPartProps) {
  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Text className="mb-1 font-bold text-accent text-xs">PLAN</Text>
      {items.map((item) => (
        <View
          className="mb-1 flex-row items-start"
          key={`${item.status}-${item.content.slice(0, 15)}`}
        >
          <Text className="mr-2 text-foreground/80">
            {getPlanStatusIcon(item.status)}
          </Text>
          <Text className="text-foreground/90 text-sm">{item.content}</Text>
        </View>
      ))}
    </View>
  );
}
