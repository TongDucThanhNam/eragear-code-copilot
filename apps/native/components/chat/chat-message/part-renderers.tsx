import type { ToolUIPart, UIMessagePart } from "@repo/shared";
import { Linking, Text, View } from "react-native";
import { AttachmentBadge } from "./attachment-badge";
import { PlanPart } from "./plan-part";
import { ReasoningPart } from "./reasoning-part";
import MarkdownText from "./text-part";
import { ToolCallPart } from "./tool-call-part";

interface PartRenderersProps {
  isExpanded: boolean;
  onToggle: () => void;
  part: UIMessagePart;
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

export function PartRenderers({
  isExpanded,
  onToggle,
  part,
}: PartRenderersProps) {
  switch (part.type) {
    case "text":
      return <MarkdownText>{part.text}</MarkdownText>;

    case "reasoning":
      return (
        <ReasoningPart
          isExpanded={isExpanded}
          onToggle={onToggle}
          state={part.state}
          text={part.text}
        />
      );
    case "source-url": {
      const label = part.title ?? part.url;
      return (
        <AttachmentBadge
          className="mt-2 mb-2"
          label={label}
          onPress={() => Linking.openURL(part.url)}
        />
      );
    }

    case "source-document": {
      const label = part.title ?? part.filename ?? part.sourceId;
      return <AttachmentBadge className="mt-2 mb-2" label={label} />;
    }

    case "file": {
      const label = part.filename ?? part.mediaType ?? "File";
      return <AttachmentBadge className="mt-2 mb-2" label={label} />;
    }

    case "step-start":
      return (
        <View className="mt-2 mb-2">
          <Text className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Step
          </Text>
        </View>
      );

    default:
      if (isToolPart(part)) {
        const title = getToolTitle(part);
        if (
          part.type === "tool-plan" &&
          part.state === "output-available" &&
          isPlanOutput(part.output)
        ) {
          const items = part.output.entries.map((entry) => ({
            content: entry.content,
            status: entry.status,
          }));
          return (
            <ToolCallPart
              details={<PlanPart items={items} />}
              input={part.input}
              isExpanded={isExpanded}
              onToggle={onToggle}
              state={part.state}
              title={title}
              toolCallId={part.toolCallId}
            />
          );
        }
        return (
          <ToolCallPart
            errorText={
              part.state === "output-error" ? part.errorText : undefined
            }
            input={part.input}
            isExpanded={isExpanded}
            onToggle={onToggle}
            output={part.state === "output-available" ? part.output : undefined}
            state={part.state}
            title={title}
            toolCallId={part.toolCallId}
          />
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
