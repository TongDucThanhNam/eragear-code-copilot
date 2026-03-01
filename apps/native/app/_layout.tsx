import "@/global.css";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorToastHandler } from "@/components/error-toast-handler";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { TRPCProvider } from "@/contexts/trpc-provider";
import { useAuthConfigured } from "@/hooks/use-auth-config";

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

const STACK_SCREEN_OPTIONS = {};
const HEROUI_CONFIG = {
  devInfo: {
    stylingPrinciples: false,
  },
} as const;

function StackLayout() {
  const isConfigured = useAuthConfigured();

  return (
    <Stack screenOptions={STACK_SCREEN_OPTIONS}>
      <Stack.Protected guard={isConfigured}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="chats/[chatId]" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!isConfigured}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen
        name="modal"
        options={{ title: "Modal", presentation: "modal" }}
      />
    </Stack>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider config={HEROUI_CONFIG}>
              <TRPCProvider>
                <ErrorToastHandler />
                <StackLayout />
              </TRPCProvider>
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
