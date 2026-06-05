import { Alert, Button, Dialog, Spinner, Surface, Text } from "heroui-native";
import { ScrollView, View } from "react-native";
import { AgentPicker } from "@/components/agents/agent-picker";
import type { Agent } from "@/store/settings-store";
import { formatTimestamp } from "./session-utils";
import type { DiscoveredSessionItem } from "./types";

interface DiscoverSessionsDialogProps {
  activeAgentId: string | null;
  activeProjectName?: string | null;
  agents: Agent[];
  error: string | null;
  isCreating: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isOpen: boolean;
  loadSessionSupported: boolean;
  nextCursor: string | null;
  pendingLoadSessionId: string | null;
  requiresAuth: boolean;
  sessions: DiscoveredSessionItem[];
  supported: boolean;
  onLoadMore: () => void;
  onLoadSession: (sessionId: string) => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
}

export function DiscoverSessionsDialog({
  activeAgentId,
  activeProjectName,
  agents,
  error,
  isCreating,
  isLoading,
  isLoadingMore,
  isOpen,
  loadSessionSupported,
  nextCursor,
  pendingLoadSessionId,
  requiresAuth,
  sessions,
  supported,
  onLoadMore,
  onLoadSession,
  onOpenChange,
  onRefresh,
  onSelectAgent,
}: DiscoverSessionsDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="max-h-[85%]">
          <Dialog.Close variant="ghost" />
          <Dialog.Title>Load Existing Session</Dialog.Title>
          <Dialog.Description>
            {activeProjectName
              ? `Project: ${activeProjectName}`
              : "Select a project to continue"}
          </Dialog.Description>

          <View className="mb-4 mt-4">
            <Text className="mb-2" type="body-sm" weight="semibold">
              Agent
            </Text>
            <AgentPicker
              activeAgentId={activeAgentId}
              agents={agents}
              emptyLabel="No agents configured."
              isLoading={isLoading || isCreating}
              onSelect={onSelectAgent}
            />
          </View>

          {isLoading ? (
            <View className="mb-3 flex-row items-center">
              <Spinner size="sm" />
              <Text className="ml-2" color="muted" type="body-xs">
                Discovering sessions...
              </Text>
            </View>
          ) : null}

          {error ? (
            <Alert className="mb-3" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Discovery failed</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {!(isLoading || error) && requiresAuth ? (
            <Alert className="mb-3" status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Authentication required</Alert.Title>
                <Alert.Description>
                  Agent requires authentication before session discovery.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {isLoading || error || requiresAuth || supported ? null : (
            <Alert className="mb-3" status="default">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Discovery unavailable</Alert.Title>
                <Alert.Description>
                  This agent does not advertise `session/list`.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}

          {!(isLoading || error) &&
          supported &&
          !requiresAuth &&
          sessions.length === 0 ? (
            <Alert className="mb-3" status="default">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>No sessions found</Alert.Title>
                <Alert.Description>
                  No sessions found for this project root.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {!(isLoading || error) &&
          supported &&
          !requiresAuth &&
          sessions.length > 0 ? (
            <ScrollView className="max-h-60">
              {sessions.map((session) => {
                const isLoadingTarget =
                  pendingLoadSessionId === session.sessionId;
                return (
                  <Surface
                    className="mb-2 overflow-hidden border border-muted/20 p-3"
                    key={session.sessionId}
                  >
                    <Text
                      numberOfLines={1}
                      type="body-sm"
                      weight="semibold"
                    >
                      {session.title?.trim() || session.sessionId}
                    </Text>
                    <Text
                      className="mt-1 font-mono text-[11px]"
                      color="muted"
                      numberOfLines={1}
                    >
                      {session.sessionId}
                    </Text>
                    <Text
                      className="mt-1 text-[11px]"
                      color="muted"
                      numberOfLines={1}
                    >
                      cwd: {session.cwd}
                    </Text>
                    {session.updatedAt ? (
                      <Text className="mt-1 text-[11px]" color="muted">
                        updated: {formatTimestamp(session.updatedAt)}
                      </Text>
                    ) : null}
                    <View className="mt-3">
                      <Button
                        isDisabled={isCreating || !loadSessionSupported}
                        onPress={() => onLoadSession(session.sessionId)}
                        size="sm"
                      >
                        <Button.Label>
                          {isLoadingTarget ? "Loading..." : "Load Session"}
                        </Button.Label>
                      </Button>
                    </View>
                  </Surface>
                );
              })}
            </ScrollView>
          ) : null}

          {!loadSessionSupported && supported && !requiresAuth ? (
            <Alert className="mt-2" status="default">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Read-only discovery</Alert.Title>
                <Alert.Description>
                  Agent lists sessions but does not support `session/load`.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          <View className="mt-4 flex-row justify-end gap-3">
            <Button
              isDisabled={!activeAgentId || isLoading}
              onPress={onRefresh}
              variant="ghost"
            >
              <Button.Label>
                {isLoading ? "Refreshing..." : "Refresh"}
              </Button.Label>
            </Button>
            {nextCursor ? (
              <Button
                isDisabled={isLoadingMore}
                onPress={onLoadMore}
                variant="ghost"
              >
                <Button.Label>
                  {isLoadingMore ? "Loading..." : "Load More"}
                </Button.Label>
              </Button>
            ) : null}
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
