import { Ionicons } from "@expo/vector-icons";
import { Drawer } from "expo-router/drawer";
import { useThemeColor } from "heroui-native";
import { useCallback } from "react";
import { Text } from "react-native";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { ProjectDrawerContent } from "@/components/drawer/project-drawer-content";

function DrawerLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const themeColorMuted = useThemeColor("muted");

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  const renderDrawerContent = useCallback(() => <ProjectDrawerContent />, []);

  return (
    <Drawer
      drawerContent={renderDrawerContent}
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: {
          fontWeight: "600",
          color: themeColorForeground,
        },
        headerRight: renderThemeToggle,
        drawerStyle: { backgroundColor: themeColorBackground },
        drawerInactiveTintColor: themeColorMuted,
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          headerTitle: "Sessions",
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
          headerTitle: "Settings",
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
