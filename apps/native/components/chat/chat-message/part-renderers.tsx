import { Text, View } from "react-native";
import type { MessagePart } from "@/store/chat-store";
import { DiffPart } from "./diff-part";
import { PlanPart } from "./plan-part";
import { ReasoningPart } from "./reasoning-part";
import { TerminalPart } from "./terminal-part";
import { TextPart } from "./text-part";
import { ToolCallPart } from "./tool-call-part";
import { ToolResultPart } from "./tool-result-part";

interface PartRenderersProps {
  part: MessagePart;
  terminalOutputs: Map<string, string>;
}

export function PartRenderers({ part, terminalOutputs }: PartRenderersProps) {
  switch (part.type) {
    case "text":
      return <TextPart text={part.text} />;

    case "reasoning":
      return <ReasoningPart text={part.text} />;

    case "tool_call":
      return <ToolCallPart args={part.args} name={part.name} />;

    case "tool_result":
      return (
        <ToolResultPart
          content={part.content}
          status={part.status}
          toolCallId={part.toolCallId}
        />
      );

    case "plan":
      return <PlanPart items={part.items} />;

    case "diff":
      return (
        <DiffPart
          newText={part.newText}
          oldText={part.oldText}
          path={part.path}
        />
      );

    case "terminal":
      return (
        <TerminalPart
          output={terminalOutputs.get(part.terminalId)}
          // terminalId={part.terminalId}
        />
      );

    default:
      return (
        <View>
          <Text className="text-danger">{JSON.stringify(part)}</Text>
        </View>
      );
  }
}
