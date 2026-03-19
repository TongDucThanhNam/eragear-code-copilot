import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useToast } from "heroui-native";
import { useCallback, useState } from "react";
import {
  type Attachment,
  createAttachmentId,
  estimateBase64Bytes,
  formatBytes,
  guessMimeType,
  isTextMimeType,
  MAX_ATTACHMENTS,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_RESOURCE_BYTES,
  MAX_TOTAL_BYTES,
} from "@/lib/attachments";
import type { PromptCapabilities } from "@/store/chat-store";

export function useMessageAttachments(options: {
  promptCapabilities: PromptCapabilities | null;
}) {
  const { promptCapabilities } = options;
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);

  const canAttachImages = promptCapabilities?.image !== false;
  const canAttachAudio = promptCapabilities?.audio !== false;
  const canAttachResources = promptCapabilities?.embeddedContext !== false;

  const addAttachments = useCallback(
    (next: Attachment[]) => {
      if (next.length === 0) {
        return;
      }
      setAttachments((current) => {
        if (current.length >= MAX_ATTACHMENTS) {
          toast.show(`You can attach up to ${MAX_ATTACHMENTS} items.`);
          return current;
        }
        const remaining = MAX_ATTACHMENTS - current.length;
        const merged = [...current, ...next.slice(0, remaining)];
        const totalBytes = merged.reduce((sum, item) => sum + item.size, 0);
        if (totalBytes > MAX_TOTAL_BYTES) {
          toast.show(
            `Total attachments exceed ${formatBytes(MAX_TOTAL_BYTES)}.`
          );
          return current;
        }
        return merged;
      });
    },
    [toast]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const resetAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const readFileAsBase64 = useCallback(async (uri: string) => {
    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }, []);

  const readFileAsText = useCallback(async (uri: string) => {
    return await FileSystem.readAsStringAsync(uri);
  }, []);

  const pickImages = useCallback(async () => {
    try {
      if (!canAttachImages) {
        toast.show("This agent does not support images.");
        return;
      }
      const remaining = MAX_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        toast.show(`You can attach up to ${MAX_ATTACHMENTS} items.`);
        return;
      }
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.show("Photo library permission is required.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        base64: true,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (result.canceled) {
        return;
      }

      const next: Attachment[] = [];
      for (const asset of result.assets ?? []) {
        if (!(asset.base64 && asset.mimeType)) {
          continue;
        }
        const size = asset.fileSize ?? estimateBase64Bytes(asset.base64 ?? "");
        if (size > MAX_IMAGE_BYTES) {
          toast.show(`Image is too large (${formatBytes(size)}).`);
          continue;
        }
        next.push({
          id: createAttachmentId(),
          kind: "image",
          uri: asset.uri,
          name: asset.fileName ?? "image",
          mimeType: asset.mimeType,
          base64: asset.base64,
          size,
        });
      }
      addAttachments(next);
    } catch (error) {
      console.error("Failed to pick images", error);
      toast.show("Failed to attach images.");
    }
  }, [addAttachments, attachments.length, canAttachImages, toast]);

  const pickAudio = useCallback(async () => {
    try {
      if (!canAttachAudio) {
        toast.show("This agent does not support audio.");
        return;
      }
      const remaining = MAX_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        toast.show(`You can attach up to ${MAX_ATTACHMENTS} items.`);
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }

      const next: Attachment[] = [];
      for (const asset of result.assets.slice(0, remaining)) {
        const size = asset.size ?? 0;
        if (size > MAX_AUDIO_BYTES) {
          toast.show(`Audio file is too large (${formatBytes(size)}).`);
          continue;
        }
        const base64 = await readFileAsBase64(asset.uri);
        const resolvedSize = size || estimateBase64Bytes(base64);
        if (resolvedSize > MAX_AUDIO_BYTES) {
          toast.show(`Audio file is too large (${formatBytes(resolvedSize)}).`);
          continue;
        }
        next.push({
          id: createAttachmentId(),
          kind: "audio",
          uri: asset.uri,
          name: asset.name ?? "audio",
          mimeType: asset.mimeType ?? guessMimeType(asset.name) ?? "audio/mpeg",
          base64,
          size: resolvedSize,
        });
      }
      addAttachments(next);
    } catch (error) {
      console.error("Failed to pick audio", error);
      toast.show("Failed to attach audio.");
    }
  }, [
    addAttachments,
    attachments.length,
    canAttachAudio,
    readFileAsBase64,
    toast,
  ]);

  const pickResource = useCallback(async () => {
    try {
      if (!canAttachResources) {
        toast.show("This agent does not support embedded context.");
        return;
      }
      const remaining = MAX_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        toast.show(`You can attach up to ${MAX_ATTACHMENTS} items.`);
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }

      const next: Attachment[] = [];
      for (const asset of result.assets.slice(0, remaining)) {
        const size = asset.size ?? 0;
        if (size > MAX_RESOURCE_BYTES) {
          toast.show(`File is too large (${formatBytes(size)}).`);
          continue;
        }
        const mimeType =
          asset.mimeType ??
          guessMimeType(asset.name) ??
          "application/octet-stream";
        if (isTextMimeType(mimeType, asset.name)) {
          const text = await readFileAsText(asset.uri);
          const resolvedSize = size || text.length;
          if (resolvedSize > MAX_RESOURCE_BYTES) {
            toast.show(`File is too large (${formatBytes(resolvedSize)}).`);
            continue;
          }
          next.push({
            id: createAttachmentId(),
            kind: "resource",
            uri: asset.uri,
            name: asset.name ?? "resource",
            mimeType,
            text,
            size: resolvedSize,
          });
        } else {
          const blob = await readFileAsBase64(asset.uri);
          const resolvedSize = size || estimateBase64Bytes(blob);
          if (resolvedSize > MAX_RESOURCE_BYTES) {
            toast.show(`File is too large (${formatBytes(resolvedSize)}).`);
            continue;
          }
          next.push({
            id: createAttachmentId(),
            kind: "resource",
            uri: asset.uri,
            name: asset.name ?? "resource",
            mimeType,
            blob,
            size: resolvedSize,
          });
        }
      }
      addAttachments(next);
    } catch (error) {
      console.error("Failed to pick files", error);
      toast.show("Failed to attach files.");
    }
  }, [
    addAttachments,
    attachments.length,
    canAttachResources,
    readFileAsBase64,
    readFileAsText,
    toast,
  ]);

  return {
    attachments,
    canAttachAudio,
    canAttachImages,
    canAttachResources,
    isAttachmentModalOpen,
    openAttachmentModal: () => setIsAttachmentModalOpen(true),
    closeAttachmentModal: () => setIsAttachmentModalOpen(false),
    pickAudio,
    pickImages,
    pickResource,
    removeAttachment,
    resetAttachments,
  };
}
