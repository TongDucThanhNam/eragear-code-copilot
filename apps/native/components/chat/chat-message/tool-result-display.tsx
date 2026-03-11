import { useMemo } from "react";
import {
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";
import type { ToolUIPart } from "@repo/shared";
import { useThemeColor } from "heroui-native";
import { DiffPart } from "./diff-part";
import { TerminalPart } from "./terminal-part";
import { isTerminalOutput } from "./utils";

interface ToolResultDisplayProps {
  output?: unknown;
  state: ToolUIPart["state"];
  errorText?: string;
}

type ToolOutputItem = ToolCallContent | { type: string; [key: string]: unknown };

const isToolOutputItem = (item: unknown): item is ToolOutputItem =>
  typeof item === "object" &&
  item !== null &&
  "type" in item &&
  typeof (item as { type?: unknown }).type === "string";

const isContentBlock = (content: unknown): content is ContentBlock =>
  typeof content === "object" &&
  content !== null &&
  "type" in content &&
  typeof (content as { type?: unknown }).type === "string";

const getResourceLabel = (
  ...candidates: Array<string | null | undefined>
): string => {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return "Resource";
};

export function ToolResultDisplay({
  output,
  state,
  errorText,
}: ToolResultDisplayProps) {
  const foregroundColor = useThemeColor("foreground");
  const dangerColor = useThemeColor("danger");
  const isError = state === "output-error" || state === "output-denied";
  const errorLabel = state === "output-denied" ? "Permission denied." : errorText;
  const textColor = useMemo(() => {
    if (isError) {
      return dangerColor;
    }
    return foregroundColor;
  }, [dangerColor, foregroundColor, isError]);

  const renderTextBlock = (text: string, key: string) => {
    const isBlock = isTerminalOutput(text) || text.includes("\n");

    return (
      <View
        className={isBlock ? "rounded bg-surface-foreground/5 p-2" : undefined}
        key={key}
      >
        <Text
          selectable
          style={{
            color: textColor,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {text}
        </Text>
      </View>
    );
  };

  const renderResourceBadge = (
    label: string,
    url?: string | null,
    key?: string
  ) => (
    <Pressable
      className="rounded border border-divider px-2 py-1"
      disabled={!url}
      key={key}
      onPress={() => (url ? Linking.openURL(url) : undefined)}
    >
      <Text className="text-[11px] text-accent" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  const renderContentBlock = (block: ContentBlock, key: string) => {
    switch (block.type) {
      case "text":
        return renderTextBlock(block.text, key);
      case "resource_link":
        return renderResourceBadge(
          getResourceLabel(block.title, block.name, block.uri),
          block.uri,
          key
        );
      case "resource": {
        const title = getResourceLabel(block.resource.uri);
        if ("text" in block.resource && block.resource.text) {
          return renderTextBlock(block.resource.text, key);
        }
        return renderResourceBadge(title, block.resource.uri, key);
      }
      case "image":
        return renderResourceBadge(
          getResourceLabel(block.uri, block.mimeType, block.type),
          block.uri,
          key
        );
      case "audio":
        return renderResourceBadge(
          getResourceLabel(block.mimeType, block.type),
          undefined,
          key
        );
      default:
        return renderTextBlock(JSON.stringify(block, null, 2), key);
    }
  };

  const renderOutputItem = (item: ToolOutputItem, index: number) => {
    if (item.type === "content" && "content" in item && isContentBlock(item.content)) {
      return renderContentBlock(item.content, `content-${index}`);
    }
    if (
      item.type === "diff" &&
      typeof item.path === "string" &&
      typeof item.newText === "string"
    ) {
      return (
        <DiffPart
          key={`diff-${index}`}
          newText={item.newText}
          oldText={typeof item.oldText === "string" ? item.oldText : undefined}
          path={item.path}
        />
      );
    }
    if (item.type === "terminal" && typeof item.terminalId === "string") {
      return (
        <TerminalPart
          key={`terminal-${index}`}
          terminalId={item.terminalId}
        />
      );
    }
    if ("text" in item && typeof item.text === "string") {
      return renderTextBlock(item.text, `text-${index}`);
    }
    return renderTextBlock(JSON.stringify(item, null, 2), `raw-${index}`);
  };

  if (!output) {
    return (
      <View className="p-2">
        {errorLabel ? (
          <Text className="font-mono text-danger text-xs">{errorLabel}</Text>
        ) : (
          <Text className="font-mono text-muted text-xs italic">
            (no output)
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="gap-2">
      {errorLabel && (
        <Text className="font-mono text-danger text-xs">{errorLabel}</Text>
      )}
      {Array.isArray(output)
        ? output.map((item, index) => (
            <View key={index}>
              {isToolOutputItem(item)
                ? renderOutputItem(item, index)
                : renderTextBlock(
                    typeof item === "string"
                      ? item
                      : JSON.stringify(item, null, 2),
                    `raw-${index}`
                  )}
            </View>
          ))
        : renderTextBlock(
            typeof output === "string" ? output : JSON.stringify(output, null, 2),
            "output"
          )}
    </View>
  );
}
