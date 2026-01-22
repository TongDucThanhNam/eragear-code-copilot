import { Ionicons } from "@expo/vector-icons";
import { Surface, useThemeColor } from "heroui-native";
import { useCallback } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/store/project-store";

interface ProjectDrawerContentProps {
  onProjectSelect?: () => void;
}

export function ProjectDrawerContent({
  onProjectSelect,
}: ProjectDrawerContentProps) {
  const muted = useThemeColor("muted-foreground");
  const accentColor = useThemeColor("primary");

  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProjectId = useProjectStore((s) => s.setActiveProjectId);

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
    ({ item }) => {
      const isActive = item.id === activeProjectId;

      return (
        <Pressable
          onPress={() => handleSelectProject(item.id)}
        >
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
                color={isActive ? accentColor : muted}
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
                  {item.tags.slice(0, 2).map((tag) => (
                    <View key={tag} className="rounded bg-primary/10 px-1.5 py-0.5">
                      <Text className="text-[10px] text-primary">
                        {tag}
                      </Text>
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
            {isActive && (
              <Ionicons
                color={accentColor}
                name="checkmark-circle"
                size={20}
              />
            )}
          </Surface>
        </Pressable>
      );
    },
    [activeProjectId, accentColor, muted, handleSelectProject]
  );

  return (
    <View className="flex-1">
      <View className="px-4 py-3">
        <Text className="font-semibold text-[11px] text-muted-foreground uppercase">
          Projects
        </Text>
      </View>

      {projects.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4 py-8">
          <Ionicons color={muted} name="folder-open-outline" size={40} />
          <Text className="mt-3 text-center text-muted-foreground text-sm">
            No projects yet.{"\n"}Create one in the home screen.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={renderProjectItem}
          scrollEnabled={true}
          nestedScrollEnabled={true}
        />
      )}
    </View>
  );
}
