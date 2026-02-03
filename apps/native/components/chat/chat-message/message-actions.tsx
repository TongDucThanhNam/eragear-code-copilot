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
  onRegenerate?: () => void;
  onEdit?: () => void;
}

export function MessageActions({
  text,
  className,
  onRegenerate,
  onEdit,
}: MessageActionsProps) {
  const handleCopy = async () => {
    await Clipboard.setStringAsync(text);
  };

  const handleShare = async () => {
    await Share.share({ message: text });
  };

  return (
    <View className={cn_inline("mt-2 flex-row items-center gap-1", className)}>
      <Button
        className="h-7 w-7 rounded-full"
        isIconOnly
        onPress={handleCopy}
        size="sm"
        variant="ghost"
      >
        <Button.Label>
          <StyledIonicons
            className="text-foreground/60"
            name="copy-outline"
            size={14}
          />
        </Button.Label>
      </Button>
      <Button
        className="h-7 w-7 rounded-full"
        isIconOnly
        onPress={handleShare}
        size="sm"
        variant="ghost"
      >
        <Button.Label>
          <StyledIonicons
            className="text-foreground/60"
            name="share-social-outline"
            size={14}
          />
        </Button.Label>
      </Button>
      {onEdit && (
        <Button
          className="h-7 w-7 rounded-full"
          isIconOnly
          onPress={onEdit}
          size="sm"
          variant="ghost"
        >
          <Button.Label>
            <StyledIonicons
              className="text-foreground/60"
              name="create-outline"
              size={14}
            />
          </Button.Label>
        </Button>
      )}
      {onRegenerate && (
        <Button
          className="h-7 w-7 rounded-full"
          isIconOnly
          onPress={onRegenerate}
          size="sm"
          variant="ghost"
        >
          <Button.Label>
            <StyledIonicons
              className="text-foreground/60"
              name="refresh-outline"
              size={14}
            />
          </Button.Label>
        </Button>
      )}
    </View>
  );
}
