import "@/global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect, useState } from "react";
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

function StackLayout() {
  return (
    <Stack screenOptions={{}}>
      <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      <Stack.Screen name="chats/[chatId]" options={{ headerShown: false }} />
      <Stack.Screen name="chats/new" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{ title: "Modal", presentation: "modal" }}
      />
    </Stack>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const isConfigured = useAuthConfigured();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const currentSegment = segments[0];
    const isAuthScreen = currentSegment === "login";

    if (!(isConfigured || isAuthScreen)) {
      router.replace("/login");
    } else if (isConfigured && isAuthScreen) {
      router.replace("/");
    }
  }, [isConfigured, segments, isReady, router]);

  return <>{children}</>;
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider
              config={{
                devInfo: {
                  stylingPrinciples: false,
                },
              }}
            >
              <TRPCProvider>
                <AuthGuard>
                  <ErrorToastHandler />
                  <StackLayout />
                </AuthGuard>
              </TRPCProvider>
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
