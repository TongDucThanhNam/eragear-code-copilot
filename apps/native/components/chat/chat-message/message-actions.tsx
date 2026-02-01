import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Button } from "heroui-native";
import { Share, View } from "react-native";
import { withUniwind } from "uniwind";
import { cn_inline } from "./utils";

const StyledIonicons = withUniwind(Ionicons);

interface MessageActionsProps {
  text: string;
  className?: string;
}

export function MessageActions({ text, className }: MessageActionsProps) {
  const handleCopy = async () => {
    await Clipboard.setStringAsync(text);
  };

  const handleShare = async () => {
    await Share.share({ message: text });
  };

  return (
    <View className={cn_inline("mt-1 flex-row items-center gap-2", className)}>
      <Button
        className="h-8 w-8 rounded-full"
        isIconOnly
        onPress={handleCopy}
        size="sm"
        variant="ghost"
      >
        <Button.Label>
          <StyledIonicons
            className="text-foreground/70"
            name="copy-outline"
            size={16}
          />
        </Button.Label>
      </Button>
      <Button
        className="h-8 w-8 rounded-full"
        isIconOnly
        onPress={handleShare}
        size="sm"
        variant="ghost"
      >
        <Button.Label>
          <StyledIonicons
            className="text-foreground/70"
            name="share-social-outline"
            size={16}
          />
        </Button.Label>
      </Button>
    </View>
  );
}
