import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import type { ToolUIPart } from "@repo/shared";
import {
  BottomSheet,
  PressableFeedback,
  Separator,
  Text,
} from "heroui-native";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { View } from "react-native";
import {
  getToolChangedFilePaths,
  isFileEditTool,
  stripDiffOutputItems,
} from "./tool-file-paths";
import { ToolResultDisplay } from "./tool-result-display";

interface ToolCallPartProps {
  details?: ReactNode;
  errorText?: string;
  isExpanded: boolean;
  onToggle: () => void;
  output?: unknown;
  toolCallId: string;
  title: string;
  type: ToolUIPart["type"];
  input: ToolUIPart["input"];
  state: ToolUIPart["state"];
}

const statusMeta: Record<
  ToolUIPart["state"],
  { label: string; className: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  "input-streaming": {
    label: "Preparing",
    className: "text-muted-foreground",
    icon: "time-outline",
  },
  "input-available": {
    label: "Running",
    className: "text-warning",
    icon: "play-circle-outline",
  },
  "approval-requested": {
    label: "Awaiting approval",
    className: "text-warning",
    icon: "shield-outline",
  },
  "approval-responded": {
    label: "Approved",
    className: "text-success",
    icon: "checkmark-circle-outline",
  },
  "output-available": {
    label: "Completed",
    className: "text-success",
    icon: "checkmark-circle-outline",
  },
  "output-error": {
    label: "Failed",
    className: "text-danger",
    icon: "alert-circle-outline",
  },
  "output-denied": {
    label: "Denied",
    className: "text-danger",
    icon: "close-circle-outline",
  },
  "output-cancelled": {
    label: "Cancelled",
    className: "text-muted-foreground",
    icon: "remove-circle-outline",
  },
};

const FIELD_PREVIEW_KEYS = [
  "query",
  "url",
  "uri",
  "path",
  "file",
  "command",
  "cmd",
  "pattern",
  "repo",
  "repository",
  "message",
  "prompt",
];

const truncateLabel = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

function normalizeToolTitle(value: string): string {
  const normalized = value
    .replace(/^tool[-_\s]*/i, "")
    .replace(/^mcp__[^_\s]+__/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "Tool call";
  }

  const lower = normalized.toLowerCase();
  if (lower === "web search" || lower.startsWith("web search ")) {
    return "Search web";
  }
  if (lower === "search web" || lower.startsWith("search web ")) {
    return "Search web";
  }

  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function toPastActionLabel(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("search")) {
    return lower.includes("web") ? "Searched web" : "Searched";
  }
  if (lower.includes("read")) {
    return "Read";
  }
  if (
    lower.includes("edit") ||
    lower.includes("write") ||
    lower.includes("patch")
  ) {
    return "Changed files";
  }
  if (
    lower.includes("bash") ||
    lower.includes("shell") ||
    lower.includes("command")
  ) {
    return "Ran command";
  }
  return title;
}

function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "(waiting for input)";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readNamedField(input: ToolUIPart["input"]): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  for (const key of FIELD_PREVIEW_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

const getInputPreview = (input: ToolUIPart["input"]) => {
  if (input === undefined) {
    return null;
  }
  if (input === null) {
    return "null";
  }
  if (typeof input === "string") {
    return truncateLabel(input.replace(/\s+/g, " ").trim(), 88);
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }
  if (Array.isArray(input)) {
    return input.length === 0 ? "[]" : `${input.length} items`;
  }

  const namedValue = readNamedField(input);
  if (namedValue) {
    return truncateLabel(namedValue.replace(/\s+/g, " "), 88);
  }

  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.length === 0) {
    return "{}";
  }
  const preview = keys.slice(0, 3).join(", ");
  return `{ ${preview}${keys.length > 3 ? ", ..." : ""} }`;
};

const getChangedFilesPreview = (paths: string[]) => {
  if (paths.length === 0) {
    return "File change";
  }
  return truncateLabel(paths.join(", "), 88);
};

const ChangedFilesSummary = ({ paths }: { paths: string[] }) => (
  <View className="gap-1.5">
    <Text className="text-muted-foreground uppercase" type="body-xs">
      Changed Files
    </Text>
    {paths.length > 0 ? (
      <View className="gap-1">
        {paths.map((path) => (
          <View className="rounded-md bg-default px-2.5 py-1.5" key={path}>
            <Text className="font-mono" numberOfLines={1} type="body-xs">
              {path}
            </Text>
          </View>
        ))}
      </View>
    ) : (
      <Text className="font-mono" color="muted" type="body-xs">
        File path unavailable.
      </Text>
    )}
  </View>
);

const DetailSection = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <View className="gap-1.5">
    <Text className="text-muted-foreground uppercase" type="body-xs">
      {title}
    </Text>
    {children}
  </View>
);

