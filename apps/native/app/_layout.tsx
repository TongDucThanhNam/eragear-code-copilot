import "@/global.css";
import { Stack } from "expo-router";
import { HeroUINativeProvider, Spinner, useThemeColor } from "heroui-native";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorToastHandler } from "@/components/error-toast-handler";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { TRPCProvider } from "@/contexts/trpc-provider";
import { useBetterAuthClient } from "@/lib/auth-client";
import { useAuthStore } from "@/store/auth-store";

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
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const authVersion = useAuthStore((state) => state.authVersion);
  const hasServerUrl = serverUrl.trim().length > 0;

  if (!hasServerUrl) {
    return <ProtectedStack isAuthenticated={false} />;
  }

  return (
    <ConfiguredApp key={`${serverUrl}:${authVersion}`} serverUrl={serverUrl} />
  );
}

function ProtectedStack({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <Stack screenOptions={STACK_SCREEN_OPTIONS}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="chats/[chatId]" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen
        name="modal"
        options={{ title: "Modal", presentation: "modal" }}
      />
    </Stack>
  );
}

function ConfiguredApp({ serverUrl }: { serverUrl: string }) {
  const authClient = useBetterAuthClient(serverUrl);
  const session = authClient.useSession();
  const spinnerColor = useThemeColor("accent-foreground");

  if (session.isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner color={spinnerColor} isLoading={true} size="lg" />
      </View>
    );
  }

  const isAuthenticated = Boolean(session.data?.user);

  if (!isAuthenticated) {
    return <ProtectedStack isAuthenticated={false} />;
  }

  return (
    <TRPCProvider authClient={authClient}>
      <ProtectedStack isAuthenticated={true} />
    </TRPCProvider>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider config={HEROUI_CONFIG}>
              <ErrorToastHandler />
              <StackLayout />
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
