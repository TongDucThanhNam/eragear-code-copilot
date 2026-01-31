import { Modal, Text, TouchableOpacity, View } from "react-native";

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
  return (
    <Modal animationType="slide" transparent visible={isOpen}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-surface p-6">
          <Text className="mb-4 font-bold text-foreground text-lg">
            Add attachment
          </Text>
          <View className="gap-3">
            <TouchableOpacity
              className={`rounded-xl p-4 ${
                canPickImage ? "bg-default-100" : "bg-default-200 opacity-60"
              }`}
              disabled={!canPickImage}
              onPress={() => {
                onPickImage();
                onClose();
              }}
            >
              <Text className="font-semibold text-foreground">Photo</Text>
              <Text className="text-muted-foreground text-xs">
                Attach images from your library
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`rounded-xl p-4 ${
                canPickAudio ? "bg-default-100" : "bg-default-200 opacity-60"
              }`}
              disabled={!canPickAudio}
              onPress={() => {
                onPickAudio();
                onClose();
              }}
            >
              <Text className="font-semibold text-foreground">Audio</Text>
              <Text className="text-muted-foreground text-xs">
                Attach an audio file
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`rounded-xl p-4 ${
                canPickResource ? "bg-default-100" : "bg-default-200 opacity-60"
              }`}
              disabled={!canPickResource}
              onPress={() => {
                onPickResource();
                onClose();
              }}
            >
              <Text className="font-semibold text-foreground">File</Text>
              <Text className="text-muted-foreground text-xs">
                Attach a document or resource
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="rounded-xl bg-default-200 p-4"
              onPress={onClose}
            >
              <Text className="text-center font-semibold text-foreground">
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
