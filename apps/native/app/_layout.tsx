import "@/global.css";
import {
  Stack,
  usePathname,
  useRootNavigationState,
  useRouter,
} from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect, useRef } from "react";
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
  return (
    <Stack screenOptions={STACK_SCREEN_OPTIONS}>
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
  const pathname = usePathname();
  const navState = useRootNavigationState();
  const router = useRouter();
  const isConfigured = useAuthConfigured();
  const redirectTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!navState?.key) {
      return;
    }
    if (!isConfigured && pathname !== "/login") {
      if (redirectTargetRef.current !== "/login") {
        redirectTargetRef.current = "/login";
        router.replace("/login");
      }
      return;
    }
    if (isConfigured && pathname === "/login") {
      if (redirectTargetRef.current !== "/") {
        redirectTargetRef.current = "/";
        router.replace("/");
      }
      return;
    }
    redirectTargetRef.current = null;
  }, [isConfigured, navState?.key, pathname, router]);

  return <>{children}</>;
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider config={HEROUI_CONFIG}>
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
