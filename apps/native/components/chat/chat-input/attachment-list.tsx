import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { withUniwind } from "uniwind";
import type { Attachment } from "@/lib/attachments";
import { formatBytes } from "@/lib/attachments";

const StyledIcon = withUniwind(Ionicons);

interface AttachmentListProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <View className="px-2 pt-1 pb-1">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {attachments.map((attachment) => {
          const label =
            attachment.name ||
            (attachment.kind === "image"
              ? "Image"
              : attachment.kind === "audio"
                ? "Audio"
                : "Resource");
          const meta = formatBytes(attachment.size);
          const iconName =
            attachment.kind === "audio"
              ? "musical-notes"
              : attachment.kind === "resource"
                ? "document-text"
                : "image";

          return (
            <View className="mr-2 w-24" key={attachment.id}>
              <View className="relative h-20 overflow-hidden rounded-2xl bg-black/20">
                {attachment.kind === "image" ? (
                  <Image
                    className="h-full w-full"
                    resizeMode="cover"
                    source={{ uri: attachment.uri }}
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <StyledIcon
                      className="text-foreground/70"
                      name={iconName}
                      size={22}
                    />
                  </View>
                )}
                <Pressable
                  className="absolute top-1 right-1 h-6 w-6 items-center justify-center rounded-full bg-black/55"
                  onPress={() => onRemove(attachment.id)}
                >
                  <StyledIcon className="text-white" name="close" size={14} />
                </Pressable>
              </View>
              <Text
                className="mt-1.5 text-foreground text-xs"
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text className="text-[10px] text-muted-foreground">{meta}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
