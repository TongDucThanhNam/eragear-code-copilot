import type { UIMessagePart } from "@repo/shared";
import { PartRenderers } from "./part-renderers";
import { getPartKey } from "./utils";

interface MessagePartItemProps {
  part: UIMessagePart;
}

export function MessagePartItem({ part }: MessagePartItemProps) {
  return (
    <PartRenderers key={getPartKey(part, 0)} part={part} />
  );
}
