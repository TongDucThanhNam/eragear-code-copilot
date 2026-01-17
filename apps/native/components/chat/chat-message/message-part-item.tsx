import type { MessagePart } from "@/store/chat-store";
import { PartRenderers } from "./part-renderers";
import { getPartKey } from "./utils";

interface MessagePartItemProps {
  part: MessagePart;
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