function ToolCallPartComponent({
  details,
  errorText,
  toolCallId,
  title,
  type,
  input,
  output,
  state,
}: ToolCallPartProps) {
  const [isOpen, setIsOpen] = useState(false);
  const status = statusMeta[state];
  const displayTitle = useMemo(() => normalizeToolTitle(title), [title]);
  const changedFilePaths = useMemo(
    () => getToolChangedFilePaths({ input, output, title, type }),
    [input, output, title, type]
  );
  const shouldShowChangedFiles =
    changedFilePaths.length > 0 || isFileEditTool({ title, type });
  const visibleOutput = useMemo(
    () => (shouldShowChangedFiles ? stripDiffOutputItems(output) : output),
    [output, shouldShowChangedFiles]
  );
  const snapPoints = useMemo(() => ["72%"], []);
  const previewText = useMemo(() => {
    if (shouldShowChangedFiles) {
      return getChangedFilesPreview(changedFilePaths);
    }
    if (state === "output-error") {
      return truncateLabel(errorText ?? "Execution failed.", 88);
    }
    if (state === "output-denied") {
      return "Permission denied";
    }
    if (state === "output-cancelled") {
      return "Execution cancelled";
    }
    if (state === "output-available") {
      return getInputPreview(input) ?? getInputPreview(visibleOutput);
    }
    return getInputPreview(input);
  }, [
    changedFilePaths,
    errorText,
    input,
    shouldShowChangedFiles,
    state,
    visibleOutput,
  ]);
  const inputText = useMemo(() => stringifyValue(input), [input]);
  const hasResult =
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    state === "output-cancelled";
  const processLabel =
    state === "output-available"
      ? toPastActionLabel(displayTitle)
      : displayTitle;
  const summaryLabel = `${displayTitle} 1 time`;

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={setIsOpen}>
      <PressableFeedback
        animation={{ scale: { value: 0.98 } }}
        className="my-0.5 rounded-lg px-1 py-1"
        onPress={() => setIsOpen(true)}
      >
        <View className="min-h-8 flex-row items-center justify-between gap-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Text className="shrink" numberOfLines={1} type="body-sm">
              {summaryLabel}
            </Text>
            {previewText ? (
              <Text
                className="min-w-0 flex-1"
                color="muted"
                numberOfLines={1}
                type="body-sm"
              >
                {previewText}
              </Text>
            ) : null}
          </View>
          <Ionicons
            className="text-muted-foreground"
            name="chevron-forward-outline"
            size={15}
          />
        </View>
      </PressableFeedback>

      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          backgroundClassName="rounded-t-[28px]"
          contentContainerClassName="h-full px-5 pt-4 pb-5"
          enableDynamicSizing={false}
          enableOverDrag={false}
          snapPoints={snapPoints}
        >
          <View className="mb-4 flex-row items-center justify-center">
            <BottomSheet.Title className="text-center">
              Process
            </BottomSheet.Title>
            <BottomSheet.Close className="absolute right-0 top-0" />
          </View>

          <BottomSheetScrollView
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="gap-4">
              <View className="flex-row gap-3">
                <View className="items-center">
                  <Ionicons
                    className={status.className}
                    name={status.icon}
                    size={18}
                  />
                  <View
                    className="mt-2 w-px flex-1 bg-divider"
                    style={{ minHeight: 18 }}
                  />
                </View>
                <View className="min-w-0 flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text numberOfLines={1} type="body-sm" weight="medium">
                      {processLabel}
                    </Text>
                    <Text
                      className={status.className}
                      numberOfLines={1}
                      type="body-xs"
                    >
                      {status.label}
                    </Text>
                  </View>
                  {previewText ? (
                    <Text color="muted" numberOfLines={2} type="body-sm">
                      {previewText}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Separator />

              {shouldShowChangedFiles ? (
                <ChangedFilesSummary paths={changedFilePaths} />
              ) : null}

              {input !== undefined ? (
                <DetailSection title="Input">
                  <View className="rounded-lg bg-default px-3 py-2">
                    <Text className="font-mono" selectable type="body-xs">
                      {inputText}
                    </Text>
                  </View>
                </DetailSection>
              ) : null}

              {hasResult || details !== undefined ? (
                <DetailSection title="Result">
                  {details ?? (
                    <ToolResultDisplay
                      errorText={errorText}
                      output={visibleOutput}
                      state={state}
                    />
                  )}
                </DetailSection>
              ) : null}

              <DetailSection title="Tool Call ID">
                <Text
                  className="font-mono"
                  color="muted"
                  selectable
                  type="body-xs"
                >
                  {toolCallId}
                </Text>
              </DetailSection>
            </View>
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

export const ToolCallPart = memo(ToolCallPartComponent);
