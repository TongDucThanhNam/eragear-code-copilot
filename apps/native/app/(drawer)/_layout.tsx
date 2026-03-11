import { Ionicons } from "@expo/vector-icons";
import { ImpactFeedbackStyle, impactAsync } from "expo-haptics";
import { useRouter } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { Button, Popover, useThemeColor } from "heroui-native";
import { useCallback, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { ProjectDrawerContent } from "@/components/drawer/project-drawer-content";
import { useAppTheme } from "@/contexts/app-theme-context";
import { useProjectStore } from "@/store/project-store";

function DrawerLayout() {
  const router = useRouter();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const themeColorMuted = useThemeColor("muted");
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const { toggleTheme, isLight } = useAppTheme();
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setIsAgentPickerOpen = useProjectStore((s) => s.setIsAgentPickerOpen);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const renderDrawerContent = useCallback(() => <ProjectDrawerContent />, []);

  const renderHeaderTitle = useCallback((title: string, subtitle?: string) => {
    return (
      <View className="flex-col">
        <Text
          className="text-[10px] text-muted-foreground uppercase"
          style={{ letterSpacing: 2 }}
        >
          Eragear Copilot
        </Text>
        <Text className="font-semibold text-foreground text-lg">{title}</Text>
        {subtitle ? (
          <Text className="text-muted-foreground text-xs">{subtitle}</Text>
        ) : null}
      </View>
    );
  }, []);

  const renderHeaderRight = useCallback(() => {
    return (
      <View className="flex-row items-center gap-2">
        <Popover isOpen={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <Popover.Trigger asChild>
            <Button className="h-9 w-9 rounded-full p-0" size="sm">
              <Ionicons
                color={themeColorAccentForeground}
                name="ellipsis-horizontal"
                size={18}
              />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Overlay />
            <Popover.Content className="w-44 p-1" presentation="popover">
              <View className="py-1">
                <Pressable
                  className="flex-row items-center gap-2 rounded-md px-3 py-2 active:bg-default-100"
                  onPress={() => {
                    setIsMenuOpen(false);
                    setIsAgentPickerOpen(true);
                  }}
                >
                  <Ionicons
                    color={themeColorForeground}
                    name="add-circle-outline"
                    size={18}
                  />
                  <Text className="font-medium text-foreground text-sm">
                    New Chat
                  </Text>
                </Pressable>
                <View className="my-1 h-px bg-muted" />
                <Pressable
                  className="flex-row items-center gap-2 rounded-md px-3 py-2 active:bg-default-100"
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      impactAsync(ImpactFeedbackStyle.Light);
                    }
                    toggleTheme();
                    setIsMenuOpen(false);
                  }}
                >
                  <Ionicons
                    color={themeColorForeground}
                    name={isLight ? "moon-outline" : "sunny-outline"}
                    size={18}
                  />
                  <Text className="font-medium text-foreground text-sm">
                    {isLight ? "Dark Mode" : "Light Mode"}
                  </Text>
                </Pressable>
              </View>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </View>
    );
  }, [
    isLight,
    isMenuOpen,
    router,
    themeColorAccentForeground,
    themeColorForeground,
    toggleTheme,
  ]);

  return (
    <Drawer
      drawerContent={renderDrawerContent}
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: {
          backgroundColor: themeColorBackground,
          borderBottomColor: themeColorMuted,
          borderBottomWidth: 1,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.12,
          shadowRadius: 10,
          elevation: 6,
        },
        headerTitleStyle: {
          fontWeight: "600",
          color: themeColorForeground,
        },
        headerTitleContainerStyle: {
          paddingLeft: 4,
        },
        headerRightContainerStyle: {
          paddingRight: 12,
        },
        headerRight: renderHeaderRight,
        drawerStyle: { backgroundColor: themeColorBackground },
        drawerInactiveTintColor: themeColorMuted,
        drawerType: "front",
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          headerTitle: () =>
            renderHeaderTitle(
              activeProject?.name || "Sessions",
              activeProject?.description || "Session Overview"
            ),
          headerShown: true,
          drawerLabel: ({ focused }) => (
            <Text
              className={focused ? "text-primary" : "text-muted-foreground"}
            >
              Sessions
            </Text>
          ),
          drawerIcon: ({ size, focused }) => (
            <Ionicons
              color={focused ? "hsl(var(--color-primary))" : themeColorMuted}
              name="chatbubbles-outline"
              size={size}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="settings"
        options={{
          headerTitle: () => renderHeaderTitle("Settings", "App Preferences"),
          headerShown: true,
          drawerLabel: ({ focused }) => (
            <Text
              className={focused ? "text-primary" : "text-muted-foreground"}
            >
              Settings
            </Text>
          ),
          drawerIcon: ({ size, focused }) => (
            <Ionicons
              color={focused ? "hsl(var(--color-primary))" : themeColorMuted}
              name="settings-outline"
              size={size}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="(tabs)"
        options={{
          drawerItemStyle: { display: "none" },
        }}
      />
    </Drawer>
  );
}

export default DrawerLayout;
