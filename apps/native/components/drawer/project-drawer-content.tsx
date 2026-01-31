import { Ionicons } from "@expo/vector-icons";
import { Surface } from "heroui-native";
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
        <Pressable onPress={() => handleSelectProject(item.id)}>
          <Surface
            className={`mx-3 mb-2 flex-row items-center gap-3 rounded-xl border p-3 ${
              isActive ? "border-primary" : ""
            }`}
          >
            <View
              className={`h-10 w-10 items-center justify-center rounded-lg ${
                isActive ? "bg-primary/20" : "bg-muted/20"
              }`}
            >
              <Ionicons
                color={isActive ? "#3b82f6" : "#6b7280"}
                name="folder"
                size={20}
              />
            </View>
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
                    <View
                      className="rounded bg-primary/10 px-1.5 py-0.5"
                      key={tag}
                    >
                      <Text className="text-[10px] text-primary">{tag}</Text>
                    </View>
                  ))}
                  {item.tags.length > 2 && (
                    <Text className="self-center text-[10px] text-muted-foreground">
                      +{item.tags.length - 2}
                    </Text>
                  )}
                </View>
              )}
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                  setEditingProject(item);
                }}
              >
                <Ionicons color="#94a3b8" name="create-outline" size={18} />
              </Pressable>
              <Pressable
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
                <Ionicons color="#ef4444" name="trash-outline" size={18} />
              </Pressable>
              {isActive && (
                <Ionicons color="#3b82f6" name="checkmark-circle" size={20} />
              )}
            </View>
          </Surface>
        </Pressable>
      );
    },
    [activeProjectId, handleSelectProject, removeProject, setEditingProject]
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
          <Ionicons color="#6b7280" name="folder-open-outline" size={40} />
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
        <Pressable onPress={() => setIsProjectCreateOpen(true)}>
          <View className="flex-row items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5">
            <Ionicons color="white" name="add" size={18} />
            <Text className="font-semibold text-white">New Project</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
