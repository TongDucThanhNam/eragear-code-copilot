import { FileTextIcon, ImageIcon, LinkIcon } from "lucide-react";
import type { FilePart, SourcePart } from "../agentic-message-utils";

export const getSourceIcon = (part: SourcePart) => {
  if (part.type === "source-url") {
    return LinkIcon;
  }
  return FileTextIcon;
};

export const getFileIcon = (part: FilePart) => {
  if (part.mediaType?.startsWith("image/")) {
    return ImageIcon;
  }
  return FileTextIcon;
};
