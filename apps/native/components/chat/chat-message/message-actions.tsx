import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { memo, useState } from "react";
import { Menu, cn, useThemeColor } from "heroui-native";
import { Pressable } from "react-native";

interface MessageActionsProps {
  text: string;
  className?: string;
  onRegenerate?: () => void;
  onEdit?: () => void;
}

export const MessageActions = memo(function MessageActions({
  text,
  className,
  onRegenerate,
  onEdit,
}: MessageActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [foregroundColor, mutedColor] = useThemeColor([
    "foreground",
    "muted",
  ]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text);
    setIsOpen(false);
  };

  const handleShare = async () => {
    const { Share } = await import("react-native");
    await Share.share({ message: text });
    setIsOpen(false);
  };

  return (
    <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
      <Menu.Trigger asChild>
        <Pressable
          className={cn(
            "mt-1 h-7 w-7 items-center justify-center rounded-full opacity-60 active:bg-default/60",
            className
          )}
        >
          <Ionicons
            color={mutedColor}
            name="ellipsis-horizontal"
            size={15}
          />
        </Pressable>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay />
        <Menu.Content
          className="rounded-2xl border border-divider/70 bg-overlay p-1"
          presentation="popover"
          width={180}
        >
          <Menu.Item onPress={handleCopy}>
            <Ionicons color={foregroundColor} name="copy-outline" size={16} />
            <Menu.ItemTitle>Copy</Menu.ItemTitle>
          </Menu.Item>
          <Menu.Item onPress={handleShare}>
            <Ionicons
              color={foregroundColor}
              name="share-social-outline"
              size={16}
            />
            <Menu.ItemTitle>Share</Menu.ItemTitle>
          </Menu.Item>
          {onEdit ? (
            <Menu.Item
              onPress={() => {
                setIsOpen(false);
                onEdit();
              }}
            >
              <Ionicons
                color={foregroundColor}
                name="create-outline"
                size={16}
              />
              <Menu.ItemTitle>Edit</Menu.ItemTitle>
            </Menu.Item>
          ) : null}
          {onRegenerate ? (
            <Menu.Item
              onPress={() => {
                setIsOpen(false);
                onRegenerate();
              }}
            >
              <Ionicons
                color={foregroundColor}
                name="refresh-outline"
                size={16}
              />
              <Menu.ItemTitle>Regenerate</Menu.ItemTitle>
            </Menu.Item>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
});
