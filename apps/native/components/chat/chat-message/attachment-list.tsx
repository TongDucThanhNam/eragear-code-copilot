import { Linking, View } from "react-native";
import type { FilePart, SourcePart } from "./agentic-message-utils";
import { AttachmentBadge } from "./attachment-badge";
import { getPartKey } from "./utils";

interface AttachmentListProps {
  items: Array<SourcePart | FilePart>;
}

export function AttachmentList({ items }: AttachmentListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((part, index) => {
        if (part.type === "source-url") {
          const label = part.title ?? part.url;
          return (
            <AttachmentBadge
              key={getPartKey(part, index)}
              label={label}
              onPress={() => Linking.openURL(part.url)}
            />
          );
        }
        if (part.type === "source-document") {
          const label = part.title ?? part.filename ?? part.sourceId;
          return (
            <AttachmentBadge key={getPartKey(part, index)} label={label} />
          );
        }
        const label = part.filename ?? part.mediaType ?? "File";
        return <AttachmentBadge key={getPartKey(part, index)} label={label} />;
      })}
    </View>
  );
}
