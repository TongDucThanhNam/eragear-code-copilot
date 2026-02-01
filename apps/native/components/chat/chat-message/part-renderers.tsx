import { Linking, Pressable, Text, View } from "react-native";
import type { ToolUIPart, UIMessagePart } from "@repo/shared";
import { PlanPart } from "./plan-part";
import { ReasoningPart } from "./reasoning-part";
import MarkdownText from "./text-part";
import { ToolCallPart } from "./tool-call-part";
import { ToolResultPart } from "./tool-result-part";

interface PartRenderersProps {
  part: UIMessagePart;
  terminalOutputs: Map<string, string>;
}

const isToolPart = (part: UIMessagePart): part is ToolUIPart =>
  part.type.startsWith("tool-");

const getToolTitle = (tool: ToolUIPart) =>
  tool.title ?? tool.type.replace(/^tool-/, "tool");

const isPlanOutput = (
  output: unknown
): output is { entries: Array<{ content: string; status: string }> } =>
  typeof output === "object" &&
  output !== null &&
  Array.isArray((output as { entries?: unknown }).entries);

const SourceBadge = ({
  label,
  onPress,
}: {
  label: string;
  onPress?: () => void;
}) => (
  <Pressable
    className="mt-2 mb-2 rounded border border-divider px-2 py-1"
    disabled={!onPress}
    onPress={onPress}
  >
    <Text className="text-[11px] text-accent" numberOfLines={1}>
      {label}
    </Text>
  </Pressable>
);

export function PartRenderers({ part, terminalOutputs }: PartRenderersProps) {
  switch (part.type) {
    case "text":
      return <MarkdownText>{part.text}</MarkdownText>;

    case "reasoning":
      return <ReasoningPart text={part.text} />;
    case "source-url": {
      const label = part.title ?? part.url;
      return <SourceBadge label={label} onPress={() => Linking.openURL(part.url)} />;
    }

    case "source-document": {
      const label = part.title ?? part.filename ?? part.sourceId;
      return <SourceBadge label={label} />;
    }

    case "file": {
      const label = part.filename ?? part.mediaType ?? "File";
      return <SourceBadge label={label} />;
    }

    case "step-start":
      return (
        <View className="mt-2 mb-2">
          <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Step
          </Text>
        </View>
      );

    default:
      if (isToolPart(part)) {
        const title = getToolTitle(part);
        if (part.type === "tool-plan" && part.state === "output-available" && isPlanOutput(part.output)) {
          const items = part.output.entries.map((entry) => ({
            content: entry.content,
            status: entry.status,
          }));
          return <PlanPart items={items} />;
        }
        return (
          <View>
            <ToolCallPart input={part.input} state={part.state} title={title} />
            {(part.state === "output-available" ||
              part.state === "output-error" ||
              part.state === "output-denied") && (
              <ToolResultPart
                errorText={part.state === "output-error" ? part.errorText : undefined}
                output={part.state === "output-available" ? part.output : undefined}
                state={part.state}
                terminalOutputs={terminalOutputs}
                toolCallId={part.toolCallId}
              />
            )}
          </View>
        );
      }
      if (part.type.startsWith("data-")) {
        return null;
      }
      return (
        <View>
          <Text className="text-danger">{JSON.stringify(part)}</Text>
        </View>
      );
  }
}
