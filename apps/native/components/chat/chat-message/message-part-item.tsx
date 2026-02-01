import type { UIMessagePart } from "@repo/shared";
import { PartRenderers } from "./part-renderers";
import { getPartKey } from "./utils";

interface MessagePartItemProps {
  part: UIMessagePart;
  terminalOutputs: Map<string, string>;
}

export function MessagePartItem({
  part,
  terminalOutputs,
}: MessagePartItemProps) {
  return (
    <PartRenderers
      key={getPartKey(part, 0)}
      part={part}
      terminalOutputs={terminalOutputs}
    />
  );
}
