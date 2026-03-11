import { Pressable, Text } from "react-native";
import { cn } from "heroui-native";

interface AttachmentBadgeProps {
  label: string;
  onPress?: () => void;
  className?: string;
}

export function AttachmentBadge({
  label,
  onPress,
  className,
}: AttachmentBadgeProps) {
  return (
    <Pressable
      className={cn(
        "rounded border border-divider px-2 py-1",
        className
      )}
      disabled={!onPress}
      onPress={onPress}
    >
      <Text className="text-[11px] text-accent" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
