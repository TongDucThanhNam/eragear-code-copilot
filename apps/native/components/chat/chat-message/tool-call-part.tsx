import { Accordion } from "heroui-native";
import { memo, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { ToolUIPart } from "@repo/shared";

type AccordionValue = string | string[] | undefined;

interface ToolCallPartProps {
  toolCallId: string;
  title: string;
  input: ToolUIPart["input"];
  state: ToolUIPart["state"];
}

const statusMeta: Record<
  ToolUIPart["state"],
  { label: string; className: string }
> = {
  "input-streaming": { label: "Preparing", className: "text-muted" },
  "input-available": { label: "Running", className: "text-warning" },
  "approval-requested": { label: "Awaiting approval", className: "text-warning" },
  "approval-responded": { label: "Approved", className: "text-success" },
  "output-available": { label: "Completed", className: "text-success" },
  "output-error": { label: "Failed", className: "text-danger" },
  "output-denied": { label: "Denied", className: "text-danger" },
};

function ToolCallPartComponent({
  toolCallId,
  title,
  input,
  state,
}: ToolCallPartProps) {
  const [isOpen, setIsOpen] = useState(false);
  const status = statusMeta[state];
  const inputText = useMemo(
    () =>
      input === undefined
        ? "(waiting for input)"
        : JSON.stringify(input, null, 2),
    [input]
  );
  const itemValue = `tool-call-${toolCallId}`;

  return (
    <View className="mt-2 mb-2 rounded bg-surface p-2">
      <Accordion
        isDividerVisible={false}
        selectionMode="single"
        value={isOpen ? itemValue : undefined}
        onValueChange={(nextValue: AccordionValue) => {
          const open = Array.isArray(nextValue)
            ? nextValue.includes(itemValue)
            : nextValue === itemValue;
          setIsOpen(open);
        }}
        variant="surface"
      >
        <Accordion.Item value={itemValue}>
          <Accordion.Trigger className="min-h-8 py-1">
            <View className="flex-row items-center justify-between">
              <Text className="font-bold text-warning text-xs">TOOL: {title}</Text>
              <Text className={`text-[10px] ${status.className}`}>
                {status.label}
              </Text>
            </View>
            <Accordion.Indicator />
          </Accordion.Trigger>
          {isOpen ? (
            <Accordion.Content className="pt-1">
              <Text className="mb-1 font-mono text-muted text-xs">
                {inputText}
              </Text>
            </Accordion.Content>
          ) : null}
        </Accordion.Item>
      </Accordion>
    </View>
  );
}

export const ToolCallPart = memo(ToolCallPartComponent);
