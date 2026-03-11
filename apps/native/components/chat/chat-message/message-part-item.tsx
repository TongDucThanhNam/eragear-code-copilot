import { useState } from "react";
import type { UIMessagePart } from "@repo/shared";
import { PartRenderers } from "./part-renderers";
import { getPartKey } from "./utils";

interface MessagePartItemProps {
  part: UIMessagePart;
}

export function MessagePartItem({ part }: MessagePartItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <PartRenderers
      isExpanded={isExpanded}
      key={getPartKey(part, 0)}
      onToggle={() => setIsExpanded((current) => !current)}
      part={part}
    />
  );
}
