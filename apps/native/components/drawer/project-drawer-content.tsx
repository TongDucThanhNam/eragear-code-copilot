import { Ionicons } from "@expo/vector-icons";
import { Avatar, Button, Chip, Surface, useThemeColor } from "heroui-native";
import { useCallback } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";

interface ProjectDrawerContentProps {
  onProjectSelect?: () => void;
}

export function ProjectDrawerContent({
  onProjectSelect,
}: ProjectDrawerContentProps) {
  const insets = useSafeAreaInsets();
  const themeColorMuted = useThemeColor("muted");
  const themeColorDanger = useThemeColor("danger");
  const themeColorSuccess = useThemeColor("success");

  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProjectId = useProjectStore((s) => s.setActiveProjectId);
  const setEditingProject = useProjectStore((s) => s.setEditingProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const setIsProjectCreateOpen = useProjectStore(
    (s) => s.setIsProjectCreateOpen
  );

  const setActiveProjectMutation = trpc.setActiveProject.useMutation();

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setActiveProjectId(projectId);
      setActiveProjectMutation.mutate({ id: projectId });
      onProjectSelect?.();
    },
    [setActiveProjectId, setActiveProjectMutation, onProjectSelect]
  );

  const renderProjectItem = useCallback(
    ({ item }: { item: (typeof projects)[0] }) => {
      const isActive = item.id === activeProjectId;

      return (
        <Pressable
          accessibilityLabel={`Project ${item.name}, path ${item.path}`}
          accessibilityRole="button"
          onPress={() => handleSelectProject(item.id)}
        >
          <Surface
            className={`mx-3 mb-2 flex-row items-center gap-3 rounded-xl border p-3 ${
              isActive ? "border-primary" : ""
            }`}
          >
            <Avatar
              size="md"
              color={isActive ? "accent" : "default"}
              alt={item.name}
            >
              <Avatar.Fallback>
                <Ionicons name="folder" size={20} />
              </Avatar.Fallback>
            </Avatar>
            <View className="flex-1">
              <Text
                className={`font-medium ${
                  isActive ? "text-primary" : "text-foreground"
                }`}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                {item.path}
              </Text>
              {item.tags && item.tags.length > 0 && (
                <View className="mt-1 flex-row flex-wrap gap-1">
                  {item.tags.slice(0, 2).map((tag: string) => (
                    <Chip key={tag} size="sm" variant="soft" color="accent">
                      <Chip.Label>{tag}</Chip.Label>
                    </Chip>
                  ))}
                  {item.tags.length > 2 && (
                    <Chip size="sm" variant="soft" color="default">
                      <Chip.Label>+{item.tags.length - 2}</Chip.Label>
                    </Chip>
                  )}
                </View>
              )}
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityLabel={`Edit project ${item.name}`}
                accessibilityRole="button"
                onPress={(event) => {
                  event.stopPropagation();
                  setEditingProject(item);
                }}
              >
                <Ionicons color={themeColorMuted} name="create-outline" size={18} />
              </Pressable>
              <Pressable
                accessibilityLabel={`Delete project ${item.name}`}
                accessibilityRole="button"
                onPress={(event) => {
                  event.stopPropagation();
                  Alert.alert(
                    "Delete Project",
                    `Delete project "${item.name}"?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => removeProject(item.id),
                      },
                    ]
                  );
                }}
              >
                <Ionicons color={themeColorDanger} name="trash-outline" size={18} />
              </Pressable>
              {isActive && (
                <Ionicons color={themeColorSuccess} name="checkmark-circle" size={20} />
              )}
            </View>
          </Surface>
        </Pressable>
      );
    },
    [
      activeProjectId,
      handleSelectProject,
      removeProject,
      setEditingProject,
      themeColorMuted,
      themeColorDanger,
      themeColorSuccess,
    ]
  );

  return (
    <View
      className="flex-1"
      style={{
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
      }}
    >
      <View className="px-4 py-3">
        <Text className="font-semibold text-[11px] text-muted-foreground uppercase">
          Projects
        </Text>
      </View>

      {projects.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4 py-8">
          <Ionicons color={themeColorMuted} name="folder-open-outline" size={40} />
          <Text className="mt-3 text-center text-muted-foreground text-sm">
            No projects yet.{"\n"}Create one using the button below.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          nestedScrollEnabled={true}
          renderItem={renderProjectItem}
          scrollEnabled={true}
        />
      )}

      <View className="border-border/30 border-t p-3">
        <Button
          accessibilityLabel="Create new project"
          onPress={() => setIsProjectCreateOpen(true)}
        >
          <Button.Label>New Project</Button.Label>
        </Button>
      </View>
    </View>
  );
}
