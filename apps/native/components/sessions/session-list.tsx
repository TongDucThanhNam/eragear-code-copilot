import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Chip,
  PressableFeedback,
  Spinner,
  Text,
  useThemeColor,
} from "heroui-native";
import { FlatList, RefreshControl, View } from "react-native";
import { AgentIcon } from "@/components/agents/agent-icons";
import {
  formatTaskTimestamp,
  getSessionAgentType,
  getSessionTitle,
} from "./session-utils";
import type { ListedSession } from "./types";

interface SessionListProps {
  activeProjectName?: string | null;
  emptyStateMessage: string;
  projectNamesById?: Record<string, string>;
  isFetching: boolean;
  isLoading: boolean;
  sessions: ListedSession[];
  onOpenSession: (chatId: string, isActive?: boolean) => void;
  onOpenSessionActions: (session: ListedSession) => void;
  onRefresh: () => void;
}

export function SessionList({
  activeProjectName,
  emptyStateMessage,
  projectNamesById = {},
  isFetching,
  isLoading,
  sessions,
  onOpenSession,
  onOpenSessionActions,
  onRefresh,
}: SessionListProps) {
  const themeColorMuted = useThemeColor("muted");

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner size="lg" />
        <Text className="mt-2 text-muted-foreground">Loading sessions...</Text>
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-default">
          <Ionicons color={themeColorMuted} name="albums-outline" size={28} />
        </View>
        <Text className="mt-4 text-center" type="body" weight="medium">
          Nothing here yet
        </Text>
        <Text className="mt-1 text-center" color="muted">
          {emptyStateMessage}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={{ paddingBottom: 132 }}
      data={sessions}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl onRefresh={onRefresh} refreshing={isFetching} />
      }
      renderItem={({ item }) => (
        <SessionListItem
          activeProjectName={activeProjectName}
          projectNamesById={projectNamesById}
          session={item}
          onOpenSession={onOpenSession}
          onOpenSessionActions={onOpenSessionActions}
        />
      )}
    />
  );
}

interface SessionListItemProps {
  activeProjectName?: string | null;
  projectNamesById: Record<string, string>;
  session: ListedSession;
  onOpenSession: (chatId: string, isActive?: boolean) => void;
  onOpenSessionActions: (session: ListedSession) => void;
}

function SessionListItem({
  activeProjectName,
  projectNamesById,
  session,
  onOpenSession,
  onOpenSessionActions,
}: SessionListItemProps) {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorMuted = useThemeColor("muted");
  const themeColorWarning = useThemeColor("warning");
  const sessionTitle = getSessionTitle(session.name, session.sessionId);
  const sessionAgentType = getSessionAgentType(session);
  const projectName =
    activeProjectName ??
    (session.projectId ? projectNamesById[session.projectId] : null) ??
    "Project";

  return (
    <PressableFeedback
      accessibilityLabel={`Open session ${sessionTitle}, ${
        session.isActive ? "active" : "inactive"
      }`}
      accessibilityRole="button"
      onPress={() => onOpenSession(session.id, session.isActive)}
    >
      <View className="flex-row items-center border-default/10 border-b px-6 py-4">
        <View className="mr-4 h-16 w-16 items-center justify-center rounded-full bg-default">
          <AgentIcon
            color={themeColorForeground}
            secondaryColor={themeColorMuted}
            size={24}
            type={sessionAgentType}
          />
        </View>

        <View className="min-w-0 flex-1 pr-3">
          <View className="flex-row items-center">
            <Text
              className="min-w-0 flex-1 text-[17px]"
              numberOfLines={1}
              weight="semibold"
            >
              {sessionTitle}
            </Text>
            {session.pinned ? (
              <Ionicons
                color={themeColorWarning}
                name="pin"
                size={14}
                style={{ marginLeft: 6 }}
              />
            ) : null}
          </View>

          <View className="mt-2 flex-row items-center gap-2">
            <View
              className={`h-2 w-2 rounded-full ${
                session.isActive ? "bg-success" : "bg-muted"
              }`}
            />
            <Chip
              color={session.isActive ? "success" : "default"}
              size="sm"
              variant="soft"
            >
              <Chip.Label>
                {session.isActive
                  ? "Active"
                  : session.loadSessionSupported
                    ? "Resume available"
                    : "History only"}
              </Chip.Label>
            </Chip>
          </View>
        </View>

        <View className="items-end gap-4">
          <Text color="muted" type="body-sm">
            {formatTaskTimestamp(session.lastActiveAt)}
          </Text>
          <Button
            accessibilityLabel={`Session options for ${sessionTitle}`}
            className="h-8 w-8 rounded-full"
            isIconOnly
            onPress={(event) => {
              event.stopPropagation();
              onOpenSessionActions(session);
            }}
            size="sm"
            variant="ghost"
          >
            <Ionicons
              color={themeColorMuted}
              name="ellipsis-horizontal"
              size={20}
            />
          </Button>
        </View>
      </View>
    </PressableFeedback>
  );
}
