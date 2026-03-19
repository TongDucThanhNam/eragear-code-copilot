import type { ToolUIPart } from "@repo/shared";
import { Accordion } from "heroui-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { ToolResultDisplay } from "./tool-result-display";

type AccordionValue = string | string[] | undefined;

interface ToolResultPartProps {
  toolCallId: string;
  output?: unknown;
  state: ToolUIPart["state"];
  errorText?: string;
}

export function ToolResultPart({
  toolCallId,
  output,
  state,
  errorText,
}: ToolResultPartProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isError = state === "output-error" || state === "output-denied";
  const statusIcon = isError ? "✗" : "✓";
  const statusLabel =
    state === "output-error"
      ? "Error"
      : state === "output-denied"
        ? "Denied"
        : "Completed";
  const itemValue = `tool-result-${toolCallId}`;

  return (
    <View className="mt-2">
      <Accordion
        hideSeparator
        onValueChange={(nextValue: AccordionValue) => {
          const open = Array.isArray(nextValue)
            ? nextValue.includes(itemValue)
            : nextValue === itemValue;
          setIsOpen(open);
        }}
        selectionMode="single"
        value={isOpen ? itemValue : undefined}
        variant="surface"
      >
        <Accordion.Item value={itemValue}>
          <Accordion.Trigger className="min-h-8 py-2">
            <View className="flex-row items-center gap-2">
              <Text
                className={`font-bold text-xs ${isError ? "text-danger" : "text-success"}`}
              >
                {statusIcon}
              </Text>
              <Text
                className={`font-mono text-xs ${isError ? "text-danger" : "text-success"}`}
              >
                {toolCallId} · {statusLabel}
              </Text>
            </View>
            <Accordion.Indicator />
          </Accordion.Trigger>
          {isOpen ? (
            <Accordion.Content className="px-2 pt-0 pb-2">
              <ToolResultDisplay
                errorText={errorText}
                output={output}
                state={state}
              />
            </Accordion.Content>
          ) : null}
        </Accordion.Item>
      </Accordion>
    </View>
  );
}
