import Ionicons from "@expo/vector-icons/Ionicons";
import type { ToolUIPart, UIMessagePart } from "@repo/shared";
import { Spinner } from "heroui-native";
import type { ChainSummary } from "./agentic-chain.types";
import { getActiveIndex, toToolViewState } from "./agentic-message-utils";

export const summarizeChainItems = (items: UIMessagePart[]): ChainSummary => {
  let toolCount = 0;
  let reasoningCount = 0;
  let textCount = 0;

  for (const item of items) {
    if (item.type.startsWith("tool-")) {
      toolCount += 1;
      continue;
    }
    if (item.type === "reasoning") {
      reasoningCount += 1;
      continue;
    }
    if (item.type === "text") {
      textCount += 1;
    }
  }

  const summaryParts = [
    toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
    reasoningCount
      ? `${reasoningCount} thought${reasoningCount === 1 ? "" : "s"}`
      : null,
    textCount ? `${textCount} note${textCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return {
    activeIndex: getActiveIndex(items),
    reasoningCount,
    summary:
      summaryParts.length > 0
        ? summaryParts.join(" | ")
        : `${items.length} step${items.length === 1 ? "" : "s"}`,
    textCount,
    toolCount,
  };
};

export const getToolTone = (viewState: ReturnType<typeof toToolViewState>) => {
  switch (viewState) {
    case "error":
      return "text-danger";
    case "completed":
      return "text-success";
    case "approval-requested":
      return "text-warning";
    case "running":
      return "text-accent";
    default:
      return "text-muted-foreground";
  }
};

export const getChainIcon = (part: UIMessagePart, isActive: boolean) => {
  if (part.type.startsWith("tool-")) {
    const viewState = toToolViewState(part as ToolUIPart);
    if (viewState === "running" && isActive) {
      return <Spinner color="accent" size="sm" />;
    }
    return (
      <Ionicons
        className={getToolTone(viewState)}
        name="construct-outline"
        size={14}
      />
    );
  }

  if (part.type === "reasoning") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="bulb-outline"
        size={14}
      />
    );
  }

  if (part.type === "text") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="chatbubble-ellipses-outline"
        size={14}
      />
    );
  }

  if (part.type === "source-url") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="link-outline"
        size={14}
      />
    );
  }

  if (part.type === "source-document") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="document-text-outline"
        size={14}
      />
    );
  }

  if (part.type === "file") {
    return (
      <Ionicons
        className="text-muted-foreground"
        name="document-outline"
        size={14}
      />
    );
  }

  if (part.type === "step-start") {
    return (
      <Ionicons className="text-muted-foreground" name="ellipse" size={10} />
    );
  }

  return (
    <Ionicons
      className="text-muted-foreground"
      name="sparkles-outline"
      size={14}
    />
  );
};
