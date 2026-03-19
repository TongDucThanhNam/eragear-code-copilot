import { Ionicons } from "@expo/vector-icons";
import { BottomSheet, Button, useThemeColor } from "heroui-native";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { withUniwind } from "uniwind";

const StyledIonicons = withUniwind(Ionicons);

interface AttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPickImage: () => void;
  onPickAudio: () => void;
  onPickResource: () => void;
  canPickImage: boolean;
  canPickAudio: boolean;
  canPickResource: boolean;
}

interface AttachmentOption {
  key: string;
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  enabled: boolean;
  onSelect: () => void;
}

export function AttachmentModal({
  isOpen,
  onClose,
  onPickImage,
  onPickAudio,
  onPickResource,
  canPickImage,
  canPickAudio,
  canPickResource,
}: AttachmentModalProps) {
  const mutedColor = useThemeColor("muted");

  const handleSelect = (action: () => void) => {
    onClose();
    requestAnimationFrame(action);
  };

  const options: AttachmentOption[] = [
    {
      key: "photo",
      title: "Photo",
      description: "Attach images from your library",
      icon: "image-outline",
      enabled: canPickImage,
      onSelect: () => handleSelect(onPickImage),
    },
    {
      key: "audio",
      title: "Audio",
      description: "Attach an audio file",
      icon: "musical-notes-outline",
      enabled: canPickAudio,
      onSelect: () => handleSelect(onPickAudio),
    },
    {
      key: "file",
      title: "File",
      description: "Attach a document or resource",
      icon: "document-text-outline",
      enabled: canPickResource,
      onSelect: () => handleSelect(onPickResource),
    },
  ];

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content className="rounded-t-3xl" snapPoints={["48%"]}>
          <View className="flex-1 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <View>
                <BottomSheet.Title className="font-semibold text-foreground text-lg">
                  Add attachment
                </BottomSheet.Title>
                <BottomSheet.Description className="text-muted-foreground text-sm">
                  Pick the content you want to send with this message
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close hitSlop={12}>
                <Ionicons color={mutedColor} name="close" size={20} />
              </BottomSheet.Close>
            </View>

            <View className="flex-1 gap-3">
              {options.map((option) => (
                <Pressable
                  className={`flex-row items-center rounded-2xl border px-4 py-4 ${
                    option.enabled
                      ? "border-divider bg-surface active:bg-default-100"
                      : "border-divider/60 bg-default-100 opacity-60"
                  }`}
                  disabled={!option.enabled}
                  key={option.key}
                  onPress={option.onSelect}
                >
                  <View className="mr-4 h-11 w-11 items-center justify-center rounded-full bg-default-100">
                    <StyledIonicons
                      className="text-foreground"
                      name={option.icon}
                      size={22}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">
                      {option.title}
                    </Text>
                    <Text className="mt-1 text-muted-foreground text-sm">
                      {option.description}
                    </Text>
                  </View>
                  <StyledIonicons
                    className="text-muted-foreground"
                    name="chevron-forward"
                    size={18}
                  />
                </Pressable>
              ))}
            </View>

            <Button
              className="mt-4 rounded-2xl"
              onPress={onClose}
              variant="secondary"
            >
              Cancel
            </Button>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
